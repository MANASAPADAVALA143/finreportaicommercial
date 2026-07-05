"""UAE Corporate Tax return service — GL trial balance → ct_returns on RDS."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.client_data import CtReturn
from app.models.uae_account_classification import UAEAccountClassification
from app.modules.gulftax.ported.services.corporate_tax_service import compute_ct
from app.services.gulftax_sync_service import _fetch_company_config
from app.services.uae_journal_service import get_trial_balance

SBR_REVENUE_CAP = 3_000_000
CT_ZERO_BAND = 375_000

ADD_BACK_RULES: dict[str, tuple[float, str]] = {
    "entertainment": (0.5, "UAE CT Law Art. 32"),
    "fines": (1.0, "UAE CT Law Art. 33"),
    "penalties": (1.0, "UAE CT Law Art. 33"),
    "non-deductible": (1.0, "UAE CT Law Art. 28"),
    "non-business": (1.0, "UAE CT Law Art. 28"),
    "capital": (1.0, "UAE CT Law Art. 28"),
}

EXEMPT_RULES: dict[str, str] = {
    "exempt dividend": "UAE CT Law Art. 23",
    "dividends from uae subsidiaries": "UAE CT Law Art. 23",
    "qualifying capital gain": "UAE CT Law Art. 23",
    "qualifying capital gains": "UAE CT Law Art. 23",
    "qfzp qualifying income": "UAE CT Law Art. 18",
}

CIT_TARGET_CATEGORIES = frozenset(ADD_BACK_RULES) | frozenset(EXEMPT_RULES)


def _norm_category(value: str | None) -> str:
    return (value or "").strip().lower()


def _month_periods(period_start: date, period_end: date) -> list[str]:
    """YYYY-MM keys covering [period_start, period_end]."""
    keys: list[str] = []
    y, m = period_start.year, period_start.month
    end_y, end_m = period_end.year, period_end.month
    while (y, m) <= (end_y, end_m):
        keys.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return keys


def _merge_trial_balances(tbs: list[dict]) -> dict:
    """Sum trial balance lines and totals across monthly periods."""
    if not tbs:
        return {
            "period": "",
            "lines": [],
            "total_debits": 0.0,
            "total_credits": 0.0,
            "is_balanced": True,
            "totals": {
                "asset": 0.0,
                "liability": 0.0,
                "equity": 0.0,
                "income": 0.0,
                "expense": 0.0,
                "revenue": 0.0,
                "cash": 0.0,
                "trade_payables": 0.0,
                "vat_payable": 0.0,
                "long_term_debt": 0.0,
            },
        }
    if len(tbs) == 1:
        return tbs[0]

    accounts: dict[str, dict] = {}
    totals: dict[str, float] = dict(tbs[0].get("totals", {}))
    for key in totals:
        totals[key] = 0.0

    for tb in tbs:
        for line in tb.get("lines", []):
            code = line["account_code"]
            if code not in accounts:
                accounts[code] = {
                    "account_code": code,
                    "account_name": line.get("account_name", ""),
                    "debit": 0.0,
                    "credit": 0.0,
                }
            accounts[code]["debit"] += float(line.get("debit", 0))
            accounts[code]["credit"] += float(line.get("credit", 0))
        for k, v in tb.get("totals", {}).items():
            totals[k] = totals.get(k, 0.0) + float(v)

    lines_out = list(accounts.values())
    for line in lines_out:
        line["net_balance"] = line["debit"] - line["credit"]

    total_dr = sum(line["debit"] for line in lines_out)
    total_cr = sum(line["credit"] for line in lines_out)
    return {
        "period": f"{tbs[0].get('period', '')}..{tbs[-1].get('period', '')}",
        "lines": lines_out,
        "total_debits": total_dr,
        "total_credits": total_cr,
        "is_balanced": abs(total_dr - total_cr) < 0.01,
        "totals": totals,
    }


def _gl_totals(tb: dict) -> dict[str, float]:
    totals = tb.get("totals", {})
    revenue = float(totals.get("revenue", 0))
    expense = float(totals.get("expense", 0))
    lines = tb.get("lines", [])
    cogs = sum(line.get("net_balance", 0) for line in lines if line["account_code"].startswith("70"))
    opex = sum(
        line.get("net_balance", 0)
        for line in lines
        if line["account_code"].startswith("71") and not line["account_code"].startswith("717")
    )
    finance = sum(line.get("net_balance", 0) for line in lines if line["account_code"].startswith("717"))
    return {
        "revenue": revenue,
        "cogs": cogs,
        "opex": opex,
        "finance": finance,
        "expense": expense,
        "gross_profit": revenue - cogs,
        "net_profit": revenue - expense,
    }


def _load_classifications(
    db: Session,
    tenant_id: str,
    company_id: str | None,
) -> dict[str, UAEAccountClassification]:
    try:
        q = db.query(UAEAccountClassification).filter(
            UAEAccountClassification.workspace_id == tenant_id,
        )
        if company_id:
            q = q.filter(UAEAccountClassification.company_id == company_id)
        rows = q.all()
    except Exception:
        db.rollback()
        return {}

    selected: dict[str, UAEAccountClassification] = {}
    for row in rows:
        cat = _norm_category(row.cit_category)
        if row.cit_add_back or cat in CIT_TARGET_CATEGORIES:
            selected[row.account_code] = row
    return selected


def _compute_adjustments(
    db: Session,
    tenant_id: str,
    company_id: str | None,
    tb_lines: list[dict],
    *,
    qfzp_eligible: bool,
    net_profit: float,
) -> dict[str, Any]:
    """Return per-line add-backs and exempt deductions with totals."""
    classifications = _load_classifications(db, tenant_id, company_id)
    adjustments: list[dict[str, Any]] = []
    total_add_backs = 0.0
    total_exempt = 0.0
    qfzp_from_accounts = 0.0
    has_qfzp_accounts = False

    for line in tb_lines:
        code = line.get("account_code", "")
        row = classifications.get(code)
        if not row:
            continue

        cat = _norm_category(row.cit_category)
        net_balance = float(line.get("net_balance", 0))
        account_name = line.get("account_name") or row.account_name or code

        if cat in EXEMPT_RULES:
            gross = abs(net_balance) if net_balance != 0 else 0.0
            if gross <= 0:
                continue
            if cat == "qfzp qualifying income":
                has_qfzp_accounts = True
                qfzp_from_accounts += gross
                if qfzp_eligible:
                    adjustments.append({
                        "type": "exempt_deduction",
                        "account_code": code,
                        "account_name": account_name,
                        "gross_amount": round(gross, 2),
                        "add_back_pct": None,
                        "add_back_amount": round(gross, 2),
                        "law_reference": EXEMPT_RULES[cat],
                        "cit_category": row.cit_category,
                    })
                continue
            amount = round(gross, 2)
            total_exempt += amount
            adjustments.append({
                "type": "exempt_deduction",
                "account_code": code,
                "account_name": account_name,
                "gross_amount": amount,
                "add_back_pct": None,
                "add_back_amount": amount,
                "law_reference": EXEMPT_RULES[cat],
                "cit_category": row.cit_category,
            })
            continue

        pct: float | None = None
        law_ref = "UAE CT Law Art. 28"
        if cat in ADD_BACK_RULES:
            pct, law_ref = ADD_BACK_RULES[cat]
        elif row.cit_add_back:
            pct = 1.0
        else:
            continue

        gross = max(0.0, net_balance)
        if gross <= 0:
            continue
        add_back_amount = round(gross * pct, 2)
        total_add_backs += add_back_amount
        adjustments.append({
            "type": "add_back",
            "account_code": code,
            "account_name": account_name,
            "gross_amount": round(gross, 2),
            "add_back_pct": pct,
            "add_back_amount": add_back_amount,
            "law_reference": law_ref,
            "cit_category": row.cit_category,
        })

    qfzp_qualifying_income: float | None = None
    if qfzp_eligible:
        if has_qfzp_accounts:
            qfzp_qualifying_income = round(qfzp_from_accounts, 2)
        else:
            qfzp_qualifying_income = round(net_profit, 2)

    return {
        "adjustments": adjustments,
        "total_add_backs": round(total_add_backs, 2),
        "total_exempt_deductions": round(total_exempt, 2),
        "qfzp_qualifying_income": qfzp_qualifying_income,
    }


def _resolve_free_zone_status(company_id: str | None) -> str:
    """Map company entity_type → mainland | free_zone_qfzp | free_zone_non_qfzp."""
    if not company_id:
        return "mainland"
    cfg = _fetch_company_config(company_id)
    entity = str(cfg.get("entity_type") or "mainland").lower().replace("-", "_")
    is_qfzp = bool(cfg.get("is_qfzp"))
    if entity in ("free_zone_qfzp", "qfzp") or (entity == "free_zone" and is_qfzp):
        return "free_zone_qfzp"
    if entity in ("free_zone", "free_zone_non_qfzp"):
        return "free_zone_non_qfzp"
    return "mainland"


def _aggregate_trial_balance(
    tenant_id: str,
    period_start: date,
    period_end: date,
    db: Session,
    company_id: str | None,
) -> dict:
    periods = _month_periods(period_start, period_end)
    tbs = [get_trial_balance(tenant_id, p, db, company_id=company_id) for p in periods]
    return _merge_trial_balances(tbs)


def _serialize(row: CtReturn) -> dict[str, Any]:
    adjustments = row.adjustments or []
    exempt_total = sum(
        float(a.get("add_back_amount", 0))
        for a in adjustments
        if a.get("type") == "exempt_deduction"
    )
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "company_id": row.company_id,
        "period_start": row.period_start.isoformat() if row.period_start else None,
        "period_end": row.period_end.isoformat() if row.period_end else None,
        "revenue": float(row.revenue or 0),
        "accounting_profit": float(row.accounting_profit or 0),
        "non_deductible_expenses": float(row.non_deductible_expenses or 0),
        "exempt_income_deductions": round(exempt_total, 2),
        "taxable_income": float(row.taxable_income or 0),
        "ct_payable_aed": float(row.ct_payable_aed or 0),
        "sbr_eligible": bool(row.sbr_eligible),
        "sbr_elected": bool(row.sbr_elected),
        "qfzp_eligible": bool(row.qfzp_eligible),
        "free_zone_status": row.free_zone_status,
        "free_zone_income": float(row.free_zone_income or 0),
        "adjustments": adjustments,
        "breakdown": row.breakdown or {},
        "status": row.status,
        "override_reason": row.override_reason,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "filed_at": row.filed_at.isoformat() if row.filed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def generate_ct_return(
    db: Session,
    tenant_id: str,
    company_id: str,
    period_start: date,
    period_end: date,
    *,
    elect_sbr: bool = False,
) -> dict[str, Any]:
    """Pull GL trial balance, compute CT, persist draft ct_returns row."""
    tb = _aggregate_trial_balance(tenant_id, period_start, period_end, db, company_id)
    gl = _gl_totals(tb)
    revenue = gl["revenue"]
    net_profit = gl["net_profit"]
    free_zone_status = _resolve_free_zone_status(company_id)
    qfzp_eligible = free_zone_status == "free_zone_qfzp"
    sbr_eligible = revenue > 0 and revenue <= SBR_REVENUE_CAP and free_zone_status == "mainland"

    adj = _compute_adjustments(
        db,
        tenant_id,
        company_id,
        tb.get("lines", []),
        qfzp_eligible=qfzp_eligible,
        net_profit=net_profit,
    )
    total_add_backs = adj["total_add_backs"]
    exempt_income = adj["total_exempt_deductions"]
    qualifying_income = adj["qfzp_qualifying_income"] if qfzp_eligible else None

    apply_sbr = bool(elect_sbr and sbr_eligible)
    computed = compute_ct(
        accounting_profit=net_profit,
        free_zone_status=free_zone_status,  # type: ignore[arg-type]
        revenue=revenue,
        non_deductible_expenses=total_add_backs,
        exempt_income=exempt_income,
        qualifying_income=qualifying_income,
        small_business_relief=apply_sbr,
    )

    free_zone_income = Decimal("0")
    if qfzp_eligible and qualifying_income is not None:
        free_zone_income = Decimal(str(qualifying_income))
    elif qfzp_eligible:
        for item in computed.get("breakdown", []):
            if "qualifying income" in str(item.get("label", "")).lower():
                free_zone_income = Decimal(str(item.get("amount_aed", 0)))

    breakdown = {
        "gl": gl,
        "trial_balance_periods": _month_periods(period_start, period_end),
        "rate_bands": {
            "zero_band_aed": CT_ZERO_BAND,
            "standard_rate_percent": 9,
            "sbr_revenue_cap_aed": SBR_REVENUE_CAP,
        },
        "computation": computed,
        "adjustments_summary": {
            "total_add_backs": total_add_backs,
            "total_exempt_deductions": exempt_income,
            "qfzp_qualifying_income": qualifying_income,
        },
    }

    row = CtReturn(
        tenant_id=tenant_id,
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
        revenue=Decimal(str(round(revenue, 2))),
        accounting_profit=Decimal(str(round(net_profit, 2))),
        non_deductible_expenses=Decimal(str(total_add_backs)),
        taxable_income=Decimal(str(computed["taxable_income_aed"])),
        ct_payable_aed=Decimal(str(computed["ct_payable_aed"])),
        sbr_eligible=sbr_eligible,
        sbr_elected=apply_sbr,
        qfzp_eligible=qfzp_eligible,
        free_zone_status=free_zone_status,
        free_zone_income=free_zone_income,
        adjustments=adj["adjustments"],
        breakdown=breakdown,
        status="draft",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def get_ct_return(db: Session, return_id: str) -> dict[str, Any] | None:
    row = db.query(CtReturn).filter(CtReturn.id == return_id).first()
    return _serialize(row) if row else None


def list_ct_returns(
    db: Session,
    tenant_id: str,
    company_id: str,
    status: str | None = None,
) -> list[dict[str, Any]]:
    q = db.query(CtReturn).filter(
        CtReturn.tenant_id == tenant_id,
        CtReturn.company_id == company_id,
    )
    if status:
        q = q.filter(CtReturn.status == status)
    rows = q.order_by(CtReturn.created_at.desc()).all()
    return [_serialize(r) for r in rows]


def approve_ct_return(db: Session, return_id: str) -> dict[str, Any]:
    row = db.query(CtReturn).filter(CtReturn.id == return_id).first()
    if not row:
        raise ValueError("CT return not found")
    if row.status != "draft":
        raise ValueError(f"Cannot approve return in status '{row.status}'")
    row.status = "approved"
    row.approved_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _serialize(row)


def file_ct_return(
    db: Session,
    return_id: str,
    override_reason: str | None = None,
) -> dict[str, Any]:
    """Transition approved → filed. Soft gate if still draft unless override_reason supplied."""
    row = db.query(CtReturn).filter(CtReturn.id == return_id).first()
    if not row:
        raise ValueError("CT return not found")
    if row.status == "filed":
        return {
            **_serialize(row),
            "warning": False,
            "message": "Return already filed",
        }
    if row.status != "approved":
        if not override_reason or len(override_reason.strip()) < 3:
            return {
                **_serialize(row),
                "warning": True,
                "blocked": True,
                "message": "Return must be approved before filing. Provide override_reason to file from draft.",
                "requires_approval": True,
            }
        row.override_reason = override_reason.strip()
    row.status = "filed"
    row.filed_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return {
        **_serialize(row),
        "warning": bool(row.override_reason),
        "blocked": False,
        "message": "CT return filed" + (" (override recorded)" if row.override_reason else ""),
    }
