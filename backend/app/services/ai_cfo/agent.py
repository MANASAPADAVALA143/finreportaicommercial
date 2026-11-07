"""Tool-using AI CFO agents: investigate a finding or answer a CFO question.

The model chooses which tools to call; every figure comes from those tools. A run ends
when the model calls `submit_findings` (or the step limit is hit). Journal references the
model cites that no tool returned are flagged as unverified rather than trusted.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_cfo import AiCfoFinding, AiCfoInvestigation, AiCfoToolCall
from app.models.company_setup import UaeCompanyProfile
from app.services import llm_service
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_cfo.tools import TOOLS, ToolContext, ToolInputError, collect_refs, tools_for

logger = logging.getLogger(__name__)

MAX_STEPS = 12
MAX_TOKENS_PER_TURN = 2500
MAX_TOOL_RESULT_CHARS = 12000

SYSTEM_PROMPT = """You are the Gnanova AI CFO investigation agent, a senior financial analyst working for the CFO of {company}.

You have tools that query this company's posted general ledger and FP&A budget. Rules:
- Every figure you state must come from a tool result. Do not estimate, add up or invent numbers yourself; call a tool instead (compare_periods, get_transactions, forecast_impact and get_budget_vs_actual return totals).
- Cite journal references exactly as tools return them (the "ref" field) when you explain a driver.
- Distinguish one-time from recurring costs using check_recurrence, not assumption.
- If data is missing or thin, say so plainly in limitations. Never claim you checked something you did not.
- Do not conclude that anything is fraud or an error; describe what the records show and what should be verified.
- You cannot post journals, pay, change budgets or contact anyone. When a follow-up needs human sign-off, use prepare_approval_request (at most three). It only records a request.
- Amounts are in {currency}. Today is {today}.
- Finish by calling submit_findings exactly once. answer_markdown is what the CFO reads: lead with the conclusion, then the drivers with figures and refs, the impact, and recommended actions."""


def _scope(inv: AiCfoInvestigation) -> LedgerScope:
    return LedgerScope(inv.workspace_id, inv.company_id)


def _brief(result: dict[str, Any]) -> str:
    text = json.dumps(result, default=str)
    return text if len(text) <= 400 else text[:397] + "..."


def _opening_message(db: Session, inv: AiCfoInvestigation, scope: LedgerScope) -> str:
    cov = ledger.coverage(db, scope)
    lines = [
        f"Ledger coverage: posted months {cov['first_period'] or 'none'} to {cov['last_period'] or 'none'} "
        f"({len(cov['periods'])} months, {cov['posted_lines']} posted lines).",
    ]
    if cov["limitations"]:
        lines.append("Known limitations: " + " ".join(cov["limitations"]))
    finding = db.get(AiCfoFinding, inv.finding_id) if inv.finding_id else None
    if finding is not None:
        lines += [
            "",
            "Investigate this detected anomaly:",
            f"- Type: {finding.kind}; month: {finding.period}; account: {finding.account_code} {finding.account_name}",
            f"- Detection: {finding.detection_reason}",
            f"- Metrics: {json.dumps(finding.metrics_json or {}, default=str)}",
            "",
            "Find the transactions driving it, whether they are one-time or recurring, the projected impact on "
            "operating profit, and the corrective actions to recommend.",
        ]
    lines += ["", f"CFO request: {inv.question}"]
    return "\n".join(lines)


def _record(
    db: Session, inv: AiCfoInvestigation, step: int, name: str, action_class: str, args: dict,
    result: dict, refs: set[str], is_error: bool, started: float,
) -> None:
    db.add(AiCfoToolCall(
        investigation_id=inv.id, workspace_id=inv.workspace_id, company_id=inv.company_id, step=step,
        tool_name=name[:64], action_class=action_class, input_json=args,
        output_summary=_brief(result), refs=sorted(refs)[:50], is_error=1 if is_error else 0,
        duration_ms=int((time.monotonic() - started) * 1000),
    ))


def _run_tool(ctx: ToolContext, allowed: set[str], step: int, call: dict) -> tuple[dict, bool]:
    name, args = call["name"], call.get("input") or {}
    tool = TOOLS.get(name)
    started = time.monotonic()
    refs: set[str] = set()
    if tool is None or name not in allowed:
        result, is_error = {"error": f"Tool {name} is not available to this agent"}, True
        action_class = tool.action_class if tool else "unknown"
    else:
        action_class = tool.action_class
        try:
            result, is_error = tool.handler(ctx, args), False
            collect_refs(result, refs)
            ctx.seen_refs |= refs
        except ToolInputError as exc:
            result, is_error = {"error": str(exc)}, True
        except Exception as exc:  # noqa: BLE001 - report to the model, keep the run alive
            logger.warning("ai-cfo tool %s failed: %s", name, exc)
            ctx.db.rollback()
            result, is_error = {"error": "The tool failed while reading the data."}, True
    _record(ctx.db, ctx.investigation, step, name, action_class, args, result, refs, is_error, started)
    return result, is_error


def _unverified(final: dict, seen: set[str]) -> list[str]:
    cited = {str(r) for d in final.get("drivers", []) for r in (d.get("refs") or [])}
    return sorted(cited - seen)


def run_investigation(db: Session, inv: AiCfoInvestigation) -> AiCfoInvestigation:
    scope = _scope(inv)
    profile = db.get(UaeCompanyProfile, inv.company_id)
    ctx = ToolContext(
        db=db, scope=scope, investigation=inv, user_email=inv.requested_by,
        fiscal_year_start=(profile.financial_year_start if profile and profile.financial_year_start else 1),
    )
    available = tools_for(inv.agent)
    allowed = {t.name for t in available}
    system = SYSTEM_PROMPT.format(
        company=profile.company_name if profile else "this company",
        currency=(profile.base_currency if profile else None) or "AED",
        today=datetime.now(timezone.utc).date().isoformat(),
    )
    messages: list[dict] = [{"role": "user", "content": _opening_message(db, inv, scope)}]
    inv.status, inv.started_at = "running", datetime.now(timezone.utc)
    db.commit()

    nudged = False
    step = 0
    try:
        while step < MAX_STEPS and ctx.final is None:
            turn = llm_service.chat_with_tools(
                messages, [t.spec() for t in available], system=system, max_tokens=MAX_TOKENS_PER_TURN,
            )
            inv.model = turn.get("model")
            content = turn.get("content") or []
            messages.append({"role": "assistant", "content": content})
            calls = [b for b in content if b.get("type") == "tool_use"]
            if not calls:
                if nudged:
                    break
                nudged = True
                messages.append({"role": "user", "content": "Call submit_findings now with your evidence-backed answer."})
                continue
            results = []
            for call in calls:
                step += 1
                result, is_error = _run_tool(ctx, allowed, step, call)
                text = json.dumps(result, default=str)
                results.append({
                    "type": "tool_result", "tool_use_id": call["id"],
                    "content": text[:MAX_TOOL_RESULT_CHARS], "is_error": is_error,
                })
            messages.append({"role": "user", "content": results})
            inv.steps = step
            db.commit()
    except llm_service.LLMNotConfiguredError:
        _fail(db, inv, "The AI model is not configured on this server.")
        return inv
    except llm_service.LLMRateLimitError as exc:
        _fail(db, inv, str(exc))
        return inv
    except Exception as exc:  # noqa: BLE001
        logger.exception("ai-cfo investigation %s failed", inv.id)
        _fail(db, inv, f"The investigation stopped unexpectedly: {type(exc).__name__}")
        return inv

    inv.steps = step
    if ctx.final is None:
        _fail(db, inv, f"The agent did not finish within {MAX_STEPS} tool calls.")
        return inv
    inv.result_json = {**ctx.final, "approval_request_ids": [a.id for a in ctx.approvals]}
    inv.answer_markdown = ctx.final["answer_markdown"]
    inv.unverified_refs = _unverified(ctx.final, ctx.seen_refs)
    inv.status, inv.finished_at = "completed", datetime.now(timezone.utc)
    if inv.finding_id:
        finding = db.get(AiCfoFinding, inv.finding_id)
        if finding is not None and finding.status == "open":
            finding.status = "investigated"
    db.commit()
    db.refresh(inv)
    return inv


def _fail(db: Session, inv: AiCfoInvestigation, message: str) -> None:
    db.rollback()
    inv = db.merge(inv)
    inv.status, inv.error, inv.finished_at = "failed", message, datetime.now(timezone.utc)
    db.commit()


def run_investigation_job(investigation_id: int) -> None:
    """Background entry point with its own session."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        inv = db.get(AiCfoInvestigation, investigation_id)
        if inv is not None and inv.status == "queued":
            run_investigation(db, inv)
    finally:
        db.close()
