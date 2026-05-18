"""
Tally XML generator for bank transactions.

Only transactions with approval_status in:
  {'auto_approved', 'confirmed', 'excel_corrected'}
are included in the XML output.

Output: Tally Prime-compatible XML for Accounting Voucher import.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any


_ELIGIBLE = {"auto_approved", "confirmed", "excel_corrected"}


def _tally_date(date_str: str) -> str:
    """Convert 'dd-MMM-YYYY' or ISO or 'dd/mm/yyyy' → YYYYMMDD for Tally."""
    if not date_str:
        return datetime.utcnow().strftime("%Y%m%d")
    for fmt in (
        "%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y",
        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    # fallback: strip non-digits, take first 8
    digits = re.sub(r"\D", "", date_str)
    return digits[:8] if len(digits) >= 8 else datetime.utcnow().strftime("%Y%m%d")


def _esc(text: str) -> str:
    """Minimal XML escaping."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def generate_tally_xml(
    transactions: list[dict[str, Any]],
    bank_ledger: str = "Bank Account",
    company_name: str = "",
    voucher_type: str = "Payment",
) -> str:
    """
    Generate Tally Prime-compatible XML for approved bank transactions.

    Parameters
    ----------
    transactions : list[dict]
        Each dict may contain:
        - date (str)
        - description (str)
        - debit, credit (float)
        - ledger_name (str) — the contra / expense / income ledger
        - approval_status (str) — only eligible statuses are posted
    bank_ledger : str
        Name of the bank account ledger in Tally (e.g. "HDFC Current A/c")
    company_name : str
        Optional Tally company name
    voucher_type : str
        Tally voucher type name (Payment / Receipt / Contra / Journal)

    Returns
    -------
    str — UTF-8 XML string ready to import into Tally Prime
    """
    eligible = [t for t in transactions if t.get("approval_status") in _ELIGIBLE]

    vouchers_xml = []
    for txn in eligible:
        date_str   = _tally_date(str(txn.get("date", "")))
        narration  = _esc(str(txn.get("description", "")))
        debit_amt  = float(txn.get("debit", 0) or 0)
        credit_amt = float(txn.get("credit", 0) or 0)
        ledger     = _esc(str(txn.get("ledger_name", "Suspense Account")))
        bank_leg   = _esc(bank_ledger)

        # Determine voucher direction
        if debit_amt > 0:
            # Payment: money goes out of bank → debit expense ledger, credit bank
            amount      = debit_amt
            vtype       = "Payment"
            dr_ledger   = ledger
            cr_ledger   = bank_leg
        else:
            # Receipt: money comes into bank → debit bank, credit income ledger
            amount      = credit_amt
            vtype       = "Receipt"
            dr_ledger   = bank_leg
            cr_ledger   = ledger

        if amount <= 0:
            continue  # skip zero-amount rows

        vouchers_xml.append(f"""    <VOUCHER VCHTYPE="{vtype}" ACTION="Create">
      <DATE>{date_str}</DATE>
      <NARRATION>{narration}</NARRATION>
      <VOUCHERTYPENAME>{_esc(vtype)}</VOUCHERTYPENAME>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>{dr_ledger}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-{amount:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>{cr_ledger}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>{amount:.2f}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>""")

    company_block = f"<COMPANY>{_esc(company_name)}</COMPANY>\n  " if company_name else ""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        {company_block}<STATICVARIABLES>
          <SVCURRENTCOMPANY>{_esc(company_name)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
{chr(10).join(vouchers_xml)}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""
    return xml


def generate_summary(transactions: list[dict[str, Any]]) -> dict[str, Any]:
    """Return approval-tier summary stats for a batch of classified transactions."""
    total   = len(transactions)
    auto    = sum(1 for t in transactions if t.get("approval_status") == "auto_approved")
    conf    = sum(1 for t in transactions if t.get("approval_status") == "confirmed")
    excel   = sum(1 for t in transactions if t.get("approval_status") == "excel_corrected")
    pending = sum(1 for t in transactions if t.get("approval_status") == "pending")
    manual  = sum(1 for t in transactions if t.get("approval_status") == "manual")
    eligible_total = auto + conf + excel

    total_debit  = sum(float(t.get("debit",  0) or 0) for t in transactions)
    total_credit = sum(float(t.get("credit", 0) or 0) for t in transactions)

    return {
        "total":            total,
        "eligible":         eligible_total,
        "auto_approved":    auto,
        "confirmed":        conf,
        "excel_corrected":  excel,
        "pending_review":   pending,
        "manual":           manual,
        "total_debit":      round(total_debit, 2),
        "total_credit":     round(total_credit, 2),
    }
