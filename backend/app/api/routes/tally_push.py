"""
tally_push.py
─────────────
Push journal entries and IFRS summaries directly to TallyPrime HTTP server.
Reuses the same XML format and escape logic as InvoiceFlow.

Endpoints
─────────
POST /api/tally/push-journal       — JE data → Tally Journal voucher(s)
POST /api/tally/push-ifrs-summary  — IFRS 15 revenue schedule → Tally JEs
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tally", tags=["Tally Push"])


# ── XML escape (identical to InvoiceFlow tallyExport.ts) ──────────────────────

def escape_tally_xml(value: object) -> str:
    """Escape XML special characters so TallyPrime accepts any field value."""
    s = str(value) if value is not None else ""
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&apos;")
    )


# ── Request models ────────────────────────────────────────────────────────────

class TallySettings(BaseModel):
    url:     str = Field("http://localhost:9000", description="TallyPrime HTTP server URL")
    company: str = Field(..., description="Exact company name as it appears in Tally")


class JournalEntry(BaseModel):
    date:           str                       # YYYY-MM-DD
    voucher_number: str   = ""
    narration:      str   = ""
    debit_ledger:   str   = "Journal Account"
    credit_ledger:  str   = "Journal Account"
    amount:         float = 0.0
    currency:       str   = "INR"


class PushJournalRequest(BaseModel):
    settings: TallySettings
    entries:  list[JournalEntry]


class IFRSLineItem(BaseModel):
    period:           str    # e.g. "Apr 2025"
    revenue_amount:   float
    deferred_amount:  float  = 0.0
    contract_id:      str    = ""
    performance_obligation: str = "Contract revenue recognised"


class PushIFRSSummaryRequest(BaseModel):
    settings:   TallySettings
    line_items: list[IFRSLineItem]
    company_name: str = ""


# ── XML builders ──────────────────────────────────────────────────────────────

def _fmt_date(date_str: str) -> str:
    """Convert YYYY-MM-DD → YYYYMMDD for Tally."""
    return date_str.replace("-", "")


def _build_journal_voucher(entry: JournalEntry, company: str) -> str:
    date    = _fmt_date(entry.date)
    num     = escape_tally_xml(entry.voucher_number or f"JE-{uuid.uuid4().hex[:8].upper()}")
    narr    = escape_tally_xml(entry.narration)
    debit   = escape_tally_xml(entry.debit_ledger)
    credit  = escape_tally_xml(entry.credit_ledger)
    amt     = abs(entry.amount)

    return f"""  <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Journal" ACTION="Create" GUID="{uuid.uuid4()}">
      <DATE>{date}</DATE>
      <VOUCHERNUMBER>{num}</VOUCHERNUMBER>
      <NARRATION>{narr}</NARRATION>
      <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>{debit}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-{amt:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>{credit}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>{amt:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE>"""


def _build_ifrs_voucher(item: IFRSLineItem, company: str) -> str:
    """Convert one IFRS revenue line item to a Tally Journal voucher."""
    # Use first day of the period if parseable; otherwise today
    try:
        dt = datetime.strptime(item.period, "%b %Y")
        date_str = dt.strftime("%Y%m01")  # first day of month
    except ValueError:
        date_str = datetime.utcnow().strftime("%Y%m%d")

    narr    = escape_tally_xml(f"IFRS 15 revenue — {item.period}" +
                               (f" [{item.contract_id}]" if item.contract_id else ""))
    ob      = escape_tally_xml(item.performance_obligation)
    rev_amt = abs(item.revenue_amount)
    def_amt = abs(item.deferred_amount)

    lines = [f"""  <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Journal" ACTION="Create" GUID="{uuid.uuid4()}">
      <DATE>{date_str}</DATE>
      <NARRATION>{narr}</NARRATION>
      <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>Accounts Receivable</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-{rev_amt:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>Revenue from Contracts with Customers</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>{rev_amt:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE>"""]

    if def_amt > 0:
        lines.append(f"""  <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Journal" ACTION="Create" GUID="{uuid.uuid4()}">
      <DATE>{date_str}</DATE>
      <NARRATION>Deferred revenue — {escape_tally_xml(item.period)}</NARRATION>
      <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>Deferred Revenue (Liability)</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-{def_amt:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>Revenue from Contracts with Customers</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>{def_amt:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE>""")

    return "\n".join(lines)


def _wrap_envelope(company: str, vouchers_xml: str) -> str:
    co = escape_tally_xml(company)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{co}</SVCURRENTCOMPANY>
          <SVExportFormat>$$SysName:XML</SVExportFormat>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
{vouchers_xml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""


# ── Push helper ───────────────────────────────────────────────────────────────

async def _push_xml_to_tally(xml: str, tally_url: str) -> dict[str, Any]:
    """POST XML to TallyPrime and parse response."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                tally_url,
                content=xml.encode("utf-8"),
                headers={"Content-Type": "text/xml;charset=utf-8"},
            )
        text = resp.text
        created = int((text.split("CREATED>")[1].split("<")[0]) if "CREATED>" in text else 0)
        altered = int((text.split("ALTERED>")[1].split("<")[0]) if "ALTERED>" in text else 0)
        has_error = "LINEERROR" in text or "Error" in text

        if has_error:
            err_msg = text.split("LINEERROR>")[1].split("<")[0] if "LINEERROR>" in text else "Tally rejected the import"
            return {"success": False, "message": err_msg, "imported": 0, "fallback": False}

        return {
            "success":  True,
            "message":  f"{created + altered} voucher(s) imported into TallyPrime",
            "imported": created + altered,
            "fallback": False,
        }
    except httpx.ConnectError:
        return {
            "success":  True,
            "message":  "TallyPrime not reachable — XML returned for manual import",
            "imported": 0,
            "fallback": True,
            "xml":      xml,
        }
    except Exception as exc:
        log.error("[TallyPush] Unexpected error: %s", exc)
        return {"success": False, "message": str(exc), "imported": 0, "fallback": False}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/push-journal")
async def push_journal(req: PushJournalRequest) -> dict[str, Any]:
    """
    Convert journal entries to TallyPrime Journal vouchers and push via HTTP.
    Falls back gracefully if Tally is offline (returns XML for manual import).
    """
    if not req.entries:
        raise HTTPException(400, detail="No journal entries provided")

    vouchers = "\n".join(
        _build_journal_voucher(e, req.settings.company)
        for e in req.entries
    )
    xml    = _wrap_envelope(req.settings.company, vouchers)
    result = await _push_xml_to_tally(xml, req.settings.url)

    log.info(
        "[TallyPush] push-journal: %d entries → imported=%d success=%s",
        len(req.entries), result.get("imported", 0), result.get("success"),
    )
    return {**result, "entries_sent": len(req.entries)}


@router.post("/push-ifrs-summary")
async def push_ifrs_summary(req: PushIFRSSummaryRequest) -> dict[str, Any]:
    """
    Push an IFRS 15 revenue schedule to TallyPrime as Journal vouchers.
    Each line item produces one Revenue Recognition entry + one Deferred Revenue
    entry (if deferred_amount > 0).
    """
    if not req.line_items:
        raise HTTPException(400, detail="No IFRS line items provided")

    vouchers = "\n".join(
        _build_ifrs_voucher(item, req.settings.company)
        for item in req.line_items
    )
    xml    = _wrap_envelope(req.settings.company, vouchers)
    result = await _push_xml_to_tally(xml, req.settings.url)

    log.info(
        "[TallyPush] push-ifrs-summary: %d periods → imported=%d success=%s",
        len(req.line_items), result.get("imported", 0), result.get("success"),
    )
    return {**result, "periods_sent": len(req.line_items)}
