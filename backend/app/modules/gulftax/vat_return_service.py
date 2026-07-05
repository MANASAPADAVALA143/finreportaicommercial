"""FTA VAT return — aggregate all 12 boxes from sales + purchase sources."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.client_data import (
    BadDebtReliefClaim,
    GulftaxTransaction,
    PartialExemptionCalculation,
)
from app.models.uae_accounting_full import UAESalesInvoice

LocationType = Literal["mainland", "free_zone", "designated_zone", "overseas"]
TransactionKind = Literal["goods", "services"]


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


def calculate_partial_exemption_recovery_pct(taxable_supplies: float, exempt_supplies: float) -> float:
    """Pro-rata recovery % = taxable / (taxable + exempt) × 100."""
    taxable = max(0.0, float(taxable_supplies))
    exempt = max(0.0, float(exempt_supplies))
    total = taxable + exempt
    if total <= 0:
        return 0.0
    return round((taxable / total) * 100.0, 4)


def calculate_partial_exemption_adjustment(
    db: Session,
    *,
    tenant_id: str,
    company_id: str | None,
    period: str,
) -> dict[str, Any]:
    """
    Load latest approved partial exemption for the period and return recovery metadata.
    Moved from frontend vatAdvanced.ts calculatePartialExemption (pro-rata core only).
    """
    if not company_id:
        return {
            "partial_exemption_applied": False,
            "recovery_percentage": 0.0,
            "calculation_id": None,
        }

    row = (
        db.query(PartialExemptionCalculation)
        .filter(
            PartialExemptionCalculation.tenant_id == tenant_id,
            PartialExemptionCalculation.company_id == company_id,
            PartialExemptionCalculation.period == period,
            PartialExemptionCalculation.status == "approved",
        )
        .order_by(PartialExemptionCalculation.created_at.desc())
        .first()
    )
    if not row:
        return {
            "partial_exemption_applied": False,
            "recovery_percentage": 0.0,
            "calculation_id": None,
        }

    recovery_pct = float(row.recovery_pct)
    if recovery_pct <= 0:
        recovery_pct = calculate_partial_exemption_recovery_pct(
            float(row.taxable_supplies),
            float(row.exempt_supplies),
        )

    return {
        "partial_exemption_applied": True,
        "recovery_percentage": recovery_pct,
        "calculation_id": row.id,
        "recoverable_vat": float(row.recoverable_vat),
        "irrecoverable_vat": float(row.irrecoverable_vat),
    }


@dataclass
class DesignatedZoneResult:
    vat_treatment: str
    vat_rate: float
    explanation: str
    warning: str | None
    outside_scope: bool = False
    box6_import_vat: float = 0.0
    box4_zero_rated_net: float = 0.0
    box3_zero_rated_net: float = 0.0


def evaluate_designated_zone(
    *,
    supplier_location: str,
    customer_location: str,
    transaction_type: str,
) -> DesignatedZoneResult:
    """Server-side port of evaluateDesignatedZone() from frontend vatAdvanced.ts."""
    supplier = (supplier_location or "mainland").lower()
    customer = (customer_location or "mainland").lower()
    kind = (transaction_type or "goods").lower()

    if kind == "services":
        warning = (
            "Services are always subject to normal UAE VAT rules — Designated Zone status does not apply."
            if supplier == "designated_zone" or customer == "designated_zone"
            else None
        )
        return DesignatedZoneResult(
            vat_treatment="Standard rated (5%)",
            vat_rate=5.0,
            explanation=(
                "Designated Zone treatment applies to goods only; services follow standard rules."
            ),
            warning=warning,
        )

    s_dz = supplier == "designated_zone"
    c_dz = customer == "designated_zone"
    c_main = customer in ("mainland", "free_zone")
    s_main = supplier in ("mainland", "free_zone")

    if s_dz and c_dz:
        return DesignatedZoneResult(
            vat_treatment="Outside scope",
            vat_rate=0.0,
            explanation="Goods between two Designated Zones are outside UAE VAT scope.",
            warning=None,
            outside_scope=True,
        )
    if s_dz and c_main:
        return DesignatedZoneResult(
            vat_treatment="Import (5% VAT)",
            vat_rate=5.0,
            explanation="Goods from a Designated Zone to mainland are treated as an import.",
            warning=None,
        )
    if s_main and c_dz:
        return DesignatedZoneResult(
            vat_treatment="Export (0% VAT)",
            vat_rate=0.0,
            explanation="Goods from mainland to a Designated Zone are zero-rated exports.",
            warning=None,
        )
    if s_dz and customer == "overseas":
        return DesignatedZoneResult(
            vat_treatment="Export (0% VAT)",
            vat_rate=0.0,
            explanation="Goods exported from a Designated Zone overseas are zero-rated.",
            warning=None,
        )
    if supplier == "overseas" and c_dz:
        return DesignatedZoneResult(
            vat_treatment="Import (5% VAT)",
            vat_rate=5.0,
            explanation="Goods imported into a Designated Zone from overseas attract import VAT.",
            warning=None,
        )

    return DesignatedZoneResult(
        vat_treatment="Standard rated (5%)",
        vat_rate=5.0,
        explanation="Standard UAE VAT rules apply.",
        warning=None,
    )


def resolve_dz_locations_for_transaction(
    *,
    direction: str,
    company_entity_type: str | None,
    invoice_designated_zone: bool = False,
) -> tuple[bool, str, str, str]:
    """
    Return (designated_zone_flag, transaction_kind, supplier_loc, customer_loc).
    AP (input): vendor=mainland default, company as customer side.
    AR (output): company as supplier side.
    """
    entity = (company_entity_type or "mainland").lower()
    is_dz_entity = entity == "designated_zone" or invoice_designated_zone
    if not is_dz_entity:
        return False, "goods", "mainland", "mainland"

    if (direction or "input").lower() == "output":
        return True, "goods", "designated_zone", "mainland"
    return True, "goods", "mainland", "designated_zone"


def _company_entity_type(company_id: str | None) -> str:
    if not company_id:
        return "mainland"
    try:
        from app.services.gulftax_sync_service import _fetch_company_config

        cfg = _fetch_company_config(company_id)
        return str(cfg.get("entity_type") or "mainland")
    except Exception:
        return "mainland"


def _sum_approved_bad_debt_relief(
    db: Session,
    *,
    tenant_id: str,
    company_id: str | None,
    period: str,
) -> float:
    if not company_id:
        return 0.0

    rows = (
        db.query(BadDebtReliefClaim)
        .filter(
            BadDebtReliefClaim.tenant_id == tenant_id,
            BadDebtReliefClaim.company_id == company_id,
            BadDebtReliefClaim.status == "approved",
            BadDebtReliefClaim.eligible.is_(True),
        )
        .all()
    )
    total = 0.0
    for row in rows:
        claim_period = row.claim_period
        if not claim_period and row.extra:
            claim_period = row.extra.get("claim_period") or row.extra.get("vat_return_period")
        if claim_period != period:
            continue
        total += float(row.vat_amount or 0)
    return round(total, 2)


def _apply_dz_to_boxes(
    boxes: dict[str, float],
    *,
    gross: float,
    vat: float,
    net: float,
    direction: str,
    dz: DesignatedZoneResult,
) -> None:
    """Apply designated zone treatment into running box totals."""
    if dz.outside_scope:
        return

    is_output = (direction or "input").lower() == "output"

    if dz.vat_treatment.startswith("Import"):
        boxes["box6_imports_vat"] = round(boxes.get("box6_imports_vat", 0.0) + vat, 2)
        if is_output:
            boxes["box3_reverse_charge_supplies_net"] = round(
                boxes.get("box3_reverse_charge_supplies_net", 0.0) + net, 2
            )
            boxes["box3_reverse_charge_supplies_vat"] = round(
                boxes.get("box3_reverse_charge_supplies_vat", 0.0) + vat, 2
            )
        else:
            boxes["box9_standard_rated_expenses"] = round(
                boxes.get("box9_standard_rated_expenses", 0.0) + net, 2
            )
            boxes["box11_recoverable_input_vat"] = round(
                boxes.get("box11_recoverable_input_vat", 0.0) + vat, 2
            )
        return

    if dz.vat_treatment.startswith("Export"):
        if is_output:
            boxes["box4_zero_rated_supplies"] = round(
                boxes.get("box4_zero_rated_supplies", 0.0) + net, 2
            )
            boxes["box3_reverse_charge_supplies_net"] = round(
                boxes.get("box3_reverse_charge_supplies_net", 0.0) + net, 2
            )
        else:
            boxes["box10_reverse_charge_expenses"] = round(
                boxes.get("box10_reverse_charge_expenses", 0.0) + net, 2
            )
        return

    # Standard — fall through to default box mapping
    if is_output:
        boxes["box1_standard_rated_sales_net"] = round(
            boxes.get("box1_standard_rated_sales_net", 0.0) + net, 2
        )
        boxes["box1_standard_rated_sales_vat"] = round(
            boxes.get("box1_standard_rated_sales_vat", 0.0) + vat, 2
        )
    else:
        boxes["box9_standard_rated_expenses"] = round(
            boxes.get("box9_standard_rated_expenses", 0.0) + net, 2
        )
        boxes["box11_recoverable_input_vat"] = round(
            boxes.get("box11_recoverable_input_vat", 0.0) + vat, 2
        )


def _default_box_mapping(
    boxes: dict[str, float],
    *,
    gross: float,
    vat: float,
    net: float,
    direction: str,
    fta_box: str,
) -> None:
    box = (fta_box or "box9").lower()
    is_output = (direction or "input").lower() == "output"

    if is_output:
        if box in ("box1",):
            boxes["box1_standard_rated_sales_net"] = round(
                boxes.get("box1_standard_rated_sales_net", 0.0) + net, 2
            )
            boxes["box1_standard_rated_sales_vat"] = round(
                boxes.get("box1_standard_rated_sales_vat", 0.0) + vat, 2
            )
        elif box in ("box3",):
            boxes["box3_reverse_charge_supplies_net"] = round(
                boxes.get("box3_reverse_charge_supplies_net", 0.0) + net, 2
            )
            boxes["box3_reverse_charge_supplies_vat"] = round(
                boxes.get("box3_reverse_charge_supplies_vat", 0.0) + vat, 2
            )
        elif box in ("box4", "box5"):
            key = "box4_zero_rated_supplies" if box == "box4" else "box5_exempt_supplies"
            boxes[key] = round(boxes.get(key, 0.0) + net, 2)
    else:
        if box in ("box9",):
            boxes["box9_standard_rated_expenses"] = round(
                boxes.get("box9_standard_rated_expenses", 0.0) + net, 2
            )
            boxes["box11_recoverable_input_vat"] = round(
                boxes.get("box11_recoverable_input_vat", 0.0) + vat, 2
            )
        elif box in ("box10",):
            boxes["box10_reverse_charge_expenses"] = round(
                boxes.get("box10_reverse_charge_expenses", 0.0) + net, 2
            )
            boxes["box11_recoverable_input_vat"] = round(
                boxes.get("box11_recoverable_input_vat", 0.0) + vat, 2
            )


def _aggregate_rds_gulftax_transactions(
    db: Session,
    *,
    tenant_id: str,
    company_id: str,
    tax_period: str,
) -> dict[str, Any]:
    rows = (
        db.query(GulftaxTransaction)
        .filter(
            GulftaxTransaction.tenant_id == tenant_id,
            GulftaxTransaction.company_id == company_id,
            GulftaxTransaction.tax_period == tax_period,
            GulftaxTransaction.status == "posted",
        )
        .order_by(GulftaxTransaction.transaction_date.desc())
        .all()
    )

    boxes: dict[str, float] = {
        "box1_standard_rated_sales_net": 0.0,
        "box1_standard_rated_sales_vat": 0.0,
        "box3_reverse_charge_supplies_net": 0.0,
        "box3_reverse_charge_supplies_vat": 0.0,
        "box4_zero_rated_supplies": 0.0,
        "box5_exempt_supplies": 0.0,
        "box6_imports_vat": 0.0,
        "box9_standard_rated_expenses": 0.0,
        "box10_reverse_charge_expenses": 0.0,
        "box11_recoverable_input_vat": 0.0,
    }
    entries: list[dict[str, Any]] = []
    ap_count = 0

    for tx in rows:
        gross = float(tx.gross_amount or 0)
        vat = float(tx.vat_amount or 0)
        net = round(gross - vat, 2)
        direction = tx.direction or "input"
        kind = tx.transaction_kind or "goods"

        entry = {
            "id": tx.id,
            "invoice_number": tx.invoice_number,
            "vendor_name": tx.vendor_name,
            "gross_amount": gross,
            "vat_amount": vat,
            "direction": direction,
            "source": tx.source,
            "designated_zone": bool(tx.designated_zone),
        }
        entries.append(entry)

        if tx.source == "ap_invoiceflow":
            ap_count += 1

        if tx.designated_zone and kind == "goods":
            supplier = tx.dz_supplier_location or "mainland"
            customer = tx.dz_customer_location or "mainland"
            dz = evaluate_designated_zone(
                supplier_location=supplier,
                customer_location=customer,
                transaction_type=kind,
            )
            _apply_dz_to_boxes(
                boxes,
                gross=gross,
                vat=vat,
                net=net,
                direction=direction,
                dz=dz,
            )
            continue

        _default_box_mapping(
            boxes,
            gross=gross,
            vat=vat,
            net=net,
            direction=direction,
            fta_box=tx.fta_box or "box9",
        )

    return {
        "entry_count": len(rows),
        "ap_invoiceflow_count": ap_count,
        "transaction_count": len(rows),
        "boxes": boxes,
        "entries": entries,
    }


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
    """Merge sales (UAE AR) + purchases (RDS/Supabase gulftax_transactions) + advanced VAT."""
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

    gt_entries: list[dict[str, Any]] = []
    gt_summary: dict[str, Any] = {}
    rds_agg: dict[str, Any] | None = None

    if company_id:
        try:
            rds_agg = _aggregate_rds_gulftax_transactions(
                db,
                tenant_id=tenant_id,
                company_id=company_id,
                tax_period=period,
            )
        except Exception:
            rds_agg = None

        if rds_agg and rds_agg.get("transaction_count", 0) > 0:
            rb = rds_agg["boxes"]
            gt_entries = rds_agg.get("entries") or []
            gt_summary = {
                "transaction_count": rds_agg["transaction_count"],
                "ap_invoiceflow_count": rds_agg.get("ap_invoiceflow_count", 0),
            }
            purchases = {
                **purchases,
                "entry_count": rds_agg["entry_count"],
                "box9_standard_rated_expenses": rb["box9_standard_rated_expenses"],
                "box10_reverse_charge_imports": rb["box10_reverse_charge_expenses"],
                "box11_recoverable_input_vat": rb["box11_recoverable_input_vat"],
            }
            sales["box1_standard_rated_sales_net"] = round(
                sales["box1_standard_rated_sales_net"] + rb["box1_standard_rated_sales_net"], 2
            )
            sales["box1_standard_rated_sales_vat"] = round(
                sales["box1_standard_rated_sales_vat"] + rb["box1_standard_rated_sales_vat"], 2
            )
            sales["box3_reverse_charge_supplies_net"] = round(
                sales["box3_reverse_charge_supplies_net"] + rb["box3_reverse_charge_supplies_net"], 2
            )
            sales["box3_reverse_charge_supplies_vat"] = round(
                sales["box3_reverse_charge_supplies_vat"] + rb["box3_reverse_charge_supplies_vat"], 2
            )
            sales["box4_zero_rated_supplies"] = round(
                sales["box4_zero_rated_supplies"] + rb["box4_zero_rated_supplies"], 2
            )
            sales["box6_imports_vat"] = round(
                sales["box6_imports_vat"] + rb["box6_imports_vat"], 2
            )
        else:
            try:
                from app.services.gulftax_sync_service import aggregate_vat_return_summary, list_transactions

                gt_summary = aggregate_vat_return_summary(company_id, period)
                if gt_summary.get("transaction_count", 0) > 0:
                    purchases = {
                        **purchases,
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

    entries = (gt_entries if gt_entries else purchases.get("entries")) or []
    box9_net = float(purchases.get("box9_standard_rated_expenses") or 0)
    box10_net = float(purchases.get("box10_reverse_charge_expenses") or purchases.get("box10_reverse_charge_imports") or 0)
    box11_raw = float(purchases.get("box11_recoverable_input_vat") or 0)

    pe_adj = calculate_partial_exemption_adjustment(
        db,
        tenant_id=tenant_id,
        company_id=company_id,
        period=period,
    )
    box11_vat = box11_raw
    if pe_adj["partial_exemption_applied"] and pe_adj["recovery_percentage"] > 0:
        box11_vat = round(box11_raw * (pe_adj["recovery_percentage"] / 100.0), 2)

    bad_debt_applied = _sum_approved_bad_debt_relief(
        db,
        tenant_id=tenant_id,
        company_id=company_id,
        period=period,
    )
    box7_adjustments = float(sales["box7_output_adjustments"]) - bad_debt_applied

    box2_advance_vat = float(advances.get("advance_payment_vat_total") or 0)
    box2_tourist = sales["box2_tourist_refunds"]
    box2_combined = round(box2_tourist + box2_advance_vat, 2)

    box8 = round(
        sales["box1_standard_rated_sales_vat"]
        + box2_combined
        + sales["box3_reverse_charge_supplies_vat"]
        + sales["box6_imports_vat"]
        + box7_adjustments,
        2,
    )
    box12 = round(box8 - box11_vat, 2)

    using_rds = bool(rds_agg and rds_agg.get("transaction_count", 0) > 0)

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
        "box7_output_adjustments": round(box7_adjustments, 2),
        "box8_total_output_vat": box8,
        "box9_standard_rated_expenses": box9_net,
        "box10_reverse_charge_expenses": box10_net,
        "box11_total_input_vat": box11_vat,
        "box11_total_input_vat_raw": box11_raw,
        "box12_net_vat_payable_or_refundable": box12,
        "payable": box12 > 0,
        "refundable": box12 < 0,
        "partial_exemption_applied": pe_adj["partial_exemption_applied"],
        "recovery_percentage": pe_adj["recovery_percentage"],
        "bad_debt_relief_applied": bad_debt_applied,
        "sales_invoice_count": sales["sales_invoice_count"],
        "purchase_entry_count": purchases.get("entry_count", 0),
        "advance_payment_count": advances.get("advance_payment_count", 0),
        "advance_payments_included": advances.get("advance_payments", []),
        "entries": entries,
        "ap_invoiceflow_count": (
            gt_summary.get("ap_invoiceflow_count", 0) if using_rds and company_id else 0
        ),
        "source": "gulftax_transactions" if using_rds or gt_summary.get("transaction_count") else "vat_return_entries",
    }
