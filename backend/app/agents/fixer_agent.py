"""FIXER — reads AUDITOR output, proposes numeric patches via LLM, applies up to three loops."""
from __future__ import annotations

import json
import re
from decimal import Decimal

from sqlalchemy.orm import Session

from app.agents.agent_models import MAX_FIXER_LOOPS, MODEL_FIXER
from app.agents.auditor_agent import run_auditor
from app.agents.base_agent import AgentContext
from app.models.ifrs_statement import GeneratedStatement, StatementLineItem
from app.services.llm_service import invoke, is_configured


def _stmt_lines_snapshot(db: Session, trial_balance_id: int, tenant_id: str) -> list[dict]:
    out: list[dict] = []
    stmts = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
        )
        .all()
    )
    for s in stmts:
        for li in (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == s.id)
            .order_by(StatementLineItem.display_order)
            .all()
        ):
            out.append(
                {
                    "id": li.id,
                    "statement_type": s.statement_type.value,
                    "line": li.ifrs_line_item,
                    "amount": float(li.amount or 0),
                }
            )
    return out


def run_fixer(ctx: AgentContext, auditor_dict: dict) -> bool:
    """Return True if auditor eventually passes."""
    agent_id = "FIXER"
    if auditor_dict.get("all_passed"):
        ctx.emit(agent_id, "No fixes required — AUDITOR clean.")
        return True

    if not is_configured():
        ctx.emit(agent_id, "ANTHROPIC_API_KEY missing — cannot auto-fix; escalate to human.")
        return False

    for loop in range(MAX_FIXER_LOOPS):
        ctx.emit(agent_id, f"Fix loop {loop + 1}/{MAX_FIXER_LOOPS}")
        snap = _stmt_lines_snapshot(ctx.db, ctx.trial_balance_id, ctx.tenant_id)
        prompt = f"""You are a CFO controller. Auditor failed checks: {json.dumps(auditor_dict)}

Statement lines (subset, id + amount):
{json.dumps(snap[:120])}

Return ONLY JSON: {{"patches":[{{"line_id": <int>, "amount": <number>}}]}}
Rules: minimal patches; only adjust clearly wrong subtotals; max 8 patches."""
        raw = invoke(
            prompt,
            max_tokens=1200,
            temperature=0.1,
            model_id=MODEL_FIXER,
            system="Return JSON only.",
        )
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            continue
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            continue
        patches = data.get("patches") or []
        for p in patches[:12]:
            lid = int(p.get("line_id", 0))
            amt = Decimal(str(p.get("amount", 0)))
            li = ctx.db.query(StatementLineItem).filter(StatementLineItem.id == lid).first()
            if li:
                li.amount = amt
                li.is_manual_override = True
        ctx.db.commit()

        req = bool(
            ctx.shared.get("prior_trial_balance_id")
            or ctx.shared.get("prior_vault_snapshot")
            or ctx.shared.get("manual_prior")
        )
        res = run_auditor(
            ctx.db,
            ctx.trial_balance_id,
            ctx.tenant_id,
            prior_trial_balance_id=ctx.shared.get("prior_trial_balance_id"),
            prior_vault_statements=(ctx.shared.get("prior_vault_snapshot") or {}).get("statements"),
            manual_prior=ctx.shared.get("manual_prior"),
            require_comparative=req,
        ).to_dict()
        ctx.shared["last_auditor"] = res
        if res.get("all_passed"):
            ctx.emit(agent_id, "AUDITOR re-run passed after patches.")
            return True
        auditor_dict = res

    ctx.emit(agent_id, "Max fix loops reached — human review required.")
    return False
