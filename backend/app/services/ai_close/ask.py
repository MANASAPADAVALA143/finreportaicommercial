"""'Ask this agent': run one agent (with the agents it depends on) as a preview and answer the
user's request from that run's validated output.

The agent does the work; Claude only phrases the answer, and only from the results. Any number in
the answer that is not in the results discards it and the computed answer is used instead. Ask
runs never prepare journals or close a period: proposed entries are listed as a preview.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseException, AiCloseRun
from app.services.ai_cfo.ledger import period_add
from app.services.ai_close import orchestrator
from app.services.ai_close.agents import AGENTS
from app.services.ai_close.cfo_agent import unverified_numbers

logger = logging.getLogger(__name__)

ASKABLE = ("bank_reconciliation", "ap_processing", "ar_intelligence", "ifrs", "fpa", "consolidation", "close_manager",
           "cfo_intelligence")
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
_ISO = re.compile(r"\b(20\d{2})-(0[1-9]|1[0-2])\b")
_NAMED = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+(20\d{2}))?\b", re.I)
_SKIP_LISTS = {"register", "invoices", "unmatched_items", "accounts", "entities", "customers", "checks", "group_pl", "group_bs"}


def period_from_prompt(prompt: str, latest: str | None) -> str | None:
    """'2026-10', 'October', 'Oct 2026' → a YYYY-MM period; a bare month is its latest occurrence up to `latest`."""
    m = _ISO.search(prompt or "")
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = _NAMED.search(prompt or "")
    if not m:
        return None
    month = MONTHS[m.group(1).lower()[:3]]
    if m.group(2):
        return f"{m.group(2)}-{month:02d}"
    if not latest:
        return None
    candidate = f"{latest[:4]}-{month:02d}"
    return candidate if candidate <= latest else period_add(candidate, -12)


def plan(agent: str, scope: str) -> tuple[list[str], list[str]]:
    """(selectable agents to run, tail agents) for asking `agent`."""
    if agent in orchestrator.SELECTABLE:
        return orchestrator.with_dependencies([agent]), []
    if agent == "consolidation":
        return [], ["consolidation"]
    if agent == "close_manager":
        return [], ["close_manager"]
    return list(orchestrator.SELECTABLE), (["consolidation"] if scope == "group" else []) + ["close_manager", "cfo_intelligence"]


def _compact(value: Any, depth: int = 0) -> Any:
    if isinstance(value, dict):
        return {k: _compact(v, depth + 1) for k, v in value.items() if k not in _SKIP_LISTS or depth > 1}
    if isinstance(value, list):
        return [_compact(v, depth + 1) for v in value[:12]]
    return value


def facts(db: Session, run: AiCloseRun, agent: str) -> dict[str, Any]:
    tasks = {t.agent: t for t in orchestrator.tasks_of(db, run)}
    task = tasks.get(agent)
    exceptions = db.query(AiCloseException).filter(AiCloseException.run_id == run.id, AiCloseException.agent == agent).all()
    exceptions.sort(key=lambda e: ({"high": 0, "medium": 1, "low": 2}.get(e.severity, 9), -abs(e.amount or 0)))
    out = (task.output_json or {}) if task else {}
    return {
        "agent": AGENTS[agent][0], "period": run.period, "status": task.status if task else "not_run",
        "updates": task.messages_json if task else [],
        "checks": [{"check": c["detail"], "passed": c["passed"]} for c in (task.validation_json or [])] if task else [],
        "results": _compact(out),
        "exceptions": [{"severity": e.severity, "title": e.title, "amount": e.amount} for e in exceptions[:15]],
        "exceptions_total": len(exceptions),
        "proposed_journals": [{"title": j["title"], "amount": j["amount"], "entity": j["entity"]}
                              for j in out.get("proposed_journals", [])][:15],
    }


def computed_answer(f: dict[str, Any]) -> str:
    parts = [f"{f['agent']} — {f['period']}: {f['status'].replace('_', ' ')}."]
    parts += [u for u in f["updates"]]
    if f["exceptions_total"]:
        parts.append(f"{f['exceptions_total']} exception(s), most significant:")
        parts += [f"• [{e['severity']}] {e['title']}" for e in f["exceptions"][:5]]
    if f["proposed_journals"]:
        parts.append("Journals that would be proposed (run the month-end close to send them for approval):")
        parts += [f"• {j['title']}" + (f" — {j['entity']}" if j["entity"] else "") for j in f["proposed_journals"][:5]]
    failed = [c["check"] for c in f["checks"] if not c["passed"]]
    if failed:
        parts.append("Checks not passed: " + "; ".join(failed[:3]))
    return "\n".join(parts)


def answer(db: Session, run: AiCloseRun, agent: str, prompt: str) -> dict[str, Any]:
    from app.services import llm_service

    f = facts(db, run, agent)
    if f["status"] not in ("completed", "completed_with_exceptions"):
        return {"text": computed_answer(f), "source": "computed", "note": "The agent did not complete, so no AI answer was drafted."}
    if not llm_service.is_configured():
        return {"text": computed_answer(f), "source": "computed", "note": "AI model not configured; computed answer shown."}
    request = (
        f"A finance user asked the {f['agent']}: \"{prompt.strip()[:1500]}\"\n\n"
        "The agent has run. Answer the request in under 230 words using ONLY the results below. Quote figures exactly as "
        "written (two decimals, thousands separators); do not compute new totals or percentages. If the results do not "
        "cover part of the request, say so plainly. End with the next action for the user.\n\nRESULTS:\n"
        + json.dumps(f, default=str)
    )
    try:
        text = llm_service.chat([{"role": "user", "content": request}],
                                system="You are a precise finance agent reporting your own completed work. Never invent numbers.",
                                max_tokens=700).strip()
    except Exception as exc:  # noqa: BLE001 - the computed answer stands in
        logger.warning("ai-close ask answer failed: %s", exc)
        return {"text": computed_answer(f), "source": "computed", "note": f"AI answer unavailable ({type(exc).__name__})."}
    bad = unverified_numbers(text, f)
    if bad:
        return {"text": computed_answer(f), "source": "computed",
                "note": f"AI answer discarded: it cited figures not in the results ({', '.join(bad[:5])})."}
    return {"text": text, "source": "ai", "note": None}


def finish(session_factory, run_id: int, max_workers: int) -> None:
    """Execute the ask run, then store the answer on it."""
    orchestrator.execute_run(run_id, session_factory, max_workers=max_workers)
    db = session_factory()
    try:
        run = db.get(AiCloseRun, run_id)
        ask = dict(run.ask_json or {})
        try:
            ask["answer"] = answer(db, run, ask["agent"], ask.get("prompt") or "")
        except Exception as exc:  # noqa: BLE001
            logger.exception("ai-close ask %s answer failed", run_id)
            ask["answer"] = {"text": "The agent ran but the answer could not be prepared.", "source": "computed",
                             "note": type(exc).__name__}
        run.ask_json = ask
        db.commit()
    finally:
        db.close()
