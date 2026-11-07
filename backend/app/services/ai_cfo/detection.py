"""Deterministic anomaly rules over the posted ledger. No model is involved here.

Rules (all per company and month):
- expense_spike: an expense account's month is well above its own recent average.
- budget_overrun: an expense account is over its FP&A budget for the month.
- duplicate_entry: two or more posted entries hit the same account with the same amount
  and description in the same month.

Re-running a month updates open findings in place; dismissed or resolved ones keep their
status so a reviewer's decision is not undone.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from statistics import mean, pstdev
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_cfo import AiCfoFinding
from app.services.ai_cfo import ledger
from app.services.ai_cfo.budget import budget_by_account
from app.services.ai_cfo.ledger import LedgerScope

LOOKBACK_MONTHS = 6
MIN_HISTORY_MONTHS = 3
SPIKE_MIN_PCT = 0.25
SPIKE_MIN_Z = 2.0
BUDGET_OVERRUN_PCT = 0.15
MATERIALITY_FLOOR = 5000.0
MATERIALITY_SHARE_OF_OPEX = 0.02
DUPLICATE_MIN_AMOUNT = 1000.0
EVIDENCE_LINES = 5


def _materiality(expense_total: float) -> float:
    return round(max(MATERIALITY_FLOOR, MATERIALITY_SHARE_OF_OPEX * expense_total), 2)


def _refs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"ref": r["ref"], "journal_entry_id": r["journal_entry_id"], "date": r["date"], "amount": r["net"],
         "description": r["description"]}
        for r in rows
    ]


def _expense_spikes(
    db: Session, scope: LedgerScope, period: str, history_periods: list[str], by_account: dict, materiality: float
) -> list[dict[str, Any]]:
    out = []
    for code, info in by_account.items():
        current = info["series"].get(period, 0.0)
        hist = [info["series"].get(p, 0.0) for p in history_periods]
        if len(hist) < MIN_HISTORY_MONTHS or current <= 0:
            continue
        base, spread = mean(hist), pstdev(hist)
        delta = current - base
        pct = delta / base if base > 0 else None
        z = delta / spread if spread > 0 else None
        if delta < materiality or (pct is not None and pct < SPIKE_MIN_PCT) or (z is not None and z < SPIKE_MIN_Z):
            continue
        severity = "high" if delta >= 3 * materiality or (pct is not None and pct >= 1.0) else "medium"
        pct_text = f"{pct:.0%} above" if pct is not None else "with no spending in"
        out.append({
            "kind": "expense_spike",
            "fingerprint": f"expense_spike:{period}:{code}",
            "account_code": code,
            "account_name": info["name"],
            "title": f"{info['name']} up {pct_text} its {len(hist)}-month average",
            "detection_reason": (
                f"Posted expense on {code} {info['name']} in {period} is {current:,.2f}, against an average of "
                f"{base:,.2f} over {history_periods[0]} to {history_periods[-1]} (increase {delta:,.2f}"
                + (f", {z:.1f} standard deviations" if z is not None else "")
                + f"). Materiality threshold {materiality:,.2f}."
            ),
            "severity": severity,
            "amount": round(delta, 2),
            "metrics": {
                "current": round(current, 2), "baseline_mean": round(base, 2), "baseline_std": round(spread, 2),
                "increase": round(delta, 2), "increase_pct": round(pct, 4) if pct is not None else None,
                "z_score": round(z, 2) if z is not None else None, "materiality": materiality,
                "history": {p: round(info["series"].get(p, 0.0), 2) for p in history_periods},
            },
            "evidence": _refs(ledger.transactions(db, scope, code, period, limit=EVIDENCE_LINES)),
        })
    return out


def _budget_overruns(
    db: Session, scope: LedgerScope, period: str, by_account: dict, materiality: float
) -> list[dict[str, Any]]:
    budgets = budget_by_account(db, scope.company_id, period)
    out = []
    for code, b in budgets.items():
        info = by_account.get(code)
        budget = b["budget"]
        if info is None or budget <= 0:
            continue
        actual = info["series"].get(period, 0.0)
        over = actual - budget
        pct = over / budget
        if pct < BUDGET_OVERRUN_PCT or over < materiality:
            continue
        out.append({
            "kind": "budget_overrun",
            "fingerprint": f"budget_overrun:{period}:{code}",
            "account_code": code,
            "account_name": info["name"],
            "title": f"{info['name']} {pct:.0%} over budget in {period}",
            "detection_reason": (
                f"Posted expense on {code} {info['name']} in {period} is {actual:,.2f} against a budget of "
                f"{budget:,.2f} ({b['fiscal_year']} FP&A upload), {over:,.2f} over."
            ),
            "severity": "high" if pct >= 0.5 else "medium",
            "amount": round(over, 2),
            "metrics": {"actual": round(actual, 2), "budget": budget, "over": round(over, 2),
                        "over_pct": round(pct, 4), "materiality": materiality, "fiscal_year": b["fiscal_year"]},
            "evidence": _refs(ledger.transactions(db, scope, code, period, limit=EVIDENCE_LINES)),
        })
    return out


def _duplicates(db: Session, scope: LedgerScope, period: str, expense_codes: set[str], materiality: float) -> list[dict]:
    groups: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
    for code in expense_codes:
        for row in ledger.transactions(db, scope, code, period, limit=200):
            if abs(row["net"]) < DUPLICATE_MIN_AMOUNT:
                continue
            desc = " ".join((row["description"] or "").lower().split())
            groups[(code, row["net"], desc)].append(row)
    out = []
    for (code, amount, desc), rows in groups.items():
        entries = {r["journal_entry_id"] for r in rows}
        if len(entries) < 2:
            continue
        digest = hashlib.sha1(f"{amount}|{desc}".encode()).hexdigest()[:12]
        name = rows[0]["account_name"]
        out.append({
            "kind": "duplicate_entry",
            "fingerprint": f"duplicate_entry:{period}:{code}:{digest}",
            "account_code": code,
            "account_name": name,
            "title": f"Possible duplicate: {len(entries)} entries of {amount:,.2f} on {name}",
            "detection_reason": (
                f"{len(entries)} posted journal entries in {period} hit {code} {name} with the same amount "
                f"({amount:,.2f}) and description \"{rows[0]['description'] or '(none)'}\"."
            ),
            "severity": "high" if abs(amount) >= materiality else "medium",
            "amount": round(amount * (len(entries) - 1), 2),
            "metrics": {"entries": len(entries), "amount_each": amount, "potential_overstatement": round(amount * (len(entries) - 1), 2)},
            "evidence": _refs(rows),
        })
    return out


def run_detection(db: Session, scope: LedgerScope, period: str | None = None) -> dict[str, Any]:
    cov = ledger.coverage(db, scope)
    period = period or cov["last_period"]
    if not period:
        return {"period": None, "findings": [], "created": 0, "updated": 0, "limitations": cov["limitations"]}

    history_periods = [p for p in cov["periods"] if ledger.period_add(period, -LOOKBACK_MONTHS) <= p < period]
    moves = ledger.monthly_movements(
        db, scope, ledger.period_add(period, -LOOKBACK_MONTHS), period, account_type="Expense"
    )
    by_account: dict[str, dict[str, Any]] = {}
    for m in moves:
        acct = by_account.setdefault(m["account_code"], {"name": m["account_name"], "series": {}})
        acct["series"][m["period"]] = m["net"]
    expense_total = sum(a["series"].get(period, 0.0) for a in by_account.values())
    materiality = _materiality(expense_total)

    candidates = (
        _expense_spikes(db, scope, period, history_periods, by_account, materiality)
        + _budget_overruns(db, scope, period, by_account, materiality)
        + _duplicates(db, scope, period, set(by_account), materiality)
    )

    existing = {
        f.fingerprint: f
        for f in db.query(AiCfoFinding).filter(
            AiCfoFinding.workspace_id == scope.workspace_id,
            AiCfoFinding.company_id == scope.company_id,
            AiCfoFinding.fingerprint.in_([c["fingerprint"] for c in candidates] or [""]),
        )
    }
    created = updated = 0
    rows = []
    for c in candidates:
        fields = {
            "kind": c["kind"], "period": period, "account_code": c["account_code"], "account_name": c["account_name"],
            "title": c["title"][:300], "detection_reason": c["detection_reason"], "severity": c["severity"],
            "amount": c["amount"], "metrics_json": c["metrics"], "evidence_refs": c["evidence"],
        }
        row = existing.get(c["fingerprint"])
        if row is None:
            row = AiCfoFinding(
                workspace_id=scope.workspace_id, company_id=scope.company_id,
                fingerprint=c["fingerprint"], status="open", **fields,
            )
            db.add(row)
            created += 1
        elif row.status == "open":
            for k, v in fields.items():
                setattr(row, k, v)
            updated += 1
        rows.append(row)
    db.commit()
    for r in rows:
        db.refresh(r)
    return {
        "period": period,
        "history_periods": history_periods,
        "materiality": materiality,
        "findings": rows,
        "created": created,
        "updated": updated,
        "limitations": cov["limitations"],
    }
