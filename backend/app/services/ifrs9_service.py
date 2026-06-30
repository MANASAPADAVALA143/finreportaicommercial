"""IFRS 9 ECL — staging, calculation, portfolio persistence, JE posting."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.models.ifrs9_ecl import IFRS9Asset, IFRS9Portfolio
from app.modules.ifrs9.ifrs9_ecl_calculator import IFRS9ECLCalculator
from app.modules.ifrs9.ifrs9_staging import IFRS9StagingEngine, LoanStage
from app.services.uae_journal_service import create_journal_entry

PD_12M: dict[str, float] = {
    "AAA": 0.0001, "AA": 0.0005, "A": 0.001, "BBB": 0.005,
    "BB": 0.02, "B": 0.05, "Unrated": 0.01,
}

LGD_DEFAULTS: dict[str, float] = {
    "loans_secured": 0.30, "loans": 0.60, "trade_receivables": 0.50, "bonds": 0.40, "other": 0.50,
}


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _pd_12m(rating: str) -> float:
    return PD_12M.get((rating or "Unrated").upper(), 0.01)


def _lgd(asset_class: str) -> float:
    return LGD_DEFAULTS.get(asset_class, 0.50)


def stage_assets(assets: list[dict], asset_class: str = "trade_receivables") -> list[dict]:
    engine = IFRS9StagingEngine()
    out = []
    for a in assets:
        dpd = int(a.get("days_past_due") or 0)
        sicr = bool(a.get("has_significant_increase_in_credit_risk"))
        loan = {
            "days_past_due": dpd,
            "is_forbearance": sicr,
            "is_watchlist": sicr,
            "current_pd": _pd_12m(a.get("credit_rating", "Unrated")),
            "origination_pd": _pd_12m(a.get("credit_rating", "Unrated")) * 0.5,
        }
        if dpd < 30 and not sicr:
            stage = 1
        elif dpd >= 90:
            stage = 3
        elif dpd >= 30 or sicr:
            stage = 2
        else:
            stage_obj = engine.classify_loan(loan)
            stage = int(stage_obj.value.split()[-1])

        rating = a.get("credit_rating") or "Unrated"
        pd12 = _pd_12m(rating)
        pd_life = pd12 * 3 if stage == 2 else (0.9 if stage == 3 else pd12)
        lgd = _lgd(asset_class)
        ead = _f(a.get("exposure_aed"))
        out.append({
            **a,
            "stage": stage,
            "pd_12month": pd12,
            "pd_lifetime": pd_life,
            "lgd": lgd,
            "ead": ead,
        })
    return out


def calculate_ecl(assets: list[dict], asset_class: str = "trade_receivables") -> dict[str, Any]:
    calc = IFRS9ECLCalculator()
    staged = stage_assets(assets, asset_class)
    rows = []
    for a in staged:
        stage = a["stage"]
        exposure = Decimal(str(a["ead"]))
        pd = Decimal(str(a["pd_12month"] if stage == 1 else a["pd_lifetime"]))
        lgd = Decimal(str(a["lgd"]))
        ecl = calc.calculate_ecl_single_loan(exposure, pd, lgd)
        ecl12 = float(calc.calculate_ecl_single_loan(exposure, Decimal(str(a["pd_12month"])), lgd))
        ecl_life = float(calc.calculate_ecl_single_loan(exposure, Decimal(str(a["pd_lifetime"])), lgd, time_horizon_years=5))
        recognised = ecl12 if stage == 1 else ecl_life
        rows.append({
            **a,
            "ecl_12month_aed": round(ecl12, 2),
            "ecl_lifetime_aed": round(ecl_life, 2),
            "ecl_recognised_aed": round(recognised, 2),
            "pd_used": a["pd_12month"] if stage == 1 else a["pd_lifetime"],
            "lgd_used": a["lgd"],
        })

    total_exp = sum(_f(r["ead"]) for r in rows)
    total_ecl = sum(_f(r["ecl_recognised_aed"]) for r in rows)
    by_stage: dict[int, dict] = {1: {"exposure": 0, "ecl": 0}, 2: {"exposure": 0, "ecl": 0}, 3: {"exposure": 0, "ecl": 0}}
    for r in rows:
        s = int(r["stage"])
        by_stage[s]["exposure"] += _f(r["ead"])
        by_stage[s]["ecl"] += _f(r["ecl_recognised_aed"])

    return {
        "assets": rows,
        "portfolio_summary": {
            "total_exposure_aed": round(total_exp, 2),
            "total_ecl_aed": round(total_ecl, 2),
            "ecl_as_pct_of_exposure": round(total_ecl / total_exp * 100, 2) if total_exp else 0,
            "stage_distribution": {
                "stage1": by_stage[1],
                "stage2": by_stage[2],
                "stage3": by_stage[3],
            },
        },
    }


def save_portfolio(
    db: Session,
    *,
    workspace_id: str,
    company_id: str | None,
    portfolio_name: str,
    asset_class: str,
    calculation_date: str,
    assets: list[dict],
    summary: dict,
) -> IFRS9Portfolio:
    ps = summary.get("stage_distribution") or {}
    port = IFRS9Portfolio(
        workspace_id=workspace_id,
        company_id=company_id,
        portfolio_name=portfolio_name,
        asset_class=asset_class,
        total_exposure_aed=_f(summary.get("total_exposure_aed")),
        stage1_aed=_f(ps.get("stage1", {}).get("exposure")),
        stage2_aed=_f(ps.get("stage2", {}).get("exposure")),
        stage3_aed=_f(ps.get("stage3", {}).get("exposure")),
        ecl_stage1_aed=_f(ps.get("stage1", {}).get("ecl")),
        ecl_stage2_aed=_f(ps.get("stage2", {}).get("ecl")),
        ecl_stage3_aed=_f(ps.get("stage3", {}).get("ecl")),
        total_ecl_aed=_f(summary.get("total_ecl_aed")),
        calculation_date=calculation_date,
    )
    db.add(port)
    db.flush()
    for a in assets:
        db.add(IFRS9Asset(
            portfolio_id=port.id,
            workspace_id=workspace_id,
            company_id=company_id,
            asset_name=a.get("asset_name", ""),
            counterparty=a.get("counterparty", ""),
            exposure_aed=_f(a.get("ead") or a.get("exposure_aed")),
            origination_date=a.get("origination_date"),
            maturity_date=a.get("maturity_date"),
            credit_rating=a.get("credit_rating"),
            days_past_due=int(a.get("days_past_due") or 0),
            stage=str(a.get("stage", 1)),
            pd_12month=_f(a.get("pd_12month")),
            pd_lifetime=_f(a.get("pd_lifetime")),
            lgd=_f(a.get("lgd")),
            ead=_f(a.get("ead")),
            ecl_12month_aed=_f(a.get("ecl_12month_aed")),
            ecl_lifetime_aed=_f(a.get("ecl_lifetime_aed")),
            ecl_recognised_aed=_f(a.get("ecl_recognised_aed")),
            significant_increase_in_credit_risk=bool(a.get("has_significant_increase_in_credit_risk")),
        ))
    db.commit()
    db.refresh(port)
    return port


def list_portfolios(db: Session, workspace_id: str, company_id: str | None = None) -> list[dict]:
    q = db.query(IFRS9Portfolio).filter(IFRS9Portfolio.workspace_id == workspace_id)
    if company_id:
        q = q.filter(IFRS9Portfolio.company_id == company_id)
    return [
        {
            "id": p.id, "portfolio_name": p.portfolio_name, "asset_class": p.asset_class,
            "total_exposure_aed": _f(p.total_exposure_aed), "total_ecl_aed": _f(p.total_ecl_aed),
            "stage1_aed": _f(p.stage1_aed), "stage2_aed": _f(p.stage2_aed), "stage3_aed": _f(p.stage3_aed),
            "ecl_stage1_aed": _f(p.ecl_stage1_aed), "ecl_stage2_aed": _f(p.ecl_stage2_aed),
            "ecl_stage3_aed": _f(p.ecl_stage3_aed),
            "calculation_date": p.calculation_date, "je_posted": bool(p.je_posted),
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in q.order_by(IFRS9Portfolio.created_at.desc()).all()
    ]


def dashboard_summary(db: Session, workspace_id: str, company_id: str | None = None) -> dict[str, Any]:
    ports = list_portfolios(db, workspace_id, company_id)
    if not ports:
        return {
            "total_exposure_aed": 0, "total_ecl_aed": 0, "ecl_coverage_ratio_pct": 0,
            "stage1_pct": 0, "stage2_pct": 0, "stage3_pct": 0,
            "stage1_ecl": 0, "stage2_ecl": 0, "stage3_ecl": 0,
            "portfolios_count": 0, "last_calculation_date": None,
        }
    exp = sum(_f(p["total_exposure_aed"]) for p in ports)
    ecl = sum(_f(p["total_ecl_aed"]) for p in ports)
    s1 = sum(_f(p["stage1_aed"]) for p in ports)
    s2 = sum(_f(p["stage2_aed"]) for p in ports)
    s3 = sum(_f(p["stage3_aed"]) for p in ports)
    latest = max((p["calculation_date"] or "" for p in ports), default=None)
    return {
        "total_exposure_aed": round(exp, 2),
        "total_ecl_aed": round(ecl, 2),
        "ecl_coverage_ratio_pct": round(ecl / exp * 100, 2) if exp else 0,
        "stage1_pct": round(s1 / exp * 100, 2) if exp else 0,
        "stage2_pct": round(s2 / exp * 100, 2) if exp else 0,
        "stage3_pct": round(s3 / exp * 100, 2) if exp else 0,
        "stage1_ecl": round(sum(_f(p["ecl_stage1_aed"]) for p in ports), 2),
        "stage2_ecl": round(sum(_f(p["ecl_stage2_aed"]) for p in ports), 2),
        "stage3_ecl": round(sum(_f(p["ecl_stage3_aed"]) for p in ports), 2),
        "portfolios_count": len(ports),
        "last_calculation_date": latest,
        "portfolios": ports,
    }


def post_provision_je(
    db: Session,
    *,
    portfolio_id: str,
    period_date: date,
    ecl_movement_aed: float,
    workspace_id: str,
    company_id: str | None,
    prior_ecl: float = 0,
) -> dict[str, Any]:
    port = db.query(IFRS9Portfolio).filter(
        IFRS9Portfolio.id == portfolio_id,
        IFRS9Portfolio.workspace_id == workspace_id,
    ).first()
    if not port:
        raise ValueError("Portfolio not found")

    movement = ecl_movement_aed if ecl_movement_aed else (_f(port.total_ecl_aed) - prior_ecl)
    if abs(movement) < 0.01:
        return {"success": True, "je_id": None, "movement_aed": 0}

    if movement > 0:
        lines = [
            {"account_code": "7300", "account_name": "Credit Loss Expense", "debit": movement, "credit": 0},
            {"account_code": "1900", "account_name": "Loss Allowance", "debit": 0, "credit": movement},
        ]
        source = "IFRS9_ECL"
    else:
        rev = abs(movement)
        lines = [
            {"account_code": "1900", "account_name": "Loss Allowance", "debit": rev, "credit": 0},
            {"account_code": "7300", "account_name": "Credit Loss Expense", "debit": 0, "credit": rev},
        ]
        source = "IFRS9_ECL_REVERSAL"

    je = create_journal_entry(
        tenant_id=workspace_id,
        company_id=company_id,
        entry_date=period_date,
        description=f"IFRS 9 ECL Provision: {port.portfolio_name} - {period_date.strftime('%Y-%m')}",
        reference=f"IFRS9-{portfolio_id[:8]}",
        source=source,
        lines=lines,
        db=db,
        auto_post=True,
    )
    port.je_posted = True
    port.calculation_date = period_date.isoformat()
    db.add(port)
    db.commit()
    return {"success": True, "je_id": je.id, "movement_aed": round(movement, 2)}
