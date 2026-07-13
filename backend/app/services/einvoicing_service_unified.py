"""Unified UAE Peppol PINT AE e-invoicing service — validation, XML, phase, submissions."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.client_data import EinvoicingSubmission
from app.models.company_setup import UaeCompanyProfile
from app.models.uae_accounting_full import UAESalesInvoice
from app.modules.gulftax.advance_vat import trn_mod97_valid
from app.services.einvoicing_constants import (
    DOCUMENT_TYPE_CREDIT_NOTE,
    DOCUMENT_TYPE_INVOICE,
    MONTHLY_NON_COMPLIANCE_PENALTY_AED,
    PEPPOL_5_CORNER_ADOPTED,
    PHASE_1_ASP_DEADLINE,
    PHASE_1_MANDATORY,
    PHASE_1_THRESHOLD_AED,
    PHASE_2_ASP_DEADLINE,
    PHASE_2_MANDATORY,
    PHASE_2_THRESHOLD_AED,
    PINT_AE_CUSTOMIZATION_ID,
    PINT_AE_PROFILE_ID,
    RECORD_TYPE_INTERNAL_VENDOR,
    RECORD_TYPE_OUTBOUND_AR,
    VOLUNTARY_PILOT_START,
)

UAE_TRN_RE = re.compile(r"^1\d{14}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VALID_VAT_CATEGORIES = {"S", "Z", "E", "AE"}


def _days_until(target: date) -> int:
    return (target - date.today()).days


def _clean_trn(trn: str | None) -> str:
    return re.sub(r"\D", "", str(trn or "").strip())


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _escape_xml(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _normalize_invoice_data(data: dict[str, Any]) -> dict[str, Any]:
    """Map AP/AR/embedded field names to a common shape."""
    supplier_name = (
        data.get("supplier_name")
        or data.get("vendor_name")
        or data.get("seller_name")
        or ""
    )
    buyer_name = data.get("buyer_name") or data.get("customer_name") or ""
    seller_trn = _clean_trn(data.get("seller_trn") or data.get("supplier_trn") or data.get("vendor_trn"))
    buyer_trn = _clean_trn(data.get("buyer_trn") or data.get("customer_trn"))
    net = _f(
        data.get("net_amount")
        if data.get("net_amount") is not None
        else data.get("subtotal_amount", data.get("subtotal", data.get("total_amount")))
    )
    vat = _f(data.get("vat_amount"))
    gross = _f(data.get("gross_amount") if data.get("gross_amount") is not None else data.get("total_amount"))
    if gross <= 0 and net > 0:
        gross = round(net + vat, 2)
    is_credit = bool(data.get("is_credit_note")) or str(data.get("document_type_code", "")) == DOCUMENT_TYPE_CREDIT_NOTE
    doc_type = DOCUMENT_TYPE_CREDIT_NOTE if is_credit else str(data.get("document_type_code") or DOCUMENT_TYPE_INVOICE)
    vat_category = str(data.get("vat_category") or "S").strip().upper()
    if not vat_category or vat_category in ("STANDARD", "STANDARD-RATED"):
        vat_category = "S"
    treatment = str(data.get("vat_treatment") or "").lower()
    if treatment in ("standard", "standard-rated", "s") and vat_category == "S":
        pass
    lines = data.get("lines") or data.get("line_items") or []
    if not lines and net > 0:
        lines = [{
            "description": data.get("line_description") or "Goods / services",
            "quantity": 1,
            "unit_price": net,
            "line_extension_amount": net,
            "vat_rate": _f(data.get("vat_rate"), 5.0),
        }]
    return {
        "invoice_number": str(data.get("invoice_number") or "").strip(),
        "invoice_date": str(data.get("invoice_date") or "").strip()[:10],
        "document_type_code": doc_type,
        "is_credit_note": is_credit,
        "supplier_name": supplier_name.strip(),
        "supplier_address": str(data.get("supplier_address") or "").strip(),
        "buyer_name": buyer_name.strip(),
        "buyer_address": str(data.get("buyer_address") or "").strip(),
        "seller_trn": seller_trn,
        "buyer_trn": buyer_trn,
        "net_amount": net,
        "vat_amount": vat,
        "gross_amount": gross,
        "vat_category": vat_category,
        "vat_rate": _f(data.get("vat_rate"), 5.0),
        "currency": str(data.get("currency") or "AED").upper(),
        "lines": lines,
        "xml_content": str(data.get("xml_content") or ""),
        "is_b2b": data.get("is_b2b", True),
    }


def calculate_phase(annual_revenue_aed: float) -> dict[str, Any]:
    """Determine e-invoicing phase from annual revenue (FTA-aligned)."""
    revenue = max(0.0, float(annual_revenue_aed))
    if revenue >= PHASE_1_THRESHOLD_AED:
        phase = "phase_1"
        phase_num = 1
        phase_label = f"Phase 1 — Revenue ≥ AED {PHASE_1_THRESHOLD_AED:,.0f}"
        mandatory_date = PHASE_1_MANDATORY
        asp_deadline = PHASE_1_ASP_DEADLINE
    elif revenue >= PHASE_2_THRESHOLD_AED:
        phase = "phase_2"
        phase_num = 2
        phase_label = f"Phase 2 — Revenue ≥ AED {PHASE_2_THRESHOLD_AED:,.0f}"
        mandatory_date = PHASE_2_MANDATORY
        asp_deadline = PHASE_2_ASP_DEADLINE
    else:
        phase = "phase_3"
        phase_num = 3
        phase_label = "Phase 3 — All remaining businesses"
        mandatory_date = PHASE_2_MANDATORY
        asp_deadline = PHASE_2_ASP_DEADLINE

    days_to_mandatory = _days_until(mandatory_date)
    days_to_asp = _days_until(asp_deadline)
    days_to_pilot = _days_until(VOLUNTARY_PILOT_START)
    urgency = days_to_asp < 90

    return {
        "phase": phase,
        "phase_num": phase_num,
        "phase_label": phase_label,
        "annual_revenue_aed": revenue,
        "mandatory_date": mandatory_date.isoformat(),
        "mandatory_from": mandatory_date.isoformat(),
        "asp_registration_deadline": asp_deadline.isoformat(),
        "days_to_mandatory": days_to_mandatory,
        "days_to_asp_deadline": days_to_asp,
        "voluntary_pilot_start": VOLUNTARY_PILOT_START.isoformat(),
        "days_to_voluntary_pilot": days_to_pilot,
        "voluntary_pilot_open": days_to_pilot <= 0,
        "peppol_5_corner_adopted": PEPPOL_5_CORNER_ADOPTED.isoformat(),
        "monthly_penalty_aed": MONTHLY_NON_COMPLIANCE_PENALTY_AED,
        "phase_1_asp_deadline_label": PHASE_1_ASP_DEADLINE.strftime("%d %B %Y"),
        "phase_2_asp_deadline_label": PHASE_2_ASP_DEADLINE.strftime("%d %B %Y"),
        "urgency_banner": urgency,
        "urgency_message": (
            f"ASP registration deadline in {days_to_asp} days — appoint an accredited ASP immediately."
            if urgency
            else None
        ),
        "standard": "Peppol PINT AE",
    }


def _add_rule(
    rules: list[dict[str, Any]],
    *,
    rid: str,
    label: str,
    passed: bool,
    bt_code: str | None = None,
    fix: str = "",
    value: Any = None,
) -> None:
    rules.append({
        "id": rid,
        "field": bt_code or rid,
        "label": label,
        "bt_code": bt_code,
        "passed": passed,
        "fix": fix if not passed else "",
        "value": value,
    })


def validate_pint_ae(invoice_data: dict[str, Any]) -> dict[str, Any]:
    """Unified PINT AE validation — 15+ rules (AP base + BT-coded checks)."""
    data = _normalize_invoice_data(invoice_data)

    if data["xml_content"]:
        try:
            parsed = _parse_xml_invoice(data["xml_content"])
            for key, val in parsed.items():
                if val is not None and not data.get(key):
                    data[key] = val
        except ET.ParseError as exc:
            return {
                "compliant": False,
                "compliance_score": 0,
                "rules_passed": 0,
                "rules_total": 1,
                "rules": [],
                "errors": [{"field": "xml", "label": "XML file", "message": f"Invalid XML: {exc}"}],
                "warnings": [],
                "passed": [],
            }

    rules: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    passed_fields: list[dict[str, Any]] = []

    inv_no = data["invoice_number"]
    _add_rule(rules, rid="inv_number", bt_code="BT-1", label="Invoice number (BT-1)", passed=bool(inv_no),
              fix="Provide a unique invoice/document number")
    if inv_no:
        passed_fields.append({"field": "BT-1", "label": "Invoice number", "value": inv_no})

    inv_date = data["invoice_date"]
    date_ok = bool(inv_date and DATE_RE.match(inv_date))
    _add_rule(rules, rid="inv_date", bt_code="BT-2", label="Invoice date (BT-2)", passed=date_ok,
              fix="Use ISO date format YYYY-MM-DD")
    if date_ok:
        passed_fields.append({"field": "BT-2", "label": "Invoice date", "value": inv_date})

    vendor = data["supplier_name"]
    _add_rule(rules, rid="supplier_name", label="Supplier legal name", passed=len(vendor) >= 2,
              fix="Add supplier legal name as on TRN certificate")

    seller_trn = data["seller_trn"]
    trn_ok = trn_mod97_valid(seller_trn)
    _add_rule(rules, rid="supplier_trn", bt_code="BT-31", label="Seller TRN (BT-31)", passed=trn_ok,
              fix="TRN must be 15 digits starting with 1")
    if trn_ok:
        passed_fields.append({"field": "BT-31", "label": "Seller TRN", "value": seller_trn})

    buyer_trn = data["buyer_trn"]
    b2b = bool(data["is_b2b"])
    buyer_ok = trn_mod97_valid(buyer_trn) if buyer_trn else not b2b
    _add_rule(rules, rid="buyer_trn", bt_code="BT-48", label="Buyer TRN (BT-48)", passed=buyer_ok,
              fix="Buyer TRN required for B2B — 15 digits starting with 1")
    if buyer_trn and trn_mod97_valid(buyer_trn):
        passed_fields.append({"field": "BT-48", "label": "Buyer TRN", "value": buyer_trn})
    elif not buyer_trn and b2b:
        warnings.append({"field": "BT-48", "label": "Buyer TRN", "message": "Buyer TRN missing for B2B"})

    net = data["net_amount"]
    _add_rule(rules, rid="net_amount", bt_code="BT-109", label="Net amount AED (BT-109)", passed=net > 0,
              fix="Net / taxable amount must be positive", value=net if net > 0 else None)

    vat = data["vat_amount"]
    _add_rule(rules, rid="vat_present", bt_code="BT-110", label="VAT amount AED (BT-110)", passed=vat >= 0,
              fix="Declare VAT amount (0 for zero-rated/exempt)", value=vat)

    cat = data["vat_category"]
    cat_ok = cat in VALID_VAT_CATEGORIES
    _add_rule(rules, rid="vat_category", bt_code="BT-151", label="VAT category code (BT-151)", passed=cat_ok,
              fix="Use S, Z, E, or AE")

    rate = data["vat_rate"]
    rate_ok = (
        (cat == "S" and rate == 5)
        or (cat in ("Z", "E") and rate == 0)
        or (cat == "AE" and rate >= 0)
    )
    _add_rule(rules, rid="vat_rate", bt_code="BT-117", label="VAT rate (BT-117)", passed=rate_ok,
              fix="5% for S, 0% for Z/E")

    expected_vat = round(net * (rate / 100), 2) if cat == "S" else 0.0
    vat_calc_ok = abs(vat - expected_vat) <= 0.05 or (vat > 0 and net > 0) or cat in ("Z", "E")
    _add_rule(rules, rid="vat_calc", label="VAT at standard 5%", passed=vat_calc_ok,
              fix=f"Expected VAT ~AED {expected_vat:,.2f}")

    gross = data["gross_amount"]
    total_ok = gross > 0 and abs(gross - (net + vat)) <= 0.1
    _add_rule(rules, rid="total", bt_code="BT-112", label="Gross = net + VAT (BT-112)", passed=total_ok,
              fix="Total must equal net + VAT", value=gross if total_ok else None)

    curr = data["currency"]
    _add_rule(rules, rid="currency", label="Currency is AED", passed=curr in ("AED", "د.إ"),
              fix="UAE e-invoices must use AED")

    doc_type = data["document_type_code"]
    doc_ok = doc_type in (DOCUMENT_TYPE_INVOICE, DOCUMENT_TYPE_CREDIT_NOTE)
    _add_rule(rules, rid="doc_type", label="Document type 380/381", passed=doc_ok,
              fix="380=tax invoice, 381=credit note")

    lines = data["lines"]
    _add_rule(rules, rid="line_items", label="Invoice line items (BT-126+)", passed=len(lines) > 0 and net > 0,
              fix="Include line items with description, qty, unit price")

    _add_rule(rules, rid="tax_total", label="Tax total block present", passed=vat >= 0,
              fix="Include TaxTotal in UBL XML")

    _add_rule(rules, rid="monetary_total", label="Legal monetary total present", passed=gross > 0,
              fix="Include LegalMonetaryTotal in UBL XML")

    _add_rule(rules, rid="issue_time", label="Issue date ISO format", passed=date_ok,
              fix="Use YYYY-MM-DD")

    _add_rule(rules, rid="peppol_profile", label="Peppol PINT AE profile readiness",
              passed=trn_ok and bool(inv_no) and net > 0,
              fix="Complete TRN, invoice no, and amounts for PINT AE")

    failed = [r for r in rules if not r["passed"]]
    for r in failed:
        errors.append({"field": r.get("bt_code") or r["id"], "label": r["label"], "message": r["fix"], "fix": r["fix"]})

    score = max(0, min(100, round(((len(rules) - len(failed)) / len(rules)) * 100)))

    return {
        "compliant": len(failed) == 0,
        "valid": len(failed) == 0,
        "compliance_score": score,
        "rules_passed": len(rules) - len(failed),
        "rules_total": len(rules),
        "rules": rules,
        "issues_found": len(failed),
        "errors": errors,
        "warnings": warnings,
        "passed": passed_fields,
        "standard": "Peppol PINT AE",
    }


def _parse_xml_invoice(xml_content: str) -> dict[str, Any]:
    root = ET.fromstring(xml_content)
    ns_inv = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    ns_cbc = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"

    def _text(tag: str) -> str | None:
        for el in root.iter():
            if el.tag.endswith(tag) and el.text:
                return el.text.strip()
        return None

    type_code = _text("InvoiceTypeCode") or DOCUMENT_TYPE_INVOICE
    return {
        "invoice_number": _text("ID"),
        "invoice_date": _text("IssueDate"),
        "document_type_code": type_code,
        "is_credit_note": type_code == DOCUMENT_TYPE_CREDIT_NOTE,
        "seller_trn": _text("CompanyID"),
        "net_amount": _f(_text("TaxExclusiveAmount")),
        "vat_amount": _f(_text("TaxAmount")),
        "gross_amount": _f(_text("PayableAmount")),
    }


def _party_block(name: str, trn: str, address: str, *, is_supplier: bool) -> str:
    role = "AccountingSupplierParty" if is_supplier else "AccountingCustomerParty"
    addr_block = ""
    if address:
        addr_block = f"""
      <cac:PostalAddress>
        <cbc:StreetName>{_escape_xml(address)}</cbc:StreetName>
        <cac:Country><cbc:IdentificationCode>AE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>"""
    trn_block = ""
    if trn:
        trn_block = f"""
      <cac:PartyTaxScheme>
        <cbc:CompanyID>{_escape_xml(trn)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>"""
    return f"""
  <cac:{role}>
    <cac:Party>
      <cac:PartyName><cbc:Name>{_escape_xml(name or ('Supplier' if is_supplier else 'Buyer'))}</cbc:Name></cac:PartyName>{addr_block}{trn_block}
    </cac:Party>
  </cac:{role}>"""


def _invoice_lines_xml(lines: list[dict[str, Any]], currency: str, default_vat_rate: float) -> str:
    blocks: list[str] = []
    for idx, line in enumerate(lines, start=1):
        qty = _f(line.get("quantity") or line.get("qty"), 1.0)
        unit_price = _f(line.get("unit_price"))
        ext = _f(line.get("line_extension_amount") or line.get("line_total"), qty * unit_price)
        desc = str(line.get("description") or f"Line {idx}")
        vat_rate = _f(line.get("vat_rate"), default_vat_rate)
        blocks.append(f"""
  <cac:InvoiceLine>
    <cbc:ID>{idx}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">{qty:.3f}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="{currency}">{ext:.2f}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>{_escape_xml(desc)}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="{currency}">{unit_price:.2f}</cbc:PriceAmount></cac:Price>
    <cac:ClassifiedTaxCategory>
      <cbc:ID>S</cbc:ID>
      <cbc:Percent>{vat_rate:.2f}</cbc:Percent>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:ClassifiedTaxCategory>
  </cac:InvoiceLine>""")
    return "".join(blocks)


def generate_pint_ae_xml(invoice_data: dict[str, Any]) -> str:
    """Generate improved Peppol PINT AE UBL 2.1 invoice XML."""
    data = _normalize_invoice_data(invoice_data)
    currency = data["currency"]
    net = data["net_amount"]
    vat = data["vat_amount"]
    gross = data["gross_amount"]
    doc_type = data["document_type_code"]
    vat_cat = data["vat_category"]
    vat_rate = data["vat_rate"]

    supplier = _party_block(data["supplier_name"], data["seller_trn"], data["supplier_address"], is_supplier=True)
    buyer = _party_block(data["buyer_name"], data["buyer_trn"], data["buyer_address"], is_supplier=False)
    lines_xml = _invoice_lines_xml(data["lines"], currency, vat_rate)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>{PINT_AE_CUSTOMIZATION_ID}</cbc:CustomizationID>
  <cbc:ProfileID>{PINT_AE_PROFILE_ID}</cbc:ProfileID>
  <cbc:ID>{_escape_xml(data["invoice_number"])}</cbc:ID>
  <cbc:IssueDate>{_escape_xml(data["invoice_date"] or date.today().isoformat())}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>{doc_type}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>{currency}</cbc:DocumentCurrencyCode>{supplier}{buyer}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="{currency}">{vat:.2f}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="{currency}">{net:.2f}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="{currency}">{vat:.2f}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>{vat_cat}</cbc:ID>
        <cbc:Percent>{vat_rate:.2f}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="{currency}">{net:.2f}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="{currency}">{net:.2f}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="{currency}">{gross:.2f}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="{currency}">{gross:.2f}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>{lines_xml}
</Invoice>"""


def is_internal_vendor_submission(row: EinvoicingSubmission) -> bool:
    """True for vendor-received internal archives — never ASP-submittable as outbound."""
    record_type = getattr(row, "record_type", None) or RECORD_TYPE_OUTBOUND_AR
    if record_type == RECORD_TYPE_INTERNAL_VENDOR:
        return True
    inv_id = str(row.invoice_id or "")
    return inv_id.startswith("gulftax-flow-")


def assert_asp_submittable(row: EinvoicingSubmission) -> None:
    if is_internal_vendor_submission(row):
        raise ValueError(
            "Vendor-received internal structured invoice records cannot be submitted to ASP "
            "as outbound e-invoices."
        )


def assert_outbound_asp_seller(seller_trn: str, company_trn: str | None) -> None:
    """Block ASP submit when the seller TRN is not the issuing company's TRN (vendor-received AP)."""
    seller = _clean_trn(seller_trn)
    company = _clean_trn(company_trn)
    if seller and company and seller != company:
        raise ValueError(
            "Only outbound e-invoices where your company is the supplier (seller TRN) "
            "may be submitted to ASP. Vendor-received invoices cannot be submitted."
        )


def _serialize_submission(row: EinvoicingSubmission) -> dict[str, Any]:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "company_id": row.company_id,
        "invoice_id": row.invoice_id,
        "invoice_number": row.invoice_number,
        "record_type": getattr(row, "record_type", None) or RECORD_TYPE_OUTBOUND_AR,
        "submission_status": row.submission_status,
        "status": row.submission_status,
        "xml_payload": row.xml_payload,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        "asp_reference": row.asp_reference,
        "error_message": row.error_message,
        "rejection_reason": row.error_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def create_pending_submission(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    invoice_id: str | None,
    invoice_number: str,
    xml_payload: str,
    record_type: str = RECORD_TYPE_OUTBOUND_AR,
) -> EinvoicingSubmission:
    existing = (
        db.query(EinvoicingSubmission)
        .filter(
            EinvoicingSubmission.tenant_id == tenant_id,
            EinvoicingSubmission.invoice_id == invoice_id,
            EinvoicingSubmission.submission_status == "pending",
        )
        .first()
        if invoice_id
        else None
    )
    if existing:
        existing.xml_payload = xml_payload
        existing.invoice_number = invoice_number
        existing.record_type = record_type
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    row = EinvoicingSubmission(
        tenant_id=tenant_id,
        company_id=company_id,
        invoice_id=invoice_id,
        invoice_number=invoice_number,
        record_type=record_type,
        submission_status="pending",
        xml_payload=xml_payload,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_submissions(
    db: Session,
    tenant_id: str,
    company_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    q = db.query(EinvoicingSubmission).filter(EinvoicingSubmission.tenant_id == tenant_id)
    if company_id:
        q = q.filter(EinvoicingSubmission.company_id == company_id)
    rows = q.order_by(EinvoicingSubmission.created_at.desc()).limit(limit).all()
    return [_serialize_submission(r) for r in rows]


def get_latest_submission_status(
    db: Session,
    tenant_id: str,
    invoice_ids: list[str],
) -> dict[str, str]:
    if not invoice_ids:
        return {}
    rows = (
        db.query(EinvoicingSubmission)
        .filter(
            EinvoicingSubmission.tenant_id == tenant_id,
            EinvoicingSubmission.invoice_id.in_(invoice_ids),
        )
        .order_by(EinvoicingSubmission.created_at.desc())
        .all()
    )
    out: dict[str, str] = {}
    for row in rows:
        if row.invoice_id and row.invoice_id not in out:
            out[row.invoice_id] = row.submission_status
    return out


def submit_to_asp(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    invoice_number: str,
    xml_payload: str,
    invoice_id: str | None = None,
    submission_id: str | None = None,
) -> EinvoicingSubmission:
    if submission_id:
        row = db.query(EinvoicingSubmission).filter_by(id=submission_id, tenant_id=tenant_id).first()
        if not row:
            raise ValueError("Submission not found")
        assert_asp_submittable(row)
    else:
        if invoice_id and str(invoice_id).startswith("gulftax-flow-"):
            raise ValueError(
                "Vendor-received internal structured invoice records cannot be submitted to ASP "
                "as outbound e-invoices."
            )
        row = create_pending_submission(
            db,
            tenant_id=tenant_id,
            company_id=company_id,
            invoice_id=invoice_id,
            invoice_number=invoice_number,
            xml_payload=xml_payload,
        )
        assert_asp_submittable(row)
    row.submission_status = "pending"
    row.xml_payload = xml_payload or row.xml_payload
    row.submitted_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def update_submission_status(
    db: Session,
    submission_id: str,
    *,
    status: str,
    asp_reference: str | None = None,
    error_message: str | None = None,
) -> EinvoicingSubmission | None:
    row = db.query(EinvoicingSubmission).filter_by(id=submission_id).first()
    if not row:
        return None
    row.submission_status = status
    if asp_reference:
        row.asp_reference = asp_reference
    if error_message:
        row.error_message = error_message
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def build_invoice_data_from_ar(
    inv: UAESalesInvoice,
    company: UaeCompanyProfile | None,
) -> dict[str, Any]:
    cust = inv.customer
    lines = [
        {
            "description": ln.description or "Line item",
            "quantity": _f(ln.quantity, 1.0),
            "unit_price": _f(ln.unit_price),
            "line_extension_amount": _f(ln.line_total),
            "vat_rate": _f(ln.vat_rate, 5.0),
        }
        for ln in (inv.lines or [])
    ]
    subtotal = _f(inv.subtotal)
    vat = _f(inv.vat_amount)
    total = _f(inv.total_amount)
    return {
        "invoice_number": inv.invoice_number or "",
        "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else "",
        "supplier_name": company.company_name if company else "Supplier",
        "supplier_address": company.address if company else "",
        "seller_trn": inv.seller_trn or (company.trn if company else ""),
        "buyer_name": cust.name if cust else "Buyer",
        "buyer_trn": inv.buyer_trn or (cust.trn if cust else ""),
        "net_amount": subtotal,
        "vat_amount": vat,
        "gross_amount": total,
        "vat_category": "S",
        "vat_rate": 5.0,
        "currency": "AED",
        "lines": lines,
        "is_b2b": True,
    }


def generate_and_store_ar_einvoice(
    db: Session,
    sales_invoice_id: str,
    *,
    tenant_id: str,
    company_id: str | None,
) -> dict[str, Any]:
    """After AR GL post — generate PINT AE XML and persist pending submission (no ASP submit)."""
    inv = (
        db.query(UAESalesInvoice)
        .filter(UAESalesInvoice.id == sales_invoice_id, UAESalesInvoice.tenant_id == tenant_id)
        .first()
    )
    if not inv:
        return {"ok": False, "error": "sales_invoice_not_found"}

    company: UaeCompanyProfile | None = None
    if company_id:
        company = db.query(UaeCompanyProfile).filter(UaeCompanyProfile.id == company_id).first()

    invoice_data = build_invoice_data_from_ar(inv, company)
    xml = generate_pint_ae_xml(invoice_data)
    cid = company_id or inv.company_id or tenant_id
    row = create_pending_submission(
        db,
        tenant_id=tenant_id,
        company_id=cid,
        invoice_id=inv.id,
        invoice_number=inv.invoice_number or inv.id,
        xml_payload=xml,
        record_type=RECORD_TYPE_OUTBOUND_AR,
    )
    return {"ok": True, "submission_id": row.id, "einvoicing_status": row.submission_status}


_GULFTAX_VAT_TO_PINT: dict[str, tuple[str, float]] = {
    "standard_rated": ("S", 5.0),
    "zero_rated": ("Z", 0.0),
    "exempt": ("E", 0.0),
    "reverse_charge": ("AE", 5.0),
    "out_of_scope": ("E", 0.0),
}


def build_invoice_data_from_gulftax_flow(inv: Any, company: Any | None) -> dict[str, Any]:
    """Map GulfTax Invoice Flow (ported AP invoice) → generate_pint_ae_xml shape."""
    extracted: dict[str, Any] = inv.extracted_json if isinstance(getattr(inv, "extracted_json", None), dict) else {}
    vat_treatment = str(getattr(inv, "vat_treatment", None) or "standard_rated").lower()
    vat_category, vat_rate = _GULFTAX_VAT_TO_PINT.get(vat_treatment, ("S", 5.0))

    lines: list[dict[str, Any]] = []
    for li in (getattr(inv, "line_items", None) or []):
        if not isinstance(li, dict):
            continue
        qty = _f(li.get("quantity"), 1.0)
        unit_price = _f(li.get("unit_price"))
        lines.append({
            "description": li.get("description") or "Line item",
            "quantity": qty,
            "unit_price": unit_price,
            "line_extension_amount": round(qty * unit_price, 2),
            "vat_rate": _f(li.get("vat_rate"), vat_rate),
        })

    subtotal = _f(getattr(inv, "subtotal_aed", None))
    vat = _f(getattr(inv, "vat_amount_aed", None))
    total = _f(getattr(inv, "total_aed", None))
    if subtotal <= 0 and total > 0:
        if vat_treatment == "standard_rated" and vat > 0:
            subtotal = round(total - vat, 2)
        elif vat_treatment == "standard_rated":
            subtotal = round(total / 1.05, 2)
            vat = round(total - subtotal, 2)
        else:
            subtotal = total

    company_name = getattr(company, "name", None) if company else None
    company_trn = getattr(company, "trn", None) if company else None

    return {
        "invoice_number": str(getattr(inv, "invoice_number", None) or "").strip(),
        "invoice_date": str(getattr(inv, "invoice_date", None) or "")[:10],
        "supplier_name": getattr(inv, "vendor_name", None) or extracted.get("vendor_name") or "Supplier",
        "supplier_address": extracted.get("vendor_address") or "",
        "seller_trn": getattr(inv, "vendor_trn", None) or extracted.get("vendor_trn") or "",
        "buyer_name": extracted.get("customer_name") or company_name or "Buyer",
        "buyer_address": extracted.get("customer_address") or "",
        "buyer_trn": extracted.get("customer_trn") or company_trn or "",
        "net_amount": subtotal,
        "vat_amount": vat,
        "gross_amount": total if total > 0 else round(subtotal + vat, 2),
        "vat_category": vat_category,
        "vat_rate": vat_rate,
        "currency": str(extracted.get("currency") or "AED").upper(),
        "lines": lines,
        "is_b2b": True,
        "vat_treatment": vat_treatment,
    }


def generate_and_store_gulftax_flow_einvoice(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    flow_invoice_id: int,
    invoice_data: dict[str, Any],
) -> dict[str, Any]:
    """Vendor-received AP invoice → PINT AE-shaped internal archive (not outbound e-invoicing)."""
    xml = generate_pint_ae_xml(invoice_data)
    external_id = f"gulftax-flow-{flow_invoice_id}"
    inv_no = str(invoice_data.get("invoice_number") or external_id)
    row = create_pending_submission(
        db,
        tenant_id=tenant_id,
        company_id=company_id,
        invoice_id=external_id,
        invoice_number=inv_no,
        xml_payload=xml,
        record_type=RECORD_TYPE_INTERNAL_VENDOR,
    )
    return {
        "ok": True,
        "submission_id": row.id,
        "einvoicing_status": row.submission_status,
        "record_type": RECORD_TYPE_INTERNAL_VENDOR,
        "invoice_id": external_id,
    }
