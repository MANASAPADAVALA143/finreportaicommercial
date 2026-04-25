"""NARRATOR — CFO-style commentary (four sections) using actual TB + statement figures."""
from __future__ import annotations

import json
import re

from app.agents.agent_models import MODEL_NARRATOR
from app.agents.base_agent import AgentContext, BaseAgent
from app.agents.auditor_agent import _line_index
from app.services.llm_service import invoke, is_configured
from app.services.statement_generator import build_tb_data_from_db


class NarratorAgent(BaseAgent):
    agent_id = "NARRATOR"

    def run(self) -> None:
        ctx = self.ctx
        if not is_configured():
            ctx.shared["commentary"] = {
                "financial_highlights": "Commentary skipped — configure ANTHROPIC_API_KEY.",
                "variance_yoy": "",
                "liquidity_going_concern": "",
                "outlook_risks": "",
            }
            ctx.emit(self.agent_id, "Skipped (no LLM).")
            return

        tb_data = build_tb_data_from_db(
            ctx.trial_balance_id,
            ctx.db,
            prior_trial_balance_id=ctx.shared.get("prior_trial_balance_id"),
            manual_prior=ctx.shared.get("manual_prior"),
        )
        idx = _line_index(ctx.db, ctx.trial_balance_id, ctx.tenant_id)
        pl = idx.get("profit_loss", {})
        fp = idx.get("financial_position", {})
        prior_pl = prior_fp = {}
        pid = ctx.shared.get("prior_trial_balance_id")
        if pid:
            pidx = _line_index(ctx.db, int(pid), ctx.tenant_id)
            prior_pl = pidx.get("profit_loss", {})
            prior_fp = pidx.get("financial_position", {})

        def _pick_amt(block: dict, needle: str) -> float:
            needle_l = needle.casefold()
            for k, v in block.items():
                if needle_l in k:
                    return float(v)
            return 0.0

        kpis = {
            "company": tb_data.get("company_name"),
            "currency": tb_data.get("currency"),
            "period_end": str(tb_data.get("period_end")),
            "total_revenue": _pick_amt(pl, "total revenue"),
            "profit_for_period": _pick_amt(pl, "profit for the period"),
            "total_assets": _pick_amt(fp, "total assets"),
            "total_equity": _pick_amt(fp, "total equity"),
            "prior_period_end": tb_data.get("prior_period_end"),
            "prior_total_revenue": _pick_amt(prior_pl, "total revenue") if prior_pl else tb_data.get("prior_revenue"),
            "prior_total_assets": _pick_amt(prior_fp, "total assets") if prior_fp else tb_data.get("prior_total_assets"),
            "prior_cash": _pick_amt(prior_fp, "cash and cash equivalents") if prior_fp else tb_data.get("prior_cash"),
        }
        prompt = f"""Using ONLY these JSON figures (do not invent other numbers), write CFO board-level prose.

Data: {json.dumps(kpis, default=str)}

Produce exactly four sections as JSON keys:
1) financial_highlights — max 3 short paragraphs
2) variance_yoy — max 3 paragraphs; MUST quantify YoY change using current vs prior revenue (and cash if present) when prior figures exist; otherwise state comparatives not loaded
3) liquidity_going_concern — max 3 paragraphs
4) outlook_risks — max 3 paragraphs

Return ONLY valid JSON with those four string keys."""
        raw = invoke(
            prompt,
            max_tokens=2500,
            temperature=0.35,
            model_id=MODEL_NARRATOR,
            system="You are a group CFO. Formal, precise, no fabricated metrics.",
        )
        m = re.search(r"\{[\s\S]*\}", raw)
        parsed = {}
        if m:
            try:
                parsed = json.loads(m.group(0))
            except json.JSONDecodeError:
                parsed = {}
        ctx.shared["commentary"] = {
            "financial_highlights": parsed.get("financial_highlights", raw[:2000]),
            "variance_yoy": parsed.get("variance_yoy", ""),
            "liquidity_going_concern": parsed.get("liquidity_going_concern", ""),
            "outlook_risks": parsed.get("outlook_risks", ""),
        }
        ctx.emit(self.agent_id, "CFO narrative drafted.")
