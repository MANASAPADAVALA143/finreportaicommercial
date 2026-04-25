"""MAPPER — wraps Week 1 GL AI mapping + harness validation (no edits to Week 1 modules)."""
from __future__ import annotations

import time

from sqlalchemy.orm import Session

from app.agents.agent_models import CONFIDENCE_AUTO, CONFIDENCE_HUMAN
from app.agents.base_agent import AgentContext, BaseAgent
from app.models.ifrs_agentic import AgentHumanReview, AgentRun, HumanReviewStatus
from app.models.ifrs_statement import GLMapping, TBStatus, TrialBalance


class MapperAgent(BaseAgent):
    agent_id = "MAPPER"

    def run(self) -> None:
        ctx = self.ctx
        ctx.emit(self.agent_id, "Starting GL→IFRS mapping (Week 1 job).")
        tb = (
            ctx.db.query(TrialBalance)
            .filter(
                TrialBalance.id == ctx.trial_balance_id,
                TrialBalance.tenant_id == ctx.tenant_id,
            )
            .first()
        )
        if not tb:
            raise RuntimeError("Trial balance not found")

        # Lazy import avoids heavy route import at package load.
        from app.api.routes.ifrs_week1 import run_ai_mapping_job
        from app.services.mapping_validator import validate_mappings

        if tb.status in (TBStatus.uploaded, TBStatus.mapping_in_progress):
            run_ai_mapping_job(ctx.trial_balance_id, ctx.tenant_id, allow_remapping=True)

        # Wait for mapping job to finish
        for _ in range(180):
            ctx.db.expire_all()
            tb = (
                ctx.db.query(TrialBalance)
                .filter(TrialBalance.id == ctx.trial_balance_id)
                .first()
            )
            if tb and tb.status != TBStatus.mapping_in_progress:
                break
            time.sleep(1)

        validate_mappings(ctx.trial_balance_id, ctx.db, apply_routing=True, apply_fixes=True)

        mappings = (
            ctx.db.query(GLMapping)
            .filter(
                GLMapping.trial_balance_id == ctx.trial_balance_id,
                GLMapping.tenant_id == ctx.tenant_id,
            )
            .all()
        )
        auto_n = sum(1 for m in mappings if float(m.ai_confidence_score or 0) >= CONFIDENCE_AUTO)
        low = [m for m in mappings if float(m.ai_confidence_score or 0) < CONFIDENCE_HUMAN]
        ctx.emit(self.agent_id, f"Mappings: {len(mappings)} rows; ≥{CONFIDENCE_AUTO:.0%} auto: {auto_n}; <{CONFIDENCE_HUMAN:.0%} review: {len(low)}.")

        from app.models.ifrs_statement import MappingTemplate

        tmpl = (
            ctx.db.query(MappingTemplate)
            .filter(MappingTemplate.tenant_id == ctx.tenant_id, MappingTemplate.is_default == True)  # noqa: E712
            .order_by(MappingTemplate.id.desc())
            .first()
        )
        if tmpl and tmpl.entries:
            ctx.emit(
                self.agent_id,
                f"Default mapping template '{tmpl.template_name}' available ({len(tmpl.entries or [])} rows) — Map Once Use Forever.",
            )

        run_row = ctx.db.query(AgentRun).filter(AgentRun.id == ctx.agent_run_db_id).first()
        if run_row:
            for m in low[:50]:
                ctx.db.add(
                    AgentHumanReview(
                        agent_run_id=run_row.id,
                        item=f"GL {m.gl_code} — confidence {float(m.ai_confidence_score or 0):.0%}; confirm mapping in IFRS Statement page.",
                        status=HumanReviewStatus.pending,
                    )
                )
            ctx.db.commit()

        ctx.shared["mapper_low_confidence_count"] = len(low)
