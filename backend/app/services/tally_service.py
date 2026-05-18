"""
Tally Prime / Tally ERP 9 XML gateway client (localhost ODBC port, default 9000).
"""
from __future__ import annotations

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pandas as pd
import requests

logger = logging.getLogger(__name__)

# Tally default group → exact IFRS line labels (match GL master / statement generator)
TALLY_TO_IFRS_MAP: dict[str, str] = {
    "Cash-in-Hand": "Cash and cash equivalents",
    "Bank Accounts": "Cash and cash equivalents",
    "Sundry Debtors": "Trade and other receivables (gross)",
    "Stock-in-Hand": "Inventories",
    "Deposits (Asset)": "Prepayments and other current assets",
    "Loans & Advances (Asset)": "Prepayments and other current assets",
    "Other Current Assets": "Prepayments and other current assets",
    "Fixed Assets": "Property plant and equipment (gross)",
    "Investments": "Other financial assets",
    "Intangible Assets": "Other intangible assets",
    "Capital Work-in-Progress": "Property plant and equipment (gross)",
    "Capital Account": "Share capital",
    "Reserves & Surplus": "Retained earnings",
    "Share Premium": "Share premium",
    "Loans (Liability)": "Borrowings — non-current",
    "Secured Loans": "Borrowings — non-current",
    "Unsecured Loans": "Borrowings — non-current",
    "Deferred Tax": "Deferred tax liabilities",
    "Sundry Creditors": "Trade and other payables",
    "Current Liabilities": "Accruals and other payables",
    "Duties & Taxes": "Income tax payable",
    "Provisions": "Provisions",
    "Bank OD": "Borrowings — current",
    "Sales Accounts": "Revenue from contracts with customers",
    "Direct Incomes": "Other income",
    "Indirect Incomes": "Other income",
    "Purchase Accounts": "Cost of goods sold",
    "Direct Expenses": "Cost of goods sold",
    "Indirect Expenses": "General and administrative expense",
    "Employee Benefits": "Employee benefits expense",
    "Salary": "Employee benefits expense",
    "Depreciation": "Depreciation — PPE",
    "Interest": "Finance costs — interest on loans",
    "Bank Charges": "Other operating expenses",
    "Tax": "Income tax expense — current",
}


class TallyService:
    """Connects to Tally XML listener (typically http://localhost:9000)."""

    def __init__(self, host: str = "localhost", port: int = 9000) -> None:
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}"
        self.timeout = 30

    def test_connection(self) -> dict[str, Any]:
        xml = """
        <ENVELOPE>
          <HEADER>
            <TALLYREQUEST>Export Data</TALLYREQUEST>
          </HEADER>
          <BODY>
            <EXPORTDATA>
              <REQUESTDESC>
                <REPORTNAME>List of Companies</REPORTNAME>
                <STATICVARIABLES>
                  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
              </REQUESTDESC>
            </EXPORTDATA>
          </BODY>
        </ENVELOPE>
        """
        try:
            response = requests.post(
                self.base_url,
                data=xml.encode("utf-8"),
                headers={"Content-Type": "text/xml"},
                timeout=self.timeout,
            )
            if response.status_code == 200:
                companies = self._parse_company_list(response.text)
                return {
                    "connected": True,
                    "companies": companies,
                    "tally_version": self._detect_version(response.text),
                }
            return {
                "connected": False,
                "error": f"Tally HTTP {response.status_code}",
            }
        except requests.exceptions.ConnectionError:
            return {
                "connected": False,
                "error": "Tally not running. Open Tally Prime / ERP 9 and enable the gateway port.",
            }
        except Exception as e:
            return {"connected": False, "error": str(e)}

    async def get_companies(self) -> list[str]:
        """Async wrapper — run sync company-list probe in thread pool."""
        result = await asyncio.to_thread(self.test_connection)
        return result.get("companies", [])

    def _parse_company_list(self, xml_str: str) -> list[str]:
        try:
            root = ET.fromstring(xml_str)
            companies: list[str] = []
            for company in root.iter("COMPANY"):
                name = company.findtext("NAME") or company.text
                if name and str(name).strip():
                    companies.append(str(name).strip())
            return sorted(set(companies))
        except ET.ParseError:
            return []

    def _detect_version(self, xml_str: str) -> str:
        if "TallyPrime" in xml_str or "Tally Prime" in xml_str:
            return "Tally Prime"
        return "Tally ERP 9"

    def import_trial_balance(
        self, company_name: str, from_date: date, to_date: date
    ) -> pd.DataFrame:
        from_str = from_date.strftime("%Y%m%d")
        to_str = to_date.strftime("%Y%m%d")
        xml = f"""
        <ENVELOPE>
          <HEADER>
            <TALLYREQUEST>Export Data</TALLYREQUEST>
          </HEADER>
          <BODY>
            <EXPORTDATA>
              <REQUESTDESC>
                <REPORTNAME>Trial Balance</REPORTNAME>
                <STATICVARIABLES>
                  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                  <SVFROMDATE>{from_str}</SVFROMDATE>
                  <SVTODATE>{to_str}</SVTODATE>
                  <SVCURRENTCOMPANY>{company_name}</SVCURRENTCOMPANY>
                  <SVSHOWALLLEDGERS>Yes</SVSHOWALLLEDGERS>
                </STATICVARIABLES>
              </REQUESTDESC>
            </EXPORTDATA>
          </BODY>
        </ENVELOPE>
        """
        response = requests.post(
            self.base_url,
            data=xml.encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=120,
        )
        if response.status_code != 200:
            raise RuntimeError(f"Tally returned HTTP {response.status_code}")
        return self._parse_trial_balance_xml(response.text)

    def _parse_trial_balance_xml(self, xml_str: str) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError:
            root = ET.fromstring(self._clean_tally_xml(xml_str))

        ledger_counter = 1
        for ledger in root.iter("LEDGER"):
            name = (
                ledger.get("NAME")
                or ledger.findtext("NAME")
                or ledger.findtext("LEDGERNAME")
                or ""
            )
            if not str(name).strip():
                continue
            balance_text = (
                ledger.findtext("CLOSINGBALANCE")
                or ledger.findtext("OPENINGBALANCE")
                or "0"
            )
            amount, is_debit = self._parse_tally_amount(balance_text)
            group = ledger.findtext("PARENT") or ledger.findtext("GROUP") or ""
            gl_code = self._generate_gl_code(group, ledger_counter)
            ledger_counter += 1
            rows.append(
                {
                    "gl_code": gl_code,
                    "gl_description": str(name).strip(),
                    "tally_group": group,
                    "debit": amount if is_debit else 0.0,
                    "credit": 0.0 if is_debit else amount,
                }
            )

        df = pd.DataFrame(rows)
        if df.empty:
            raise RuntimeError(
                "No ledger rows in Tally response. Check company name and period."
            )
        df["net_amount"] = df["debit"] - df["credit"]
        return df

    def _parse_tally_amount(self, amount_str: str) -> tuple[float, bool]:
        if not amount_str:
            return 0.0, True
        s = str(amount_str).strip()
        is_debit = True
        upper = s.upper()
        if upper.endswith(" DR") or upper.endswith(" DR."):
            is_debit = True
            s = re.sub(r"\s*DR\.?$", "", s, flags=re.IGNORECASE).strip()
        elif upper.endswith(" CR") or upper.endswith(" CR."):
            is_debit = False
            s = re.sub(r"\s*CR\.?$", "", s, flags=re.IGNORECASE).strip()
        elif s.startswith("-"):
            is_debit = False
            s = s[1:].strip()
        s = s.replace(",", "")
        try:
            return float(s), is_debit
        except ValueError:
            return 0.0, True

    def _generate_gl_code(self, tally_group: str, counter: int) -> str:
        group_prefixes = {
            "Current Assets": "1",
            "Cash-in-Hand": "10",
            "Bank Accounts": "11",
            "Sundry Debtors": "12",
            "Stock-in-Hand": "13",
            "Deposits (Asset)": "14",
            "Loans & Advances (Asset)": "15",
            "Fixed Assets": "2",
            "Capital Account": "3",
            "Reserves & Surplus": "31",
            "Current Liabilities": "5",
            "Sundry Creditors": "50",
            "Duties & Taxes": "51",
            "Provisions": "52",
            "Loans (Liability)": "4",
            "Sales Accounts": "6",
            "Purchase Accounts": "7",
            "Direct Expenses": "71",
            "Indirect Expenses": "8",
            "Direct Incomes": "61",
            "Indirect Incomes": "62",
        }
        prefix = "9"
        tg = (tally_group or "").lower()
        for group, p in group_prefixes.items():
            if group.lower() in tg:
                prefix = p
                break
        return f"{prefix}{counter:03d}"

    def _clean_tally_xml(self, xml_str: str) -> str:
        xml_str = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", xml_str)
        if "<?xml" not in xml_str[:200]:
            xml_str = '<?xml version="1.0" encoding="utf-8"?>' + xml_str
        return xml_str

    def import_ledger_groups(self, company_name: str) -> list[dict[str, str]]:
        xml = f"""
        <ENVELOPE>
          <HEADER>
            <TALLYREQUEST>Export Data</TALLYREQUEST>
          </HEADER>
          <BODY>
            <EXPORTDATA>
              <REQUESTDESC>
                <REPORTNAME>Group Summary</REPORTNAME>
                <STATICVARIABLES>
                  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                  <SVCURRENTCOMPANY>{company_name}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
              </REQUESTDESC>
            </EXPORTDATA>
          </BODY>
        </ENVELOPE>
        """
        response = requests.post(
            self.base_url,
            data=xml.encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=self.timeout,
        )
        return self._parse_groups(response.text)

    def _parse_groups(self, xml_str: str) -> list[dict[str, str]]:
        groups: list[dict[str, str]] = []
        try:
            root = ET.fromstring(xml_str)
            for group in root.iter("GROUP"):
                name = group.get("NAME") or group.findtext("NAME")
                parent = group.findtext("PARENT") or ""
                if name:
                    groups.append({"name": str(name), "parent": parent})
        except ET.ParseError:
            pass
        return groups

    def import_multi_year(
        self, company_name: str, years: list[int]
    ) -> dict[str, Any]:
        results: dict[str, Any] = {}
        for year in years:
            from_date = date(year, 4, 1)
            to_date = date(year + 1, 3, 31)
            key = f"FY{year}-{str(year + 1)[2:]}"
            try:
                df = self.import_trial_balance(company_name, from_date, to_date)
                results[key] = {
                    "status": "success",
                    "rows": len(df),
                    "data": df.to_dict("records"),
                }
            except Exception as e:
                results[key] = {"status": "error", "error": str(e)}
        return results

    # ── Async ERP sync methods (used by erp_sync_service) ────────────────────

    async def get_purchase_vouchers(
        self, company: str, days_back: int = 30
    ) -> list[dict[str, Any]]:
        """Fetch Purchase vouchers from Tally asynchronously."""
        to_dt   = datetime.utcnow()
        from_dt = to_dt - timedelta(days=days_back)
        xml = f"""<ENVELOPE>
          <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
          <BODY><EXPORTDATA><REQUESTDESC>
            <REPORTNAME>Voucher Register</REPORTNAME>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
              <SVFROMDATE>{from_dt.strftime('%Y%m%d')}</SVFROMDATE>
              <SVTODATE>{to_dt.strftime('%Y%m%d')}</SVTODATE>
              <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
            </STATICVARIABLES>
          </REQUESTDESC></EXPORTDATA></BODY>
        </ENVELOPE>"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    self.base_url,
                    content=xml.encode("utf-8"),
                    headers={"Content-Type": "text/xml"},
                )
                return self._parse_vouchers(resp.text)
        except Exception as exc:
            logger.error("[TallyService] get_purchase_vouchers failed: %s", exc)
            return []

    async def get_journal_vouchers(
        self, company: str, days_back: int = 30
    ) -> list[dict[str, Any]]:
        """Fetch Journal vouchers from Tally asynchronously."""
        to_dt   = datetime.utcnow()
        from_dt = to_dt - timedelta(days=days_back)
        xml = f"""<ENVELOPE>
          <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
          <BODY><EXPORTDATA><REQUESTDESC>
            <REPORTNAME>Voucher Register</REPORTNAME>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
              <SVFROMDATE>{from_dt.strftime('%Y%m%d')}</SVFROMDATE>
              <SVTODATE>{to_dt.strftime('%Y%m%d')}</SVTODATE>
              <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
            </STATICVARIABLES>
          </REQUESTDESC></EXPORTDATA></BODY>
        </ENVELOPE>"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    self.base_url,
                    content=xml.encode("utf-8"),
                    headers={"Content-Type": "text/xml"},
                )
                return self._parse_vouchers(resp.text)
        except Exception as exc:
            logger.error("[TallyService] get_journal_vouchers failed: %s", exc)
            return []

    def _parse_vouchers(self, raw_xml: str) -> list[dict[str, Any]]:
        """Parse Tally VOUCHER elements into list of dicts."""
        try:
            root     = ET.fromstring(self._clean_tally_xml(raw_xml))
            vouchers = []
            for v in root.iter("VOUCHER"):
                def ft(*tags: str) -> str:
                    for tag in tags:
                        el = v.find(tag)
                        if el is not None and el.text:
                            return el.text.strip()
                    return ""
                entries = []
                for entry in v.iter("ALLLEDGERENTRIES.LIST"):
                    ledger   = entry.findtext("LEDGERNAME") or ""
                    positive = (entry.findtext("ISDEEMEDPOSITIVE") or "").lower()
                    amt_el   = entry.find("AMOUNT")
                    if ledger and amt_el is not None and amt_el.text:
                        try:
                            entries.append({
                                "ledger":   ledger,
                                "is_debit": positive == "yes",
                                "amount":   abs(float(amt_el.text.replace(",", ""))),
                            })
                        except ValueError:
                            pass
                # net amount = sum of debit entries
                net = sum(e["amount"] for e in entries if e["is_debit"])
                vouchers.append({
                    "id":             ft("GUID", "VOUCHERNUMBER"),
                    "date":           ft("DATE", "VOUCHERDATE"),
                    "voucher_number": ft("VOUCHERNUMBER"),
                    "voucher_type":   ft("VOUCHERTYPENAME"),
                    "narration":      ft("NARRATION"),
                    "amount":         net,
                    "party_name":     ft("PARTYNAME", "PARTYLEDGERNAME"),
                    "ledger_entries": entries,
                })
            return vouchers
        except ET.ParseError as exc:
            logger.error("[TallyService] XML parse error: %s", exc)
            return []

    def format_vouchers_for_invoiceflow(
        self, vouchers: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Convert Tally purchase vouchers to InvoiceFlow AP format."""
        result = []
        for v in vouchers:
            iso_date = self._tally_date_to_iso(v.get("date", ""))
            result.append({
                "invoice_id":   v.get("voucher_number") or v.get("id", ""),
                "vendor_name":  v.get("party_name", "Unknown"),
                "invoice_date": iso_date,
                "due_date":     iso_date,
                "amount":       v.get("amount", 0.0),
                "currency":     "INR",
                "status":       "pending",
                "description":  v.get("narration", ""),
                "source":       "tally",
            })
        return result

    def format_vouchers_for_anomaly(
        self, vouchers: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Convert Tally journal vouchers to JE Anomaly format."""
        result = []
        for v in vouchers:
            iso_date = self._tally_date_to_iso(v.get("date", ""))
            for entry in v.get("ledger_entries", []):
                result.append({
                    "entry_id":        f"{v.get('id', '')}_{entry.get('ledger', '')}",
                    "posting_date":    iso_date,
                    "amount":          entry.get("amount", 0.0),
                    "account_code":    entry.get("ledger", ""),
                    "account_name":    entry.get("ledger", ""),
                    "description":     v.get("narration", ""),
                    "posted_by":       "Tally",
                    "document_number": v.get("voucher_number", ""),
                    "currency":        "INR",
                    "debit_credit":    "D" if entry.get("is_debit") else "C",
                    "source":          "tally",
                })
        return result

    @staticmethod
    def _tally_date_to_iso(tally_date: str) -> str:
        """Convert YYYYMMDD → ISO YYYY-MM-DD. Return today if invalid."""
        d = str(tally_date).strip()
        if len(d) == 8 and d.isdigit():
            return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        return datetime.utcnow().strftime("%Y-%m-%d")

    def auto_map_from_tally_groups(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out["ifrs_line_item"] = ""
        out["mapping_source"] = "tally_group"
        out["mapping_confidence"] = 0.0

        for idx, row in out.iterrows():
            group = str(row.get("tally_group") or "")
            if group in TALLY_TO_IFRS_MAP:
                out.at[idx, "ifrs_line_item"] = TALLY_TO_IFRS_MAP[group]
                out.at[idx, "mapping_confidence"] = 0.9
                continue
            for tally_grp, ifrs_item in TALLY_TO_IFRS_MAP.items():
                tg_l, g_l = tally_grp.lower(), group.lower()
                if tg_l in g_l or g_l in tg_l:
                    out.at[idx, "ifrs_line_item"] = ifrs_item
                    out.at[idx, "mapping_confidence"] = 0.75
                    break
            if not str(out.at[idx, "ifrs_line_item"]).strip():
                out.at[idx, "mapping_source"] = "needs_ai"
                out.at[idx, "mapping_confidence"] = 0.0

        mapped = (out["ifrs_line_item"].astype(str).str.strip() != "").sum()
        total = len(out)
        logger.info(
            "Tally group pre-mapping: %s/%s (%.0f%%); remaining for AI: %s",
            mapped,
            total,
            (mapped / total * 100) if total else 0,
            total - mapped,
        )
        return out
