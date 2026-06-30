"""FTA VAT return — aggregate all 12 boxes from sales + purchase sources."""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting_full import UAESalesInvoice


def parse_period(period: str) -> tuple[date, date]:
    """Parse 2025-Q1 or 2025-01 style period to date range."""
    p = period.strip()
    m = re.match(r"^(\d{4})-Q([1-4])$", p, re.I)
    if m:
        year, q = int(m.group(1)), int(m.group(2))
        starts = {1: (1, 1), 2: (4, 1), 3: (7, 1), 4: (10, 1)}
        ends = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
        sm, sd = starts[q]
        em, ed = ends[q]
        return date(year, sm, sd), date(year, em, ed)
    m2 = re.match(r"^(\d{4})-(\d{2})$", p)
    if m2:
        from calendar import monthrange

        year, month = int(m2.group(1)), int(m2.group(2))
        last = monthrange(year, month)[1]
        return date(year, month, 1), date(year, month, last)
    try:
        year = int(p[:4])
        return date(year, 1, 1), date(year, 12, 31)
    except ValueError:
        today = date.today()
        q = (today.month - 1) // 3 + 1
        return parse_period(f"{today.year}-Q{q}")


def _sales_boxes(
    db: Session,
    *,
    tenant_id: str,
    company_id: str | None,
    period_start: date,
    period_end: date,
) -> dict[str, float]:
    q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == tenant_id,
        UAESalesInvoice.invoice_date >= period_start,
        UAESalesInvoice.invoice_date <= period_end,
    )
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    invoices = q.all()

    box1_net = box1_vat = box2 = box3_net = box3_vat = box4 = box5 = box6_vat = box7 = 0.0

    for inv in invoices:
        supply = (inv.supply_type or "standard").lower().replace("_", "-")
        net = float(inv.subtotal or 0)
        vat = float(inv.vat_amount or 0)
        if supply in ("standard", "standard-rated"):
            box1_net += net
            box1_vat += vat
        elif supply in ("zero", "zero-rated"):
            box4 += net
        elif supply == "exempt":
            box5 += net
        elif supply == "reverse_charge":
            box3_net += net
            box3_vat += vat

    box8 = round(box1_vat + box2 + box3_vat + box6_vat + box7, 2)
    return {
        "box1_standard_rated_sales_net": round(box1_net, 2),
        "box1_standard_rated_sales_vat": round(box1_vat, 2),
        "box2_tourist_refunds": round(box2, 2),
        "box3_reverse_charge_supplies_net": round(box3_net, 2),
        "box3_reverse_charge_supplies_vat": round(box3_vat, 2),
        "box4_zero_rated_supplies": round(box4, 2),
        "box5_exempt_supplies": round(box5, 2),
        "box6_imports_vat": round(box6_vat, 2),
        "box7_output_adjustments": round(box7, 2),
        "box8_total_output_vat": box8,
        "sales_invoice_count": len(invoices),
    }


def fetch_all_vat_return_boxes(
    db: Session,
    *,
    workspace_id: str,
    company_id: str | None,
    period: str,
) -> dict[str, Any]:
    """Merge sales (UAE AR) + purchases (Supabase vat_return_entries) + advance payments."""
    from app.services.gulftax_supabase import fetch_advance_payment_invoices, fetch_vat_return_boxes

    period_start, period_end = parse_period(period)
    tenant_id = workspace_id

    sales = _sales_boxes(
        db,
        tenant_id=tenant_id,
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
    )
    purchases = fetch_vat_return_boxes(workspace_id, period)
    advances = fetch_advance_payment_invoices(workspace_id, period, company_id)

    # Prefer gulftax_transactions (AP → GulfTax pipeline) when populated
    gt_purchases = None
    gt_entries: list[dict[str, Any]] = []
    gt_summary: dict[str, Any] = {}
    if company_id:
        try:
            from app.services.gulftax_sync_service import aggregate_vat_return_summary, list_transactions

            gt_summary = aggregate_vat_return_summary(company_id, period)
            if gt_summary.get("transaction_count", 0) > 0:
                gt_purchases = {
                    "entry_count": gt_summary["transaction_count"],
                    "box9_standard_rated_expenses": gt_summary["box9"]["gross"],
                    "box10_reverse_charge_imports": gt_summary["box10"]["gross"],
                    "box11_recoverable_input_vat": round(
                        gt_summary["box9"]["vat"] + gt_summary["box10"]["vat"], 2
                    ),
                }
                gt_entries = list_transactions(company_id, period, workspace_id=workspace_id)
        except Exception:
            pass

    if gt_purchases:
        purchases = {**purchases, **gt_purchases}

    entries = (gt_entries if gt_entries else purchases.get("entries")) or []
    box9_net = float(purchases.get("box9_standard_rated_expenses") or 0)
    box10_net = float(purchases.get("box10_reverse_charge_imports") or 0)
    box11_vat = float(purchases.get("box11_recoverable_input_vat") or 0)

    box2_advance_vat = float(advances.get("advance_payment_vat_total") or 0)
    box2_tourist = sales["box2_tourist_refunds"]
    box2_combined = round(box2_tourist + box2_advance_vat, 2)

    box8 = round(
        sales["box1_standard_rated_sales_vat"]
        + box2_combined
        + sales["box3_reverse_charge_supplies_vat"]
        + sales["box6_imports_vat"]
        + sales["box7_output_adjustments"],
        2,
    )
    box12 = round(box8 - box11_vat, 2)

    return {
        "period": period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "workspace_id": workspace_id,
        "company_id": company_id,
        "box1_standard_rated_sales_net": sales["box1_standard_rated_sales_net"],
        "box1_standard_rated_sales_vat": sales["box1_standard_rated_sales_vat"],
        "box2_tourist_refunds": box2_tourist,
        "box2_advance_payment_vat": box2_advance_vat,
        "box2_combined_output": box2_combined,
        "box3_reverse_charge_supplies_net": sales["box3_reverse_charge_supplies_net"],
        "box3_reverse_charge_supplies_vat": sales["box3_reverse_charge_supplies_vat"],
        "box4_zero_rated_supplies": sales["box4_zero_rated_supplies"],
        "box5_exempt_supplies": sales["box5_exempt_supplies"],
        "box6_imports_vat": sales["box6_imports_vat"],
        "box7_output_adjustments": sales["box7_output_adjustments"],
        "box8_total_output_vat": box8,
        "box9_standard_rated_expenses": box9_net,
        "box10_reverse_charge_expenses": box10_net,
        "box11_total_input_vat": box11_vat,
        "box12_net_vat_payable_or_refundable": box12,
        "payable": box12 > 0,
        "refundable": box12 < 0,
        "sales_invoice_count": sales["sales_invoice_count"],
        "purchase_entry_count": purchases.get("entry_count", 0),
        "advance_payment_count": advances.get("advance_payment_count", 0),
        "advance_payments_included": advances.get("advance_payments", []),
        "entries": entries,
        "ap_invoiceflow_count": (
            gt_summary.get("ap_invoiceflow_count", 0) if gt_purchases and company_id else 0
        ),
        "source": "gulftax_transactions" if gt_purchases else "vat_return_entries",
    }
