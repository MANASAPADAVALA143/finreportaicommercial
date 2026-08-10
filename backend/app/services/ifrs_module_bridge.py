"""IFRS 16 / 15 / 9 → trial-balance adjustment bridge.

Injects module-calculated balances as tagged TB lines + confirmed GL mappings
so ``statement_generator.generate_all_statements`` picks them up automatically.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.ifrs15_contract import IFRS15Contract
from app.models.ifrs16_lease import IFRS16Lease
from app.models.ifrs9_ecl import IFRS9Asset, IFRS9Portfolio
from app.models.ifrs_statement import (
    AccountTypeEnum,
    GLMapping,
    IFRSLink,
    IFRSStatementKind,
    MappingSourceEnum,
    TrialBalance,
    TrialBalanceLine,
)

logger = logging.getLogger(__name__)

SOURCE_TAG = "ifrs_module_adjustment"
ADJ_PREFIXES = ("IFRS16-", "IFRS15-", "IFRS9-")
ADJ_MARKER = f"[{SOURCE_TAG}"

# Presentation-positive amounts (except contra-asset ECL and CF lease outflow).
_INJECT_SPECS: dict[str, dict[str, Any]] = {
    "IFRS16-ROU": {
        "module": "ifrs16",
        "description": "Right-of-use assets (net)",
        "account_type": AccountTypeEnum.asset,
        "statement": IFRSStatementKind.financial_position,
        "section": "Non-current Assets",
        "line": "Right-of-use assets",
        "sign": 1,
    },
    "IFRS16-LL-CUR": {
        "module": "ifrs16",
        "description": "Lease liabilities — current portion",
        "account_type": AccountTypeEnum.liability,
        "statement": IFRSStatementKind.financial_position,
        "section": "Current Liabilities",
        "line": "Lease liabilities — current",
        "sign": 1,
    },
    "IFRS16-LL-NCL": {
        "module": "ifrs16",
        "description": "Lease liabilities — non-current portion",
        "account_type": AccountTypeEnum.liability,
        "statement": IFRSStatementKind.financial_position,
        "section": "Non-current Liabilities",
        "line": "Lease liabilities — non-current",
        "sign": 1,
    },
    "IFRS16-DEP": {
        "module": "ifrs16",
        "description": "Depreciation — right-of-use assets",
        "account_type": AccountTypeEnum.expense,
        "statement": IFRSStatementKind.profit_loss,
        "section": "Operating Expenses",
        "line": "Depreciation — right-of-use assets",
        "sign": 1,
        "is_contra": True,
    },
    "IFRS16-INT": {
        "module": "ifrs16",
        "description": "Finance costs — interest on leases",
        "account_type": AccountTypeEnum.expense,
        "statement": IFRSStatementKind.profit_loss,
        "section": "Finance Items",
        "line": "Finance costs — interest on leases",
        "sign": 1,
    },
    "IFRS16-PAY": {
        "module": "ifrs16",
        "description": "Lease payments (financing cash outflow)",
        "account_type": AccountTypeEnum.liability,
        "statement": IFRSStatementKind.cash_flows,
        "section": "Financing Activities",
        "line": "Repayment of lease liabilities",
        "sign": -1,
    },
    "IFRS15-CA": {
        "module": "ifrs15",
        "description": "Contract assets (IFRS 15)",
        "account_type": AccountTypeEnum.asset,
        "statement": IFRSStatementKind.financial_position,
        "section": "Current Assets",
        "line": "Contract assets",
        "sign": 1,
    },
    "IFRS15-DR": {
        "module": "ifrs15",
        "description": "Contract liabilities / deferred revenue (IFRS 15)",
        "account_type": AccountTypeEnum.liability,
        "statement": IFRSStatementKind.financial_position,
        "section": "Current Liabilities",
        "line": "Contract liabilities",
        "sign": 1,
    },
    "IFRS15-REV": {
        "module": "ifrs15",
        "description": "Revenue recognised from contracts (IFRS 15)",
        "account_type": AccountTypeEnum.revenue,
        "statement": IFRSStatementKind.profit_loss,
        "section": "Revenue",
        "line": "Revenue from contracts with customers",
        "sign": 1,
    },
    "IFRS9-ECL": {
        "module": "ifrs9",
        "description": "Loss allowance — expected credit losses (IFRS 9)",
        "account_type": AccountTypeEnum.asset,
        "statement": IFRSStatementKind.financial_position,
        "section": "Current Assets",
        "line": "Loss allowance on receivables",
        "sign": -1,
        "is_contra": True,
    },
    "IFRS9-IMP": {
        "module": "ifrs9",
        "description": "Expected credit loss charge (IFRS 9)",
        "account_type": AccountTypeEnum.expense,
        "statement": IFRSStatementKind.profit_loss,
        "section": "Operating Expenses",
        "line": "Expected credit loss charge",
        "sign": 1,
    },
}


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_json(raw: Any) -> dict[str, Any]:
    data = _parse_json_any(raw)
    return data if isinstance(data, dict) else {}


def _parse_json_any(raw: Any) -> Any:
    if isinstance(raw, (dict, list)):
        return raw
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _scope_ids(workspace_id: str | None, company_id: str | None) -> list[str]:
    out: list[str] = []
    for v in (company_id, workspace_id):
        s = (v or "").strip()
        if s and s not in out:
            out.append(s)
    return out


def _filter_scoped(q, model, workspace_id: str | None, company_id: str | None):
    ids = _scope_ids(workspace_id, company_id)
    if company_id and str(company_id).strip():
        cid = str(company_id).strip()
        by_co = q.filter(model.company_id == cid)
        # Prefer company match when rows exist; else fall back to workspace/tenant ids.
        try:
            if by_co.limit(1).first() is not None:
                return by_co
        except Exception:
            pass
    if not ids:
        return q.filter(model.id.in_([]))
    return q.filter(or_(model.workspace_id.in_(ids), model.company_id.in_(ids)))


def _active_status_ok(status: str | None) -> bool:
    s = (status or "active").strip().lower()
    return s not in {"deleted", "terminated", "inactive", "cancelled", "canceled"}


def list_ifrs16_leases(db: Session, workspace_id: str | None, company_id: str | None) -> list[IFRS16Lease]:
    try:
        q = _filter_scoped(db.query(IFRS16Lease), IFRS16Lease, workspace_id, company_id)
        rows = q.all()
    except Exception:
        logger.exception("IFRS 16 lease query failed")
        return []
    return [r for r in rows if _active_status_ok(r.status)]


def list_ifrs15_contracts(db: Session, workspace_id: str | None, company_id: str | None) -> list[IFRS15Contract]:
    try:
        q = _filter_scoped(db.query(IFRS15Contract), IFRS15Contract, workspace_id, company_id)
        rows = q.all()
    except Exception:
        logger.exception("IFRS 15 contract query failed")
        return []
    return [r for r in rows if _active_status_ok(r.status)]


def list_ifrs9_portfolios(db: Session, workspace_id: str | None, company_id: str | None) -> list[IFRS9Portfolio]:
    try:
        q = _filter_scoped(db.query(IFRS9Portfolio), IFRS9Portfolio, workspace_id, company_id)
        return q.all()
    except Exception:
        logger.exception("IFRS 9 portfolio query failed")
        return []


def _period_months(period_start: date | None, period_end: date | None) -> int:
    if period_start and period_end:
        months = (period_end.year - period_start.year) * 12 + (period_end.month - period_start.month) + 1
        return max(1, months)
    return 12


def _ll_split(lease: IFRS16Lease) -> tuple[float, float]:
    total = _f(lease.lease_liability_current) or _f(lease.lease_liability_initial)
    calc = _parse_json(lease.calculation_json)
    split = calc.get("liability_split") or calc.get("liabilitySplit") or {}
    if isinstance(split, dict) and (split.get("current_portion") is not None or split.get("current") is not None):
        cur = _f(split.get("current_portion", split.get("current")))
        ncl = _f(split.get("non_current_portion", split.get("non_current", max(0.0, total - cur))))
        if cur or ncl:
            return abs(cur), abs(ncl)
    pay = _f(lease.lease_payments_aed)
    freq = (lease.payment_frequency or "monthly").strip().lower()
    if freq in {"annual", "annually", "yearly"}:
        annual = pay
    elif freq in {"quarterly", "quarter"}:
        annual = pay * 4
    else:
        annual = pay * 12
    current = min(total, annual) if annual > 0 else total
    return current, max(0.0, total - current)


def _rou_net(lease: IFRS16Lease) -> float:
    current = _f(lease.rou_asset_current)
    if current:
        return abs(current)
    initial = _f(lease.rou_asset_initial)
    accum = _f(lease.accumulated_depreciation)
    return max(0.0, initial - accum)


def _lease_payments_period(lease: IFRS16Lease, months: int) -> float:
    calc = _parse_json(lease.calculation_json)
    sched = calc.get("amortization_schedule") or calc.get("schedule") or []
    if isinstance(sched, list) and sched:
        total_pay = 0.0
        for row in sched[-months:]:
            if isinstance(row, dict):
                total_pay += _f(row.get("Payment") or row.get("payment") or row.get("lease_payment"))
        if total_pay:
            return abs(total_pay)
    pay = _f(lease.lease_payments_aed)
    freq = (lease.payment_frequency or "monthly").strip().lower()
    if freq in {"annual", "annually", "yearly"}:
        return abs(pay) * (months / 12.0)
    if freq in {"quarterly", "quarter"}:
        return abs(pay) * (months / 3.0)
    return abs(pay) * months


def _lease_maturity_buckets(leases: list[IFRS16Lease]) -> dict[str, float]:
    within_1y = y1_5 = over_5 = 0.0
    for lease in leases:
        cur, ncl = _ll_split(lease)
        within_1y += cur
        remaining_after_1y = ncl
        term = int(lease.lease_term_months or 0)
        # Remaining non-current: split 1–5y vs >5y from residual term.
        leftover_months = max(0, term - 12)
        if leftover_months <= 48:
            y1_5 += remaining_after_1y
        elif leftover_months > 48 and remaining_after_1y:
            # Approximate straight-line residual across leftover months.
            per_m = remaining_after_1y / leftover_months
            y1_5 += per_m * 48
            over_5 += per_m * (leftover_months - 48)
        else:
            y1_5 += remaining_after_1y
    return {
        "within_1y": round(within_1y, 2),
        "y1_5": round(y1_5, 2),
        "over_5": round(over_5, 2),
        "total": round(within_1y + y1_5 + over_5, 2),
    }


def _pob_rows(contract: IFRS15Contract) -> list[dict[str, Any]]:
    raw = _parse_json_any(contract.performance_obligations)
    if isinstance(raw, dict):
        items = raw.get("items") or raw.get("pobs") or raw.get("performance_obligations") or []
        if not items and raw:
            items = [raw]
    elif isinstance(raw, list):
        items = raw
    else:
        calc = _parse_json(contract.calculation_json)
        items = calc.get("performance_obligations") or calc.get("pobs") or []
    rows: list[dict[str, Any]] = []
    if isinstance(items, list):
        for i, item in enumerate(items, 1):
            if not isinstance(item, dict):
                continue
            rows.append(
                {
                    "name": item.get("name") or item.get("description") or item.get("pob_name") or f"POB {i}",
                    "transaction_price": _f(item.get("transaction_price") or item.get("value") or item.get("amount")),
                    "recognised": _f(item.get("recognised") or item.get("revenue_recognised") or item.get("recognised_aed")),
                    "remaining": _f(item.get("remaining") or item.get("remaining_aed")),
                    "method": item.get("method") or item.get("recognition_method") or "",
                }
            )
    if not rows:
        rows.append(
            {
                "name": contract.contract_number or "Contract",
                "transaction_price": _f(contract.contract_value_aed),
                "recognised": _f(contract.total_recognised_aed),
                "remaining": _f(contract.total_remaining_aed),
                "method": "",
            }
        )
    return rows


def _dpd_bucket(days: float) -> str:
    d = int(days or 0)
    if d <= 0:
        return "current"
    if d <= 30:
        return "1-30"
    if d <= 60:
        return "31-60"
    if d <= 90:
        return "61-90"
    return "90+"


def _is_adj_line(line: TrialBalanceLine) -> bool:
    code = (line.gl_code or "").strip()
    desc = line.gl_description or ""
    return code.startswith(ADJ_PREFIXES) or ADJ_MARKER in desc


def list_injected_adjustments(db: Session, trial_balance_id: int) -> list[dict[str, Any]]:
    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
        .all()
    )
    mappings = {
        m.trial_balance_line_id: m
        for m in db.query(GLMapping).filter(GLMapping.trial_balance_id == trial_balance_id).all()
    }
    out: list[dict[str, Any]] = []
    for ln in lines:
        if not _is_adj_line(ln):
            continue
        m = mappings.get(ln.id)
        module = "ifrs16"
        if (ln.gl_code or "").startswith("IFRS15-"):
            module = "ifrs15"
        elif (ln.gl_code or "").startswith("IFRS9-"):
            module = "ifrs9"
        out.append(
            {
                "gl_code": ln.gl_code,
                "gl_description": ln.gl_description,
                "net_amount": float(ln.net_amount or 0),
                "module": module,
                "source_tag": SOURCE_TAG,
                "ifrs_line_item": m.ifrs_line_item if m else None,
                "ifrs_statement": (
                    m.ifrs_statement.value if m and hasattr(m.ifrs_statement, "value") else (m.ifrs_statement if m else None)
                ),
            }
        )
    return out


def _uploaded_mapped_line_names(db: Session, trial_balance_id: int) -> set[str]:
    names: set[str] = set()
    rows = (
        db.query(GLMapping)
        .filter(GLMapping.trial_balance_id == trial_balance_id)
        .all()
    )
    for m in rows:
        code = (m.gl_code or "").strip()
        if code.startswith(ADJ_PREFIXES):
            continue
        names.add((m.ifrs_line_item or "").strip().lower())
    return names


def _has_mapped(names: set[str], *needles: str) -> bool:
    for n in names:
        for needle in needles:
            if needle in n:
                return True
    return False


def preview_ifrs_module_adjustments(
    db: Session,
    trial_balance_id: int,
    *,
    company_id: str | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError("Trial balance not found")
    ws = workspace_id or tb.tenant_id
    cid = company_id or tb.tenant_id
    leases = list_ifrs16_leases(db, ws, cid)
    contracts = list_ifrs15_contracts(db, ws, cid)
    portfolios = list_ifrs9_portfolios(db, ws, cid)
    mapped = _uploaded_mapped_line_names(db, trial_balance_id)
    skip_16 = _has_mapped(mapped, "right-of-use", "rou asset")
    skip_15_ca = _has_mapped(mapped, "contract asset")
    skip_15_dr = _has_mapped(mapped, "contract liab", "deferred revenue")
    skip_15_rev = _has_mapped(mapped, "revenue from contracts")
    skip_9 = _has_mapped(mapped, "loss allowance", "expected credit loss", "ecl provision")
    existing = list_injected_adjustments(db, trial_balance_id)
    return {
        "trial_balance_id": trial_balance_id,
        "ifrs16": {
            "count": len(leases),
            "label": f"Apply IFRS 16 lease adjustments ({len(leases)} leases found)",
            "skip_recommended": skip_16,
            "skip_reason": "TB already has a mapped right-of-use asset" if skip_16 else None,
        },
        "ifrs15": {
            "count": len(contracts),
            "label": f"Apply IFRS 15 revenue adjustments ({len(contracts)} contracts found)",
            "skip_recommended": skip_15_ca and skip_15_dr and skip_15_rev,
            "skip_reason": "TB already has mapped IFRS 15 balances" if (skip_15_ca and skip_15_dr and skip_15_rev) else None,
        },
        "ifrs9": {
            "count": len(portfolios),
            "label": f"Apply IFRS 9 ECL adjustments ({len(portfolios)} portfolios found)",
            "skip_recommended": skip_9,
            "skip_reason": "TB already has a mapped ECL / loss allowance" if skip_9 else None,
        },
        "already_injected": existing,
        "already_injected_count": len(existing),
    }


def _delete_module_adjustments(db: Session, trial_balance_id: int, modules: set[str] | None = None) -> int:
    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
        .all()
    )
    victims = [ln for ln in lines if _is_adj_line(ln)]
    if modules:
        keep_mod = set(modules)
        filtered: list[TrialBalanceLine] = []
        for ln in victims:
            code = ln.gl_code or ""
            mod = "ifrs16" if code.startswith("IFRS16-") else "ifrs15" if code.startswith("IFRS15-") else "ifrs9"
            if mod in keep_mod:
                filtered.append(ln)
        victims = filtered
    ids = [ln.id for ln in victims]
    if not ids:
        return 0
    db.query(IFRSLink).filter(IFRSLink.trial_balance_line_id.in_(ids)).delete(synchronize_session=False)
    db.query(GLMapping).filter(GLMapping.trial_balance_line_id.in_(ids)).delete(synchronize_session=False)
    db.query(TrialBalanceLine).filter(TrialBalanceLine.id.in_(ids)).delete(synchronize_session=False)
    db.flush()
    return len(ids)


def _upsert_adj_line(
    db: Session,
    tb: TrialBalance,
    gl_code: str,
    amount: float,
) -> TrialBalanceLine | None:
    spec = _INJECT_SPECS[gl_code]
    signed = round(abs(amount) * spec["sign"], 2)
    if abs(signed) < 0.005:
        return None
    debit = abs(signed) if signed > 0 else 0.0
    credit = abs(signed) if signed < 0 else 0.0
    desc = f"[{SOURCE_TAG}:{spec['module']}] {spec['description']}"
    line = TrialBalanceLine(
        trial_balance_id=tb.id,
        tenant_id=tb.tenant_id,
        gl_code=gl_code,
        gl_description=desc[:512],
        debit_amount=debit,
        credit_amount=credit,
        net_amount=signed,
        account_type=spec["account_type"],
    )
    db.add(line)
    db.flush()
    mapping = GLMapping(
        tenant_id=tb.tenant_id,
        company_id=tb.tenant_id,
        trial_balance_id=tb.id,
        trial_balance_line_id=line.id,
        gl_code=gl_code,
        gl_description=desc[:512],
        ifrs_statement=spec["statement"],
        ifrs_line_item=spec["line"],
        ifrs_section=spec["section"],
        ifrs_sub_section=None,
        mapping_source=MappingSourceEnum.user_confirmed,
        ai_confidence_score=1.0,
        ai_reasoning=f"{SOURCE_TAG}|{spec['module']}|auto-injected from live module balances",
        is_confirmed=True,
        confirmed_by="ifrs_module_bridge",
        confirmed_at=datetime.utcnow(),
        needs_review=False,
        validator_checked=True,
        validator_passed=True,
        validator_issues=None,
        validator_score=1.0,
        is_contra=bool(spec.get("is_contra")),
        locked=True,
    )
    db.add(mapping)
    db.flush()
    return line


def inject_ifrs_module_adjustments(
    company_id: str,
    period: str,
    tb_id: str | int,
    db: Session,
    *,
    apply_ifrs16: bool = True,
    apply_ifrs15: bool = True,
    apply_ifrs9: bool = True,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """
    Before generating statements, pull IFRS 16/15/9 calculated balances and inject
    as adjustment lines into trial_balance_lines so the statement generator
    picks them up automatically.
    """
    trial_balance_id = int(tb_id)
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError("Trial balance not found")

    ws = workspace_id or tb.tenant_id
    cid = company_id or tb.tenant_id
    mapped = _uploaded_mapped_line_names(db, trial_balance_id)

    # Always clear previous injections first so toggles / re-runs stay idempotent.
    _delete_module_adjustments(db, trial_balance_id)

    applied: list[dict[str, Any]] = []
    skipped: list[str] = []

    # ── IFRS 16 ──────────────────────────────────────────────────────────────
    leases = list_ifrs16_leases(db, ws, cid)
    if apply_ifrs16 and leases:
        if _has_mapped(mapped, "right-of-use", "rou asset"):
            skipped.append("IFRS 16 skipped — TB already has a mapped right-of-use asset")
        else:
            months = _period_months(tb.period_start, tb.period_end)
            rou = ll_cur = ll_ncl = dep = interest = payments = 0.0
            for lease in leases:
                rou += _rou_net(lease)
                c, n = _ll_split(lease)
                ll_cur += c
                ll_ncl += n
                dep += _f(lease.depreciation_ytd)
                interest += _f(lease.interest_ytd)
                payments += _lease_payments_period(lease, months)
            for code, amt in (
                ("IFRS16-ROU", rou),
                ("IFRS16-LL-CUR", ll_cur),
                ("IFRS16-LL-NCL", ll_ncl),
                ("IFRS16-DEP", dep),
                ("IFRS16-INT", interest),
                ("IFRS16-PAY", payments),
            ):
                line = _upsert_adj_line(db, tb, code, amt)
                if line:
                    applied.append(
                        {
                            "gl_code": code,
                            "module": "ifrs16",
                            "source_tag": SOURCE_TAG,
                            "net_amount": float(line.net_amount or 0),
                            "ifrs_line_item": _INJECT_SPECS[code]["line"],
                        }
                    )
    elif apply_ifrs16:
        skipped.append("IFRS 16 — no leases found")

    # ── IFRS 15 ──────────────────────────────────────────────────────────────
    contracts = list_ifrs15_contracts(db, ws, cid)
    if apply_ifrs15 and contracts:
        ca = dr = rev = 0.0
        for c in contracts:
            ca += _f(c.contract_asset_aed)
            dr += _f(c.contract_liability_aed)
            rev += _f(c.total_recognised_aed)
        pairs = [
            ("IFRS15-CA", ca, ("contract asset",), "contract assets"),
            ("IFRS15-DR", dr, ("contract liab", "deferred revenue"), "deferred revenue / contract liabilities"),
            ("IFRS15-REV", rev, ("revenue from contracts",), "revenue from contracts"),
        ]
        any_15 = False
        for code, amt, needles, label in pairs:
            if _has_mapped(mapped, *needles):
                skipped.append(f"IFRS 15 {label} skipped — already mapped in TB")
                continue
            line = _upsert_adj_line(db, tb, code, amt)
            if line:
                any_15 = True
                applied.append(
                    {
                        "gl_code": code,
                        "module": "ifrs15",
                        "source_tag": SOURCE_TAG,
                        "net_amount": float(line.net_amount or 0),
                        "ifrs_line_item": _INJECT_SPECS[code]["line"],
                    }
                )
        if not any_15 and not any(s.startswith("IFRS 15") for s in skipped):
            skipped.append("IFRS 15 — contract totals were zero")
    elif apply_ifrs15:
        skipped.append("IFRS 15 — no contracts found")

    # ── IFRS 9 ───────────────────────────────────────────────────────────────
    portfolios = list_ifrs9_portfolios(db, ws, cid)
    if apply_ifrs9 and portfolios:
        if _has_mapped(mapped, "loss allowance", "expected credit loss", "ecl provision"):
            skipped.append("IFRS 9 skipped — TB already has a mapped ECL / loss allowance")
        else:
            ecl = sum(_f(p.total_ecl_aed) for p in portfolios)
            # Impairment charge ≈ closing ECL when no opening rollforward is stored.
            imp = ecl
            for code, amt in (("IFRS9-ECL", ecl), ("IFRS9-IMP", imp)):
                line = _upsert_adj_line(db, tb, code, amt)
                if line:
                    applied.append(
                        {
                            "gl_code": code,
                            "module": "ifrs9",
                            "source_tag": SOURCE_TAG,
                            "net_amount": float(line.net_amount or 0),
                            "ifrs_line_item": _INJECT_SPECS[code]["line"],
                        }
                    )
    elif apply_ifrs9:
        skipped.append("IFRS 9 — no portfolios found")

    db.commit()
    count = len(applied)
    message = (
        f"{count} IFRS module adjustment{'s' if count != 1 else ''} applied before generating"
        if count
        else "No IFRS module adjustments applied"
    )
    logger.info("IFRS module bridge tb=%s period=%s: %s", trial_balance_id, period, message)
    return {
        "applied_count": count,
        "message": message,
        "adjustments": applied,
        "skipped": skipped,
        "counts": {
            "ifrs16_leases": len(leases),
            "ifrs15_contracts": len(contracts),
            "ifrs9_portfolios": len(portfolios),
        },
        "flags": {
            "apply_ifrs16": apply_ifrs16,
            "apply_ifrs15": apply_ifrs15,
            "apply_ifrs9": apply_ifrs9,
        },
    }


def enrich_tb_data_from_ifrs_modules(
    tb_data: dict[str, Any],
    db: Session,
    trial_balance_id: int,
    *,
    company_id: str | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Overlay live IFRS 16/15/9 register data onto disclosure ``tb_data``."""
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        return tb_data
    ws = workspace_id or tb.tenant_id
    cid = company_id or tb.tenant_id

    leases = list_ifrs16_leases(db, ws, cid)
    if leases:
        rou = dep = interest = payments = ll_cur = ll_ncl = rou_open = 0.0
        months = _period_months(tb.period_start, tb.period_end)
        lease_rows: list[dict[str, Any]] = []
        for lease in leases:
            r = _rou_net(lease)
            c, n = _ll_split(lease)
            d = _f(lease.depreciation_ytd)
            i = _f(lease.interest_ytd)
            p = _lease_payments_period(lease, months)
            opening = _f(lease.rou_asset_initial) or (r + _f(lease.accumulated_depreciation))
            rou += r
            rou_open += opening
            dep += d
            interest += i
            payments += p
            ll_cur += c
            ll_ncl += n
            lease_rows.append(
                {
                    "lease_name": lease.lease_name,
                    "asset_class": lease.asset_class,
                    "rou_asset": round(r, 2),
                    "lease_liability_current": round(c, 2),
                    "lease_liability_non_current": round(n, 2),
                    "depreciation_ytd": round(d, 2),
                    "interest_ytd": round(i, 2),
                    "payments_period": round(p, 2),
                    "term_months": lease.lease_term_months,
                }
            )
        maturity = _lease_maturity_buckets(leases)
        tb_data["has_leases"] = True
        tb_data["ifrs16_source"] = "module"
        tb_data["rou_asset"] = round(rou, 2)
        tb_data["rou_asset_opening"] = round(rou_open, 2)
        tb_data["rou_depreciation"] = round(dep, 2)
        tb_data["lease_interest"] = round(interest, 2)
        tb_data["lease_payments_period"] = round(payments, 2)
        tb_data["lease_liability_current"] = round(ll_cur, 2)
        tb_data["lease_liability_non_current"] = round(ll_ncl, 2)
        tb_data["ifrs16_leases"] = lease_rows
        tb_data["ifrs16_maturity"] = maturity
        tb_data["ifrs16_rou_movement"] = {
            "opening": round(rou_open, 2),
            "additions": 0.0,
            "depreciation": round(dep, 2),
            "closing": round(rou, 2),
        }

    contracts = list_ifrs15_contracts(db, ws, cid)
    if contracts:
        ca = dr = rev = 0.0
        contract_rows: list[dict[str, Any]] = []
        pob_flat: list[dict[str, Any]] = []
        for c in contracts:
            ca += _f(c.contract_asset_aed)
            dr += _f(c.contract_liability_aed)
            rev += _f(c.total_recognised_aed)
            pobs = _pob_rows(c)
            pob_flat.extend([{**p, "contract_number": c.contract_number, "customer_name": c.customer_name} for p in pobs])
            contract_rows.append(
                {
                    "contract_number": c.contract_number,
                    "customer_name": c.customer_name,
                    "contract_value": _f(c.contract_value_aed),
                    "recognised": _f(c.total_recognised_aed),
                    "remaining": _f(c.total_remaining_aed),
                    "contract_asset": _f(c.contract_asset_aed),
                    "contract_liability": _f(c.contract_liability_aed),
                    "performance_obligations": pobs,
                }
            )
        tb_data["ifrs15_source"] = "module"
        tb_data["contract_assets"] = round(ca, 2)
        tb_data["contract_liabilities"] = round(dr, 2)
        tb_data["deferred_revenue"] = round(dr, 2)
        if rev:
            tb_data["revenue"] = round(rev, 2)
        tb_data["ifrs15_contracts"] = contract_rows
        tb_data["ifrs15_pob"] = pob_flat

    portfolios = list_ifrs9_portfolios(db, ws, cid)
    if portfolios:
        s1 = s2 = s3 = ecl = exposure = 0.0
        port_rows: list[dict[str, Any]] = []
        for p in portfolios:
            s1 += _f(p.ecl_stage1_aed)
            s2 += _f(p.ecl_stage2_aed)
            s3 += _f(p.ecl_stage3_aed)
            ecl += _f(p.total_ecl_aed)
            exposure += _f(p.total_exposure_aed)
            port_rows.append(
                {
                    "portfolio_name": p.portfolio_name,
                    "asset_class": p.asset_class,
                    "exposure": _f(p.total_exposure_aed),
                    "ecl_stage1": _f(p.ecl_stage1_aed),
                    "ecl_stage2": _f(p.ecl_stage2_aed),
                    "ecl_stage3": _f(p.ecl_stage3_aed),
                    "total_ecl": _f(p.total_ecl_aed),
                }
            )
        buckets = {"current": 0.0, "1-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
        bucket_ecl = {k: 0.0 for k in buckets}
        try:
            pids = [p.id for p in portfolios]
            assets = db.query(IFRS9Asset).filter(IFRS9Asset.portfolio_id.in_(pids)).all() if pids else []
            for a in assets:
                b = _dpd_bucket(_f(a.days_past_due))
                buckets[b] = buckets.get(b, 0.0) + _f(a.exposure_aed)
                bucket_ecl[b] = bucket_ecl.get(b, 0.0) + _f(a.ecl_recognised_aed)
        except Exception:
            logger.exception("IFRS 9 asset bucket query failed")
        tb_data["ifrs9_source"] = "module"
        tb_data["ecl_provision"] = round(ecl, 2)
        tb_data["ifrs9_ecl_charge"] = round(ecl, 2)
        tb_data["ifrs9_exposure"] = round(exposure, 2)
        tb_data["ifrs9_ecl_by_stage"] = {
            "stage1": round(s1, 2),
            "stage2": round(s2, 2),
            "stage3": round(s3, 2),
            "total": round(ecl, 2),
        }
        tb_data["ifrs9_ecl_by_bucket"] = {
            "gross": {k: round(v, 2) for k, v in buckets.items()},
            "ecl": {k: round(v, 2) for k, v in bucket_ecl.items()},
        }
        tb_data["ifrs9_portfolios"] = port_rows
        if exposure and not tb_data.get("trade_receivables"):
            tb_data["trade_receivables"] = round(exposure, 2)

    tb_data["ifrs_module_adjustments"] = list_injected_adjustments(db, trial_balance_id)
    return tb_data
