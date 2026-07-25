"""FTA audit checklist — shared by GulfTax router and Audit Command Center."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session


def _checklist_item(
    item_id: str,
    category: str,
    title: str,
    description: str,
    status: str,
    risk_level: str,
    detail: str,
    count: int | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": item_id,
        "category": category,
        "title": title,
        "description": description,
        "status": status,
        "risk_level": risk_level,
        "detail": detail,
    }
    if count is not None:
        row["count"] = count
    return row


def build_fta_audit_checklist(
    db: Session,
    company_id: str,
    period_start: date,
    period_end: date,
) -> dict[str, Any]:
    """Same response shape as GET /api/gulftax/fta/audit-checklist."""
    from sqlalchemy import and_
    from models import Transaction, Company, Invoice as GulfInvoice, VATReturn

    company = db.query(Company).filter(Company.id == company_id).first()
    trn = (getattr(company, "trn", None) or "").strip().replace(" ", "")
    trn_valid = trn.isdigit() and len(trn) == 15

    txns = db.query(Transaction).filter(
        and_(
            Transaction.company_id == company_id,
            Transaction.date >= period_start,
            Transaction.date <= period_end,
        )
    ).all()

    purchases = [t for t in txns if t.transaction_type == "purchase"]
    sales = [t for t in txns if t.transaction_type == "sale"]

    unclassified = [t for t in txns if not (t.vat_treatment or "").strip()]
    low_confidence = [
        t for t in txns
        if t.confidence_score is not None and t.confidence_score < 70
    ]
    unverified = [t for t in txns if not t.is_verified]
    missing_party = [t for t in txns if not (t.vendor_or_customer or "").strip()]

    inv_nums: dict[str, int] = {}
    for t in purchases:
        num = (t.invoice_number or "").strip().lower()
        if num:
            inv_nums[num] = inv_nums.get(num, 0) + 1
    duplicate_invoices = sum(1 for c in inv_nums.values() if c > 1)

    std_sales = [t for t in sales if t.vat_treatment == "standard_rated"]
    std_purch = [t for t in purchases if t.vat_treatment == "standard_rated"]
    box2 = round(sum(t.vat_amount_aed or 0 for t in std_sales), 2)
    box7 = round(sum(t.vat_amount_aed or 0 for t in std_purch), 2)
    box8 = round(box2 - box7, 2)

    vat_return = (
        db.query(VATReturn)
        .filter(
            VATReturn.company_id == company_id,
            VATReturn.period_start <= period_end,
            VATReturn.period_end >= period_start,
        )
        .order_by(VATReturn.created_at.desc())
        .first()
    )

    ap_invoices = db.query(GulfInvoice).filter(GulfInvoice.company_id == company_id).all()
    ap_missing_trn = sum(
        1 for inv in ap_invoices
        if inv.status in ("pending", "review", "approved")
        and not (inv.vendor_trn or "").strip()
    )
    ap_high_risk = sum(1 for inv in ap_invoices if (inv.overall_risk or "") == "escalate")

    blocked_flags = 0
    for inv in ap_invoices:
        for flag in (inv.risk_flags or []):
            fid = str(flag.get("flag", "")).lower()
            if "blocked" in fid or "entertainment" in fid:
                blocked_flags += 1

    items: list[dict[str, Any]] = []

    items.append(_checklist_item(
        "trn_registered", "Registration", "Valid 15-digit TRN on file",
        "FTA requires a valid Tax Registration Number for all VAT-registered entities.",
        "pass" if trn_valid else "fail", "high" if not trn_valid else "low",
        f"TRN: {trn or 'Not set'}" + (" — valid format" if trn_valid else " — invalid or missing"),
    ))
    items.append(_checklist_item(
        "transactions_loaded", "Data completeness", "Transactions recorded for period",
        "VAT Classifier should contain all sales and purchase transactions for the audit period.",
        "pass" if len(txns) > 0 else "fail", "high" if len(txns) == 0 else "low",
        f"{len(txns)} transaction(s) in {period_start} → {period_end}", len(txns),
    ))
    items.append(_checklist_item(
        "vat_treatment_classified", "Classification", "All transactions VAT-classified",
        "Every transaction must have a VAT treatment (standard, zero, exempt, reverse charge, out of scope).",
        "pass" if len(unclassified) == 0 else ("warning" if len(unclassified) <= 3 else "fail"),
        "high" if len(unclassified) > 3 else ("medium" if unclassified else "low"),
        f"{len(unclassified)} unclassified transaction(s)", len(unclassified),
    ))
    items.append(_checklist_item(
        "ai_confidence_review", "Classification", "Low-confidence items reviewed",
        "Transactions with AI confidence below 70% should be manually verified before filing.",
        "pass" if len(low_confidence) == 0 else "warning",
        "medium" if low_confidence else "low",
        f"{len(low_confidence)} transaction(s) below 70% confidence", len(low_confidence),
    ))
    items.append(_checklist_item(
        "manual_verification", "Classification", "Unverified transactions cleared",
        "All transactions should be marked verified after review.",
        "pass" if len(unverified) == 0 else "warning",
        "medium" if len(unverified) > 5 else "low",
        f"{len(unverified)} unverified transaction(s)", len(unverified),
    ))
    items.append(_checklist_item(
        "vendor_customer_present", "Documentation", "Vendor/customer name on all transactions",
        "FTA Tax Audit File requires vendor or customer identification on each line.",
        "pass" if len(missing_party) == 0 else "warning",
        "medium" if missing_party else "low",
        f"{len(missing_party)} transaction(s) missing vendor/customer", len(missing_party),
    ))
    items.append(_checklist_item(
        "duplicate_invoices", "AP Controls", "No duplicate purchase invoice numbers",
        "Duplicate invoice numbers may indicate double-claiming of input VAT.",
        "pass" if duplicate_invoices == 0 else "fail",
        "high" if duplicate_invoices else "low",
        f"{duplicate_invoices} duplicate invoice number(s) detected", duplicate_invoices,
    ))
    items.append(_checklist_item(
        "supplier_trn_ap", "AP Controls", "Supplier TRN on AP invoices",
        "Input VAT recovery requires valid supplier TRN on tax invoices.",
        "pass" if ap_missing_trn == 0 else ("warning" if ap_missing_trn <= 2 else "fail"),
        "high" if ap_missing_trn > 2 else ("medium" if ap_missing_trn else "low"),
        f"{ap_missing_trn} AP invoice(s) missing supplier TRN", ap_missing_trn,
    ))
    items.append(_checklist_item(
        "blocked_input_vat", "AP Controls", "Blocked input VAT identified",
        "Entertainment and other blocked categories must not be claimed as input VAT.",
        "pass" if blocked_flags == 0 else "warning",
        "high" if blocked_flags > 0 else "low",
        f"{blocked_flags} blocked-input-VAT flag(s) on AP invoices", blocked_flags,
    ))
    items.append(_checklist_item(
        "ap_escalations", "AP Controls", "High-risk AP invoices escalated",
        "Invoices flagged escalate should be resolved before period close.",
        "pass" if ap_high_risk == 0 else "warning",
        "medium" if ap_high_risk else "low",
        f"{ap_high_risk} escalated AP invoice(s)", ap_high_risk,
    ))

    return_reconciled = True
    return_detail = "No VAT return filed for this period — reconcile before submission."
    if vat_return:
        ret_box8 = round(float(vat_return.box8_vat_payable_or_refundable or 0), 2)
        diff = abs(ret_box8 - box8)
        return_reconciled = diff <= 1.0
        return_detail = (
            f"Computed Box 8: AED {box8:,.2f} · Return Box 8: AED {ret_box8:,.2f} · Diff: AED {diff:,.2f}"
        )

    items.append(_checklist_item(
        "vat_return_reconciled", "VAT Return", "Box 8 reconciles to transaction data",
        "Net VAT payable (Box 8) must match the sum of classified transactions.",
        "pass" if return_reconciled else "warning",
        "high" if not return_reconciled and vat_return else "medium",
        return_detail,
    ))
    items.append(_checklist_item(
        "vat_return_filed", "VAT Return", "VAT return submitted for period",
        "FTA requires timely VAT return submission for each tax period.",
        "pass" if vat_return and (vat_return.submission_status or "") in ("submitted", "filed") else "warning",
        "medium",
        (
            f"Return status: {(vat_return.submission_status if vat_return else 'not found')}"
            if vat_return
            else "No return record — create and file in VAT Return module"
        ),
    ))

    summary = {"pass": 0, "warning": 0, "fail": 0}
    for item in items:
        summary[item["status"]] = summary.get(item["status"], 0) + 1

    scorable = [i for i in items if i["status"] != "na"]
    pass_count = sum(1 for i in scorable if i["status"] == "pass")
    overall_score = round((pass_count / len(scorable)) * 100) if scorable else 0

    fail_high = sum(1 for i in items if i["status"] == "fail" and i["risk_level"] == "high")
    warn_count = summary.get("warning", 0)
    if fail_high > 0:
        overall_risk = "high"
    elif warn_count >= 3 or summary.get("fail", 0) > 0:
        overall_risk = "medium"
    else:
        overall_risk = "low"

    return {
        "company_name": company.name if company else "Unknown",
        "trn": trn or None,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "generated_at": datetime.utcnow().isoformat(),
        "overall_score_pct": overall_score,
        "overall_risk": overall_risk,
        "summary": summary,
        "transaction_count": len(txns),
        "items": items,
    }
