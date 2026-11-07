"""Tools the AI CFO agents may call. Each declares an action class and validates its input.

Action classes: READ (fetch records), ANALYSE (deterministic calculations), RECOMMEND,
PREPARE (draft an action for human approval), EXECUTE. No EXECUTE tool exists: the only
write a tool can make is a *pending* approval request. Every tool is bound to the
investigation's workspace and company, so an agent cannot reach another company's data.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from statistics import mean
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoInvestigation
from app.services.ai_cfo import ledger
from app.services.ai_cfo.budget import budget_by_account
from app.services.ai_cfo.forecast import months_to_fiscal_year_end, project_expense_impact
from app.services.ai_cfo.ledger import ACCOUNT_TYPES, LedgerScope

READ, ANALYSE, RECOMMEND, PREPARE, EXECUTE = "read", "analyse", "recommend", "prepare", "execute"
_PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
APPROVAL_ACTIONS = (
    "investigate_vendor", "review_contract", "adjust_forecast", "budget_reallocation",
    "reverse_duplicate_entry", "management_review",
)
MAX_APPROVALS_PER_RUN = 3
MAX_MONTHS = 36


class ToolInputError(ValueError):
    pass


@dataclass
class ToolContext:
    db: Session
    scope: LedgerScope
    investigation: AiCfoInvestigation
    user_email: str | None
    fiscal_year_start: int = 1
    seen_refs: set[str] = field(default_factory=set)
    approvals: list[AiCfoApprovalRequest] = field(default_factory=list)
    final: dict[str, Any] | None = None


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    action_class: str
    input_schema: dict[str, Any]
    handler: Callable[[ToolContext, dict[str, Any]], dict[str, Any]]

    def spec(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


# ── input helpers ────────────────────────────────────────────────────────────

def _period(args: dict, key: str, required: bool = True) -> str | None:
    value = args.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not _PERIOD_RE.match(value):
        raise ToolInputError(f"{key} must be a month formatted YYYY-MM")
    return value


def _int(args: dict, key: str, default: int, lo: int, hi: int) -> int:
    value = args.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ToolInputError(f"{key} must be a whole number from {lo} to {hi}")
    return value


def _code(args: dict, key: str = "account_code") -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > 20:
        raise ToolInputError(f"{key} is required")
    return value.strip()


def _choice(args: dict, key: str, options: tuple[str, ...], default: str | None = None) -> str | None:
    value = args.get(key, default)
    if value is None:
        return None
    if value not in options:
        raise ToolInputError(f"{key} must be one of: {', '.join(options)}")
    return value


def _text(args: dict, key: str, max_len: int, required: bool = True) -> str | None:
    value = args.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ToolInputError(f"{key} is required")
    return value.strip()[:max_len]


_PERIOD_SCHEMA = {"type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$", "description": "Month, YYYY-MM"}
_TYPE_SCHEMA = {"type": "string", "enum": list(ACCOUNT_TYPES)}


# ── tool handlers ────────────────────────────────────────────────────────────

def _coverage(ctx: ToolContext, args: dict) -> dict:
    return ledger.coverage(ctx.db, ctx.scope)


def _movements(ctx: ToolContext, args: dict) -> dict:
    start, end = _period(args, "period_from"), _period(args, "period_to")
    if start > end or len(ledger.periods_between(start, end)) > MAX_MONTHS:
        raise ToolInputError(f"period_from must be on or before period_to and span at most {MAX_MONTHS} months")
    codes = args.get("account_codes")
    if codes is not None and (not isinstance(codes, list) or not all(isinstance(c, str) for c in codes) or len(codes) > 50):
        raise ToolInputError("account_codes must be a list of up to 50 account codes")
    rows = ledger.monthly_movements(
        ctx.db, ctx.scope, start, end,
        account_codes=codes, account_type=_choice(args, "account_type", ACCOUNT_TYPES),
    )
    return {"rows": rows[:400], "truncated": len(rows) > 400}


def _compare(ctx: ToolContext, args: dict) -> dict:
    period = _period(args, "period")
    lookback = _int(args, "lookback_months", 6, 1, 12)
    top_n = _int(args, "top_n", 10, 1, 30)
    acct_type = _choice(args, "account_type", ACCOUNT_TYPES, "Expense")
    start = ledger.period_add(period, -lookback)
    cov = ledger.coverage(ctx.db, ctx.scope)
    prior_periods = [p for p in cov["periods"] if start <= p < period]
    rows = ledger.monthly_movements(ctx.db, ctx.scope, start, period, account_type=acct_type)
    series: dict[str, dict] = {}
    for r in rows:
        s = series.setdefault(r["account_code"], {"account_name": r["account_name"], "by_period": {}})
        s["by_period"][r["period"]] = r["net"]
    out = []
    for code, s in series.items():
        current = s["by_period"].get(period, 0.0)
        prior = [s["by_period"].get(p, 0.0) for p in prior_periods]
        avg = round(mean(prior), 2) if prior else 0.0
        delta = round(current - avg, 2)
        out.append({
            "account_code": code, "account_name": s["account_name"], "current": current,
            "prior_average": avg, "change": delta, "change_pct": round(delta / avg, 4) if avg else None,
        })
    out.sort(key=lambda r: abs(r["change"]), reverse=True)
    total_current = round(sum(r["current"] for r in out), 2)
    total_prior = round(sum(r["prior_average"] for r in out), 2)
    return {
        "period": period, "account_type": acct_type, "prior_periods": prior_periods,
        "total_current": total_current, "total_prior_average": total_prior,
        "total_change": round(total_current - total_prior, 2), "accounts": out[:top_n],
    }


def _transactions(ctx: ToolContext, args: dict) -> dict:
    code, period = _code(args), _period(args, "period")
    rows = ledger.transactions(ctx.db, ctx.scope, code, period, limit=_int(args, "limit", 15, 1, 25))
    total = round(sum(r["net"] for r in ledger.transactions(ctx.db, ctx.scope, code, period, limit=200)), 2)
    return {"account_code": code, "period": period, "account_total": total, "transactions": rows}


def _group(ctx: ToolContext, args: dict) -> dict:
    code, period = _code(args), _period(args, "period")
    by = _choice(args, "by", ("description", "reference", "source", "cost_center"), "description")
    groups: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0, "refs": []})
    for r in ledger.transactions(ctx.db, ctx.scope, code, period, limit=200):
        g = groups[(r.get(by) or "(blank)").strip()]
        g["total"] = round(g["total"] + r["net"], 2)
        g["count"] += 1
        if len(g["refs"]) < 5:
            g["refs"].append({"ref": r["ref"], "amount": r["net"], "date": r["date"]})
    out = [{"group": k, **v} for k, v in groups.items()]
    out.sort(key=lambda g: abs(g["total"]), reverse=True)
    return {"account_code": code, "period": period, "grouped_by": by, "groups": out[:20]}


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z]+", " ", (text or "").lower()).strip()


def _recurrence(ctx: ToolContext, args: dict) -> dict:
    code, period = _code(args), _period(args, "period")
    lookback = _int(args, "lookback_months", 6, 1, 12)
    current = ledger.transactions(ctx.db, ctx.scope, code, period, limit=10)
    history: dict[str, list[dict]] = defaultdict(list)
    for p in ledger.periods_between(ledger.period_add(period, -lookback), ledger.period_add(period, -1)):
        for r in ledger.transactions(ctx.db, ctx.scope, code, p, limit=200):
            history[_norm(r["description"])].append({"period": p, "amount": r["net"]})
    items = []
    for r in current:
        seen = history.get(_norm(r["description"]), [])
        items.append({
            "ref": r["ref"], "description": r["description"], "amount": r["net"],
            "seen_in_prior_months": sorted({s["period"] for s in seen}),
            "prior_amounts": [s["amount"] for s in seen][:6],
            "classification": "recurring" if len({s["period"] for s in seen}) >= 2 else "new_or_one_time",
        })
    return {
        "account_code": code, "period": period, "lookback_months": lookback, "transactions": items,
        "method": "Same normalised description posted to this account in at least two prior months = recurring.",
    }


def _budget(ctx: ToolContext, args: dict) -> dict:
    period = _period(args, "period")
    budgets = budget_by_account(ctx.db, ctx.scope.company_id, period)
    if not budgets:
        return {"period": period, "budget_available": False,
                "note": "No FP&A budget uploaded for this company and fiscal year."}
    actuals = {m["account_code"]: m for m in ledger.monthly_movements(ctx.db, ctx.scope, period, period)}
    codes = args.get("account_codes") or list(budgets)
    rows = []
    for code in codes[:50]:
        if code not in budgets:
            continue
        actual = actuals.get(code, {}).get("net", 0.0)
        budget = budgets[code]["budget"]
        rows.append({
            "account_code": code, "account_name": budgets[code]["account_name"], "actual": actual,
            "budget": budget, "variance": round(actual - budget, 2),
            "variance_pct": round((actual - budget) / budget, 4) if budget else None,
        })
    rows.sort(key=lambda r: abs(r["variance"]), reverse=True)
    return {"period": period, "budget_available": True, "accounts": rows}


def _balances(ctx: ToolContext, args: dict) -> dict:
    period = _period(args, "period")
    rows = ledger.balances_as_of(ctx.db, ctx.scope, period, account_type=_choice(args, "account_type", ACCOUNT_TYPES))
    return {"as_of_period_end": period, "balances": rows[:300], "truncated": len(rows) > 300}


def _forecast(ctx: ToolContext, args: dict) -> dict:
    code, period = _code(args), _period(args, "period")
    default_horizon = months_to_fiscal_year_end(period, ctx.fiscal_year_start) or 12
    horizon = _int(args, "months_ahead", default_horizon, 1, 12)
    cov = ledger.coverage(ctx.db, ctx.scope)
    prior = [p for p in cov["periods"] if ledger.period_add(period, -6) <= p < period]
    moves = ledger.monthly_movements(ctx.db, ctx.scope, ledger.period_add(period, -6), period, account_codes=[code])
    by_period = {m["period"]: m["net"] for m in moves}
    history = {p: by_period.get(p, 0.0) for p in prior}
    history[period] = by_period.get(period, 0.0)
    result = project_expense_impact(history, period, horizon)
    result["account_code"] = code
    return result


def _prepare_approval(ctx: ToolContext, args: dict) -> dict:
    if len(ctx.approvals) >= MAX_APPROVALS_PER_RUN:
        raise ToolInputError(f"At most {MAX_APPROVALS_PER_RUN} approval requests per investigation")
    amount = args.get("amount")
    if amount is not None and (isinstance(amount, bool) or not isinstance(amount, (int, float))):
        raise ToolInputError("amount must be a number")
    details = args.get("details")
    if details is not None and not isinstance(details, dict):
        raise ToolInputError("details must be an object")
    req = AiCfoApprovalRequest(
        workspace_id=ctx.scope.workspace_id,
        company_id=ctx.scope.company_id,
        investigation_id=ctx.investigation.id,
        finding_id=ctx.investigation.finding_id,
        action_type=_choice(args, "action_type", APPROVAL_ACTIONS),
        title=_text(args, "title", 300),
        rationale=_text(args, "rationale", 4000),
        amount=round(float(amount), 2) if amount is not None else None,
        payload_json={"account_code": args.get("account_code"), "details": details or {}},
        status="pending",
        requested_by=f"ai-agent:{ctx.investigation.agent}",
    )
    ctx.db.add(req)
    ctx.db.flush()
    ctx.approvals.append(req)
    return {"approval_request_id": req.id, "status": "pending",
            "note": "Recorded for human approval. Nothing has been executed."}


def _submit(ctx: ToolContext, args: dict) -> dict:
    conclusion = _text(args, "conclusion", 4000)
    answer = _text(args, "answer_markdown", 20000)
    drivers = args.get("drivers") or []
    if not isinstance(drivers, list):
        raise ToolInputError("drivers must be a list")
    ctx.final = {
        "conclusion": conclusion,
        "answer_markdown": answer,
        "key_figures": [f for f in (args.get("key_figures") or []) if isinstance(f, dict)][:20],
        "drivers": [d for d in drivers if isinstance(d, dict)][:20],
        "nature": _choice(args, "nature", ("one_time", "recurring", "mixed", "unclear", "not_applicable"), "unclear"),
        "impact_summary": (args.get("impact_summary") or "")[:2000] or None,
        "recommendations": [str(r)[:500] for r in (args.get("recommendations") or [])][:10],
        "limitations": [str(r)[:500] for r in (args.get("limitations") or [])][:10],
        "confidence": _choice(args, "confidence", ("low", "medium", "high"), "medium"),
    }
    return {"accepted": True}


TOOLS: dict[str, Tool] = {t.name: t for t in [
    Tool("get_data_coverage", "Which months of posted ledger data exist for this company, and known data limitations.",
         READ, {"type": "object", "properties": {}}, _coverage),
    Tool("get_account_movements", "Monthly debit, credit and net movement per account over a range of months.",
         READ, {"type": "object", "required": ["period_from", "period_to"], "properties": {
             "period_from": _PERIOD_SCHEMA, "period_to": _PERIOD_SCHEMA,
             "account_codes": {"type": "array", "items": {"type": "string"}}, "account_type": _TYPE_SCHEMA}},
         _movements),
    Tool("compare_periods", "Compare one month with the average of the prior months, per account, largest changes first.",
         ANALYSE, {"type": "object", "required": ["period"], "properties": {
             "period": _PERIOD_SCHEMA, "lookback_months": {"type": "integer", "minimum": 1, "maximum": 12},
             "account_type": _TYPE_SCHEMA, "top_n": {"type": "integer", "minimum": 1, "maximum": 30}}},
         _compare),
    Tool("get_transactions", "Posted journal lines on one account in one month, largest first, with journal references.",
         READ, {"type": "object", "required": ["account_code", "period"], "properties": {
             "account_code": {"type": "string"}, "period": _PERIOD_SCHEMA,
             "limit": {"type": "integer", "minimum": 1, "maximum": 25}}},
         _transactions),
    Tool("group_transactions", "Totals for one account and month grouped by description, reference, source or cost centre.",
         ANALYSE, {"type": "object", "required": ["account_code", "period"], "properties": {
             "account_code": {"type": "string"}, "period": _PERIOD_SCHEMA,
             "by": {"type": "string", "enum": ["description", "reference", "source", "cost_center"]}}},
         _group),
    Tool("check_recurrence", "For this month's largest lines on an account, whether similar lines appeared in prior months.",
         ANALYSE, {"type": "object", "required": ["account_code", "period"], "properties": {
             "account_code": {"type": "string"}, "period": _PERIOD_SCHEMA,
             "lookback_months": {"type": "integer", "minimum": 1, "maximum": 12}}},
         _recurrence),
    Tool("get_budget_vs_actual", "Actual versus FP&A budget per account for one month.",
         ANALYSE, {"type": "object", "required": ["period"], "properties": {
             "period": _PERIOD_SCHEMA, "account_codes": {"type": "array", "items": {"type": "string"}}}},
         _budget),
    Tool("get_balances_as_of", "Cumulative account balances at the end of a month (all posted history to date).",
         READ, {"type": "object", "required": ["period"], "properties": {"period": _PERIOD_SCHEMA, "account_type": _TYPE_SCHEMA}},
         _balances),
    Tool("forecast_impact", "Deterministic projection of an expense increase: one-time versus recurring, to fiscal year end.",
         ANALYSE, {"type": "object", "required": ["account_code", "period"], "properties": {
             "account_code": {"type": "string"}, "period": _PERIOD_SCHEMA,
             "months_ahead": {"type": "integer", "minimum": 1, "maximum": 12}}},
         _forecast),
    Tool("prepare_approval_request",
         "Draft a follow-up action for a manager to approve or reject. This never executes anything.",
         PREPARE, {"type": "object", "required": ["action_type", "title", "rationale"], "properties": {
             "action_type": {"type": "string", "enum": list(APPROVAL_ACTIONS)},
             "title": {"type": "string"}, "rationale": {"type": "string"},
             "amount": {"type": "number"}, "account_code": {"type": "string"}, "details": {"type": "object"}}},
         _prepare_approval),
    Tool("submit_findings", "Finish the investigation. Call exactly once, after gathering evidence.",
         RECOMMEND, {"type": "object", "required": ["conclusion", "answer_markdown", "confidence"], "properties": {
             "conclusion": {"type": "string", "description": "Two or three sentence conclusion."},
             "answer_markdown": {"type": "string", "description": "Full answer for the CFO in markdown."},
             "key_figures": {"type": "array", "items": {"type": "object", "properties": {
                 "label": {"type": "string"}, "value": {"type": "number"}, "source_tool": {"type": "string"}}}},
             "drivers": {"type": "array", "items": {"type": "object", "properties": {
                 "account_code": {"type": "string"}, "amount": {"type": "number"}, "explanation": {"type": "string"},
                 "refs": {"type": "array", "items": {"type": "string"}}}}},
             "nature": {"type": "string", "enum": ["one_time", "recurring", "mixed", "unclear", "not_applicable"]},
             "impact_summary": {"type": "string"},
             "recommendations": {"type": "array", "items": {"type": "string"}},
             "limitations": {"type": "array", "items": {"type": "string"}},
             "confidence": {"type": "string", "enum": ["low", "medium", "high"]}}},
         _submit),
]}

AGENT_ALLOWED_CLASSES = {
    "anomaly_investigator": {READ, ANALYSE, RECOMMEND, PREPARE},
    "cfo_analyst": {READ, ANALYSE, RECOMMEND, PREPARE},
}


def tools_for(agent: str) -> list[Tool]:
    allowed = AGENT_ALLOWED_CLASSES[agent]
    return [t for t in TOOLS.values() if t.action_class in allowed]


def collect_refs(value: Any, out: set[str]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            if k in ("ref", "journal_entry_id") and isinstance(v, str):
                out.add(v)
            else:
                collect_refs(v, out)
    elif isinstance(value, list):
        for v in value:
            collect_refs(v, out)
