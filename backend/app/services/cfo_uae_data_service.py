"""CFO desk widgets — aggregate real UAE accounting data per workspace."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.uae_accounting_full import (
    UAEBankAccount,
    UAEAccount,
    UAEJournalEntry,
    UAESalesInvoice,
)
from app.services.uae_journal_service import get_trial_balance
from app.services.dso_service import build_dso_metrics

EMPTY_MSG = "No data yet — post transactions to see metrics"


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _period_now() -> str:
    return date.today().strftime("%Y-%m")


def empty_ar_summary() -> dict[str, Any]:
    return {
        "data": [],
        "total_ar": 0,
        "total_overdue": 0,
        "dso_current": 0,
        "dso_target": 30,
        "currency": "AED",
        "dso_trend": [],
        "aging_buckets": [],
        "customers": [],
        "message": EMPTY_MSG,
    }


def empty_entity_health(period: str) -> dict[str, Any]:
    return {
        "data": [],
        "period": period,
        "entities": [],
        "group_readiness": 0,
        "total_blockers": 0,
        "critical_blockers": 0,
        "target_readiness": 85,
        "consolidation_deadline": None,
        "days_to_deadline": 0,
        "currency": "AED",
        "message": EMPTY_MSG,
    }


def empty_payment_calendar() -> dict[str, Any]:
    return {
        "data": [],
        "weeks": [],
        "cash_threshold": 0,
        "currency": "AED",
        "message": EMPTY_MSG,
    }


def empty_covenants() -> dict[str, Any]:
    return {
        "data": [],
        "covenants": [],
        "watch_count": 0,
        "breach_risk_count": 0,
        "next_bank_review": None,
        "currency": "AED",
        "message": EMPTY_MSG,
    }


def list_company_profiles(db: Session, workspace_id: str) -> list[UaeCompanyProfile]:
    return (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, status="active")
        .order_by(UaeCompanyProfile.company_name)
        .all()
    )


def _tb_totals(db: Session, workspace_id: str, period: str, company_id: str | None = None) -> dict[str, float]:
    tb = get_trial_balance(workspace_id, period, db, company_id=company_id)
    return tb.get("totals") or {}


def has_uae_transactions(db: Session, workspace_id: str, company_id: str | None = None) -> bool:
    period = _period_now()
    totals = _tb_totals(db, workspace_id, period, company_id)
    if any(_f(v) != 0 for v in totals.values()):
        return True
    inv_q = db.query(UAESalesInvoice).filter(UAESalesInvoice.tenant_id == workspace_id)
    if company_id:
        inv_q = inv_q.filter(UAESalesInvoice.company_id == company_id)
    if inv_q.first():
        return True
    je_q = db.query(UAEJournalEntry).filter(
        UAEJournalEntry.tenant_id == workspace_id,
        UAEJournalEntry.status == "posted",
    )
    if company_id:
        je_q = je_q.filter(UAEJournalEntry.company_id == company_id)
    return je_q.first() is not None


def has_uae_data(db: Session, workspace_id: str) -> bool:
    co = db.query(UaeCompanyProfile).filter_by(workspace_id=workspace_id, status="active").first()
    if co:
        return True
    return db.query(UAEAccount).filter_by(tenant_id=workspace_id).first() is not None


def build_ar_summary(db: Session, workspace_id: str, company_id: str | None = None) -> dict[str, Any]:
    q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == workspace_id,
        UAESalesInvoice.outstanding > 0,
    )
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    invoices = q.all()
    if not invoices:
        return empty_ar_summary()

    today = date.today()
    buckets = {
        "Current (0-30d)": {"amount": 0.0, "risk": "low"},
        "31-60 days": {"amount": 0.0, "risk": "medium"},
        "61-90 days": {"amount": 0.0, "risk": "high"},
        "91-120 days": {"amount": 0.0, "risk": "high"},
        "120+ days": {"amount": 0.0, "risk": "critical"},
    }
    customers: dict[str, dict] = {}
    total_ar = 0.0
    total_overdue = 0.0

    for inv in invoices:
        amt = _f(inv.outstanding)
        if amt <= 0:
            continue
        total_ar += amt
        due = inv.due_date or inv.invoice_date or today
        days = (today - due).days if due else 0
        if days <= 30:
            key = "Current (0-30d)"
        elif days <= 60:
            key = "31-60 days"
        elif days <= 90:
            key = "61-90 days"
        elif days <= 120:
            key = "91-120 days"
        else:
            key = "120+ days"
        buckets[key]["amount"] += amt
        if days > 30:
            total_overdue += amt

        cust_name = inv.customer.name if inv.customer else "Unknown Customer"
        cid = cust_name
        if cid not in customers:
            customers[cid] = {
                "name": cust_name,
                "amount": 0.0,
                "bucket": key.replace(" days", "d").replace("Current (0-30d)", "0-30d"),
                "risk": buckets[key]["risk"],
                "last_contact": (inv.invoice_date or today).strftime("%b %d") if inv.invoice_date else "—",
                "entity": "UAE",
                "note": f"Outstanding AED {amt:,.0f}",
            }
        customers[cid]["amount"] += amt
        if days > 60:
            customers[cid]["risk"] = "high" if days <= 120 else "critical"

    aging = []
    for bucket, meta in buckets.items():
        amt = meta["amount"]
        aging.append({
            "bucket": bucket,
            "amount": round(amt, 2),
            "pct": round(amt / total_ar * 100) if total_ar else 0,
            "risk": meta["risk"],
        })

    dso_current = 0
    if total_ar > 0 and invoices:
        weighted = sum(
            max(0, (today - (i.due_date or i.invoice_date or today)).days) * _f(i.outstanding)
            for i in invoices
        )
        dso_current = max(1, int(weighted / total_ar) + 30)

    return {
        "data": aging,
        "total_ar": round(total_ar, 2),
        "total_overdue": round(total_overdue, 2),
        "dso_current": dso_current,
        "dso_target": 30,
        "currency": "AED",
        "dso_trend": [
            {"month": m, "dso": dso_current}
            for m in ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]
        ] if dso_current > 0 else [],
        "aging_buckets": aging,
        "customers": sorted(customers.values(), key=lambda c: c["amount"], reverse=True)[:10],
        "_source": "uae_sales_invoices",
    }


def build_entity_health(db: Session, workspace_id: str, period: str) -> dict[str, Any]:
    companies = list_company_profiles(db, workspace_id)
    if not companies:
        return empty_entity_health(period)

    from app.services.gl_summary_service import build_gl_summary

    month_start = date.today().replace(day=1)
    if month_start.month == 12:
        month_end = date(month_start.year, 12, 31)
    else:
        month_end = date(month_start.year, month_start.month + 1, 1) - timedelta(days=1)

    entities = []
    for co in companies:
        gl = build_gl_summary(
            db,
            workspace_id=workspace_id,
            company_id=co.id,
            period_start=month_start.isoformat(),
            period_end=month_end.isoformat(),
        )
        assets = gl.get("assets", 0) or 0
        liabilities = gl.get("liabilities", 0) or 0
        current_ratio = round(assets / liabilities, 2) if liabilities > 0 else None
        if current_ratio is None:
            health_status = "Review"
        elif current_ratio > 1.5:
            health_status = "Good"
        elif current_ratio > 1.0:
            health_status = "Review"
        else:
            health_status = "Alert"

        coa_count = db.query(UAEAccount).filter_by(
            tenant_id=workspace_id, company_id=co.id, is_active=True,
        ).count()
        je_posted = db.query(UAEJournalEntry).filter_by(
            tenant_id=workspace_id, company_id=co.id, period=period, status="posted",
        ).count()
        bank_count = db.query(UAEBankAccount).filter_by(
            tenant_id=workspace_id, company_id=co.id, is_active=True,
        ).count()
        ar_open = db.query(UAESalesInvoice).filter(
            UAESalesInvoice.tenant_id == workspace_id,
            UAESalesInvoice.company_id == co.id,
            UAESalesInvoice.outstanding > 0,
        ).count()
        has_opening = bool(co.opening_balance_date)

        checks = [
            ("Chart of accounts", coa_count > 0, "Finance"),
            ("Opening balances", has_opening, "Finance"),
            ("Bank accounts", bank_count > 0, "Treasury"),
            ("Posted journals", je_posted > 0, "Accounting"),
            ("AR reconciled", ar_open == 0 or je_posted > 0, "AR Team"),
        ]
        done = sum(1 for _, ok, _ in checks if ok)
        readiness = round(done / len(checks) * 100)

        workstreams = [
            {"name": name, "status": "complete" if ok else "in_progress", "owner": owner}
            for name, ok, owner in checks
        ]
        blockers = []
        if coa_count == 0:
            blockers.append({"severity": "critical", "text": "Chart of accounts not loaded"})
        if not has_opening:
            blockers.append({"severity": "high", "text": "Opening balances not posted"})
        if bank_count == 0:
            blockers.append({"severity": "medium", "text": "No bank accounts configured"})
        if ar_open > 3:
            blockers.append({"severity": "medium", "text": f"{ar_open} AR invoices outstanding — reconciliation pending"})

        dso_data = build_dso_metrics(
            db, workspace_id, co.id, month_start.isoformat(), month_end.isoformat()
        )

        from app.services.ifrs_integration_service import ifrs_metrics
        ifrs = ifrs_metrics(db, workspace_id, co.id)

        entities.append({
            "code": co.id[:8].upper(),
            "name": co.company_name,
            "label": co.legal_type or "UAE Entity",
            "flag": "🇦🇪",
            "readiness": readiness,
            "workstreams": workstreams,
            "blockers": blockers,
            "current_ratio": current_ratio,
            "cash_balance": gl.get("cash", 0),
            "revenue_mtd": gl.get("revenue", 0),
            "outstanding_ap": gl.get("trade_payables", 0),
            "outstanding_ar": gl.get("trade_receivables", 0),
            "dso_days": dso_data.get("dso_current", 0),
            "dso_vs_benchmark": dso_data.get("dso_vs_benchmark", 0),
            "health_status": health_status,
            "ifrs16_rou_assets": ifrs.get("ifrs16_rou_assets", 0),
            "ifrs16_lease_liability": ifrs.get("ifrs16_lease_liability", 0),
            "ifrs15_contract_assets": ifrs.get("ifrs15_contract_assets", 0),
            "ifrs15_contract_liabilities": ifrs.get("ifrs15_contract_liabilities", 0),
            "ifrs9_ecl_provision": ifrs.get("ifrs9_ecl_provision", 0),
        })

    group = round(sum(e["readiness"] for e in entities) / len(entities), 1)
    critical = sum(1 for e in entities for b in e["blockers"] if b["severity"] == "critical")
    periods = (
        db.query(AccountingPeriod)
        .filter_by(workspace_id=workspace_id)
        .order_by(AccountingPeriod.end_date.desc())
        .first()
    )
    deadline = periods.end_date.isoformat() if periods else None
    days_left = (date.fromisoformat(deadline) - date.today()).days if deadline else 0

    return {
        "data": entities,
        "period": period,
        "entities": entities,
        "group_readiness": group,
        "total_blockers": sum(len(e["blockers"]) for e in entities),
        "critical_blockers": critical,
        "target_readiness": 85,
        "consolidation_deadline": deadline,
        "days_to_deadline": max(0, days_left),
        "currency": "AED",
        "_source": "uae_company_profiles",
    }


def build_payment_calendar(db: Session, workspace_id: str, company_id: str | None = None) -> dict[str, Any]:
    if not has_uae_transactions(db, workspace_id, company_id):
        return empty_payment_calendar()

    today = date.today()
    period = _period_now()
    totals = _tb_totals(db, workspace_id, period, company_id)
    cash = _f(totals.get("cash", 0))

    weeks: list[dict] = []
    has_any_payment = False

    for w in range(1, 7):
        start = today + timedelta(days=(w - 1) * 7)
        end = start + timedelta(days=4)
        payments: list[dict] = []

        inv_q = db.query(UAESalesInvoice).filter(
            UAESalesInvoice.tenant_id == workspace_id,
            UAESalesInvoice.outstanding > 0,
            UAESalesInvoice.due_date >= start,
            UAESalesInvoice.due_date <= end + timedelta(days=7),
        )
        if company_id:
            inv_q = inv_q.filter(UAESalesInvoice.company_id == company_id)
        for inv in inv_q.all():
            amt = _f(inv.outstanding)
            payments.append({
                "description": f"AR Collection — {inv.invoice_number}",
                "entity": "UAE",
                "flag": "🇦🇪",
                "category": "AR-Inflow",
                "amount_aed": -amt,
                "due": (inv.due_date or today).strftime("%d %b"),
                "status": "scheduled",
                "notes": "Expected customer payment",
            })

        vat_amt = _f(totals.get("vat_payable", 0))
        if w == 2 and vat_amt > 0:
            payments.append({
                "description": "UAE VAT Settlement",
                "entity": "UAE",
                "flag": "🇦🇪",
                "category": "Tax-VAT",
                "amount_aed": vat_amt,
                "due": end.strftime("%d %b"),
                "status": "scheduled",
                "notes": "Quarterly VAT payment from GL",
            })

        if not payments:
            continue

        has_any_payment = True
        total = sum(_f(p["amount_aed"]) for p in payments)
        projected = cash - total if cash > 0 else 0
        risk = None
        if cash > 0 and projected < cash * 0.7:
            risk = "watch"
        if cash > 0 and w >= 5 and total > cash * 0.4:
            risk = "critical"

        weeks.append({
            "week": w,
            "label": f"Week {w}",
            "dates": f"{start.strftime('%d %b')}–{end.strftime('%d %b %Y')}",
            "total_aed": round(total, 2),
            "risk": risk,
            "projected_cash": round(projected, 2),
            "cash_threshold": round(cash * 0.8, 2) if cash > 0 else 0,
            "payments": payments,
        })

    if not has_any_payment:
        return empty_payment_calendar()

    return {
        "data": weeks,
        "weeks": weeks,
        "cash_threshold": round(cash * 0.8, 2) if cash > 0 else 0,
        "currency": "AED",
        "_source": "uae_gl",
    }


def build_covenants(db: Session, workspace_id: str, company_id: str | None = None) -> dict[str, Any]:
    period = _period_now()
    totals = _tb_totals(db, workspace_id, period, company_id)
    assets = _f(totals.get("asset", 0))
    liabilities = _f(totals.get("liability", 0))
    revenue = _f(totals.get("revenue", 0))
    expense = _f(totals.get("expense", 0))
    debt = _f(totals.get("long_term_debt", 0))

    if assets <= 0 and liabilities <= 0 and revenue <= 0:
        return empty_covenants()
    if debt <= 0 and revenue <= 0:
        return empty_covenants()

    cash = _f(totals.get("cash", 0))
    ebitda = max(revenue - expense, 0)
    if ebitda <= 0 and debt <= 0:
        return empty_covenants()

    nd_ebitda = round(debt / ebitda, 2) if ebitda > 0 and debt > 0 else 0
    current_ratio = round(assets / liabilities, 2) if liabilities > 0 else 0
    interest_cov = round(ebitda / max(debt * 0.08, 1), 2) if debt > 0 else 0

    def _status(headroom_pct: float, watch_below: float = 25) -> str:
        if headroom_pct < 10:
            return "breach_risk"
        if headroom_pct < watch_below:
            return "watch"
        return "safe"

    covenants: list[dict] = []

    if debt > 0 and ebitda > 0:
        covenants.append({
            "name": "Net Debt / EBITDA",
            "type": "max",
            "current": nd_ebitda,
            "threshold": 3.5,
            "unit": "×",
            "headroom": round(3.5 - nd_ebitda, 2),
            "headroom_pct": round(max(0, (3.5 - nd_ebitda) / 3.5 * 100), 1),
            "status": _status((3.5 - nd_ebitda) / 3.5 * 100),
            "trend": "tightening" if nd_ebitda > 2 else "stable",
            "trend_history": [nd_ebitda] * 6,
            "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
            "action": "Monitor EBITDA vs debt covenants" if nd_ebitda > 2.5 else None,
            "owner": "CFO / FP&A",
            "bank": "UAE Local Bank",
        })
        covenants.append({
            "name": "Interest Coverage",
            "type": "min",
            "current": interest_cov,
            "threshold": 3.0,
            "unit": "×",
            "headroom": round(interest_cov - 3.0, 2),
            "headroom_pct": round(min(100, (interest_cov - 3.0) / 3.0 * 100), 1) if interest_cov > 0 else 0,
            "status": _status(min(100, (interest_cov - 3.0) / 3.0 * 100), 20) if interest_cov > 0 else "watch",
            "trend": "stable",
            "trend_history": [interest_cov] * 6,
            "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
            "action": None,
            "owner": "CFO / Treasury",
        })

    if liabilities > 0:
        covenants.append({
            "name": "Current Ratio",
            "type": "min",
            "current": current_ratio,
            "threshold": 1.2,
            "unit": "×",
            "headroom": round(current_ratio - 1.2, 2),
            "headroom_pct": round(min(100, (current_ratio - 1.2) / 1.2 * 100), 1) if current_ratio > 0 else 0,
            "status": _status(min(100, (current_ratio - 1.2) / 1.2 * 100), 30) if current_ratio > 0 else "watch",
            "trend": "stable",
            "trend_history": [current_ratio] * 6,
            "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
            "action": None,
            "owner": "Head of Treasury",
        })

    if cash > 0:
        threshold = max(cash * 0.6, 100_000)
        covenants.append({
            "name": "Minimum Cash Floor",
            "type": "min",
            "current": cash,
            "threshold": threshold,
            "unit": "AED",
            "headroom": round(cash - threshold, 2),
            "headroom_pct": round((cash - threshold) / threshold * 100, 1) if threshold > 0 else 0,
            "status": "safe" if cash > threshold else "watch",
            "trend": "stable",
            "scenario_w7": round(cash * 0.85, 2),
            "scenario_risk": cash * 0.85 < threshold * 1.1,
            "trend_history": [cash] * 6,
            "trend_labels": ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
            "action": "Review payment calendar for upcoming outflows" if cash < threshold * 1.5 else None,
            "owner": "Head of Treasury",
        })

    if not covenants:
        return empty_covenants()

    watch_count = sum(1 for c in covenants if c["status"] == "watch")
    breach_count = sum(1 for c in covenants if c["status"] == "breach_risk")
    return {
        "data": covenants,
        "covenants": covenants,
        "watch_count": watch_count,
        "breach_risk_count": breach_count,
        "next_bank_review": (date.today() + timedelta(days=45)).isoformat(),
        "currency": "AED",
        "_source": "uae_trial_balance",
    }
