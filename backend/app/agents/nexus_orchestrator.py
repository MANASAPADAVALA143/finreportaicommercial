"""NEXUS — orchestrates sequential agents with retries, persistence, and pause/resume hooks."""
from __future__ import annotations

import logging
import traceback
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.agents.agent_models import MAX_AGENT_RETRIES
from app.agents.auditor_agent import ALL_AUDITOR_CHECKS, run_auditor
from app.agents.base_agent import AgentContext
from app.agents.builder_agent import BuilderAgent
from app.agents.fixer_agent import run_fixer
from app.agents.mapper_agent import MapperAgent
from app.agents.narrator_agent import NarratorAgent
from app.agents.packager_agent import PackagerAgent
from app.agents.scribe_agent import ScribeAgent
from app.models.ifrs_agentic import (
    AgentHumanReview,
    AgentRun,
    AgentRunLog,
    AgentRunStatus,
    AgentValidation,
    HumanReviewStatus,
)
from app.models.ifrs_statement import TrialBalance
from app.services.ifrs_vault_service import (
    load_prior_snapshot_from_vault,
    resolve_prior_trial_balance_id,
    upsert_vault_statements,
)
from app.services.mapping_validator import validate_mappings

logger = logging.getLogger(__name__)

ORDER = ["MAPPER", "BUILDER", "AUDITOR", "FIXER", "SCRIBE", "NARRATOR", "PACKAGER"]


def _append_log(db: Session, run_db_id: int, agent_id: str, message: str) -> None:
    db.add(AgentRunLog(agent_run_id=run_db_id, agent_id=agent_id, message=message, timestamp=datetime.utcnow()))
    db.commit()


def _set_progress(db: Session, run: AgentRun, agent: str | None, pct: float, completed: list | None = None) -> None:
    run.current_agent = agent
    run.progress_pct = pct
    if completed is not None:
        run.agents_completed = completed
    run.updated_at = datetime.utcnow()
    db.commit()


def _persist_auditor(db: Session, run_db_id: int, auditor_dict: dict) -> None:
    db.query(AgentValidation).filter(AgentValidation.agent_run_id == run_db_id).delete(synchronize_session=False)
    failed = list(auditor_dict.get("failed_checks") or [])
    errs = list(auditor_dict.get("errors") or [])
    failed_set = set(failed)
    for i, name in enumerate(failed):
        db.add(
            AgentValidation(
                agent_run_id=run_db_id,
                check_name=name,
                passed=False,
                error=errs[i] if i < len(errs) else "failed",
            )
        )
    for name in ALL_AUDITOR_CHECKS:
        if name in failed_set:
            continue
        db.add(AgentValidation(agent_run_id=run_db_id, check_name=name, passed=True, error=None))
    db.commit()


def _snapshot_statements(db: Session, trial_balance_id: int, tenant_id: str) -> dict:
    from app.models.ifrs_statement import GeneratedStatement, StatementLineItem

    out: dict = {}
    stmts = (
        db.query(GeneratedStatement)
        .filter(
            GeneratedStatement.trial_balance_id == trial_balance_id,
            GeneratedStatement.tenant_id == tenant_id,
        )
        .all()
    )
    for s in stmts:
        lines = (
            db.query(StatementLineItem)
            .filter(StatementLineItem.statement_id == s.id)
            .order_by(StatementLineItem.display_order)
            .all()
        )
        out[s.statement_type.value] = [
            {"line": li.ifrs_line_item, "amount": float(li.amount or 0)} for li in lines[:200]
        ]
    return out


def _snapshot_notes(db: Session, trial_balance_id: int, tenant_id: str) -> list[dict]:
    from app.models.ifrs_statement import DisclosureNote

    notes = (
        db.query(DisclosureNote)
        .filter(
            DisclosureNote.trial_balance_id == trial_balance_id,
            DisclosureNote.tenant_id == tenant_id,
        )
        .order_by(DisclosureNote.note_number)
        .all()
    )
    return [
        {
            "code": n.note_code,
            "title": n.note_title,
            "preview": (n.user_edited_content or n.ai_generated_content or "")[:400],
        }
        for n in notes
    ]


def execute_agentic_pipeline(public_run_id: str, tenant_id: str, trial_balance_id: int) -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        run = db.query(AgentRun).filter(AgentRun.run_id == public_run_id).one_or_none()
        if not run:
            logger.error("AgentRun not found: %s", public_run_id)
            return
        _run_pipeline_body(db, run, tenant_id, trial_balance_id, resume_from=None)
    except Exception:
        logger.exception("agentic pipeline failed")
        try:
            run = db.query(AgentRun).filter(AgentRun.run_id == public_run_id).one_or_none()
            if run:
                run.status = AgentRunStatus.failed
                run.error_message = traceback.format_exc()[:8000]
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def resume_agentic_pipeline(public_run_id: str, tenant_id: str, resume_from: str) -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        run = db.query(AgentRun).filter(AgentRun.run_id == public_run_id).one_or_none()
        if not run:
            return
        tb_id = run.trial_balance_id
        _run_pipeline_body(db, run, tenant_id, tb_id, resume_from=resume_from)
    except Exception:
        logger.exception("agentic resume failed")
        try:
            run = db.query(AgentRun).filter(AgentRun.run_id == public_run_id).one_or_none()
            if run:
                run.status = AgentRunStatus.failed
                run.error_message = traceback.format_exc()[:8000]
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def _run_with_retries(db: Session, run: AgentRun, label: str, fn, agent_name: str) -> None:
    last_exc: Exception | None = None
    for attempt in range(1, MAX_AGENT_RETRIES + 1):
        try:
            fn()
            return
        except Exception as e:
            last_exc = e
            _append_log(db, run.id, agent_name, f"Attempt {attempt} failed: {e!s}")
            logger.warning("%s attempt %s failed: %s", label, attempt, e)
    raise last_exc if last_exc else RuntimeError(label)


def _run_pipeline_body(
    db: Session,
    run: AgentRun,
    tenant_id: str,
    trial_balance_id: int,
    resume_from: str | None,
) -> None:
    tb = (
        db.query(TrialBalance)
        .filter(TrialBalance.id == trial_balance_id, TrialBalance.tenant_id == tenant_id)
        .first()
    )
    if not tb:
        run.status = AgentRunStatus.failed
        run.error_message = "Trial balance not found"
        db.commit()
        return

    run.status = AgentRunStatus.running
    db.commit()

    def log(agent_id: str, message: str) -> None:
        _append_log(db, run.id, agent_id, message)

    ctx = AgentContext(db, run.id, run.run_id, tenant_id, trial_balance_id, log)
    ctx.shared["manual_prior"] = run.manual_prior_json
    ctx.shared["prior_trial_balance_id"] = None
    ctx.shared.pop("prior_vault_snapshot", None)
    if run.prior_trial_balance_id:
        ctx.shared["prior_trial_balance_id"] = run.prior_trial_balance_id
    elif tb.period_end:
        auto = resolve_prior_trial_balance_id(db, tenant_id, tb.company_name, tb.period_end, None)
        if auto:
            ctx.shared["prior_trial_balance_id"] = auto
        else:
            snap = load_prior_snapshot_from_vault(db, tenant_id, tb.company_name, tb.period_end.year - 1)
            if snap:
                ctx.shared["prior_vault_snapshot"] = snap
    log(
        "NEXUS",
        f"Comparative sources: prior_tb={ctx.shared.get('prior_trial_balance_id')} "
        f"vault={'yes' if ctx.shared.get('prior_vault_snapshot') else 'no'} "
        f"manual={'yes' if ctx.shared.get('manual_prior') else 'no'}",
    )

    completed: list[str] = list(run.agents_completed or [])

    start_idx = 0
    if resume_from and resume_from in ORDER:
        start_idx = ORDER.index(resume_from)

    pct_map = {"MAPPER": 12, "BUILDER": 30, "AUDITOR": 45, "FIXER": 60, "SCRIBE": 78, "NARRATOR": 90, "PACKAGER": 100}

    log("NEXUS", f"Plan: {' → '.join(ORDER[start_idx:])} (resume_from={resume_from})")

    try:
        if start_idx > 0:
            summ = validate_mappings(trial_balance_id, db, apply_routing=True, apply_fixes=True)
            if not summ.get("ready_to_generate"):
                run.status = AgentRunStatus.paused
                run.pause_reason = "mapper_review"
                run.resume_from_agent = "BUILDER"
                db.add(
                    AgentHumanReview(
                        agent_run_id=run.id,
                        item="Resume blocked — mappings still not ready_to_generate. Fix in IFRS Statement page.",
                        status=HumanReviewStatus.pending,
                    )
                )
                db.commit()
                log("NEXUS", "Paused on resume — harness not ready.")
                return

        if start_idx <= 0:
            _set_progress(db, run, "MAPPER", 5, completed)
            _run_with_retries(
                db,
                run,
                "MAPPER",
                lambda: MapperAgent(ctx).run(),
                "MAPPER",
            )
            summ = validate_mappings(trial_balance_id, db, apply_routing=True, apply_fixes=True)
            if not summ.get("ready_to_generate"):
                run.status = AgentRunStatus.paused
                run.pause_reason = "mapper_review"
                run.resume_from_agent = "BUILDER"
                db.add(
                    AgentHumanReview(
                        agent_run_id=run.id,
                        item="Mappings not ready for statement generation — resolve harness blocks in IFRS Statement page, then POST human-input to continue.",
                        status=HumanReviewStatus.pending,
                    )
                )
                db.commit()
                log("NEXUS", "Paused — mapping harness not ready_to_generate.")
                return
            if "MAPPER" not in completed:
                completed.append("MAPPER")
            _set_progress(db, run, "MAPPER", pct_map["MAPPER"], completed)

        if start_idx <= 1:
            _set_progress(db, run, "BUILDER", pct_map["MAPPER"] + 2, completed)
            _run_with_retries(
                db,
                run,
                "BUILDER",
                lambda: BuilderAgent(ctx).run(),
                "BUILDER",
            )
            if "BUILDER" not in completed:
                completed.append("BUILDER")
            _set_progress(db, run, "BUILDER", pct_map["BUILDER"], completed)

        if start_idx <= 2:
            _set_progress(db, run, "AUDITOR", pct_map["BUILDER"] + 2, completed)
            req = bool(
                ctx.shared.get("prior_trial_balance_id")
                or ctx.shared.get("prior_vault_snapshot")
                or ctx.shared.get("manual_prior")
            )
            aud = run_auditor(
                db,
                trial_balance_id,
                tenant_id,
                prior_trial_balance_id=ctx.shared.get("prior_trial_balance_id"),
                prior_vault_statements=(ctx.shared.get("prior_vault_snapshot") or {}).get("statements"),
                manual_prior=ctx.shared.get("manual_prior"),
                require_comparative=req,
            ).to_dict()
            ctx.shared["last_auditor"] = aud
            _persist_auditor(db, run.id, aud)
            if "AUDITOR" not in completed:
                completed.append("AUDITOR")
            _set_progress(db, run, "AUDITOR", pct_map["AUDITOR"], completed)

        if start_idx <= 3:
            _set_progress(db, run, "FIXER", pct_map["AUDITOR"] + 2, completed)
            req = bool(
                ctx.shared.get("prior_trial_balance_id")
                or ctx.shared.get("prior_vault_snapshot")
                or ctx.shared.get("manual_prior")
            )
            aud = ctx.shared.get("last_auditor") or run_auditor(
                db,
                trial_balance_id,
                tenant_id,
                prior_trial_balance_id=ctx.shared.get("prior_trial_balance_id"),
                prior_vault_statements=(ctx.shared.get("prior_vault_snapshot") or {}).get("statements"),
                manual_prior=ctx.shared.get("manual_prior"),
                require_comparative=req,
            ).to_dict()
            ok = run_fixer(ctx, aud)
            last = ctx.shared.get("last_auditor") or aud
            if not ok and not last.get("all_passed"):
                run.status = AgentRunStatus.paused
                run.pause_reason = "fixer_failed"
                run.resume_from_agent = "SCRIBE"
                db.add(
                    AgentHumanReview(
                        agent_run_id=run.id,
                        item="AUDITOR still failing after FIXER loops — review statements or mappings, then continue (will skip FIXER) or restart run.",
                        status=HumanReviewStatus.pending,
                    )
                )
                db.commit()
                log("NEXUS", "Paused after FIXER — human review.")
                return
            if "FIXER" not in completed:
                completed.append("FIXER")
            _set_progress(db, run, "FIXER", pct_map["FIXER"], completed)

        if start_idx <= 4:
            _set_progress(db, run, "SCRIBE", pct_map["FIXER"] + 2, completed)
            _run_with_retries(db, run, "SCRIBE", lambda: ScribeAgent(ctx).run(), "SCRIBE")
            if "SCRIBE" not in completed:
                completed.append("SCRIBE")
            _set_progress(db, run, "SCRIBE", pct_map["SCRIBE"], completed)

        if start_idx <= 5:
            _set_progress(db, run, "NARRATOR", pct_map["SCRIBE"] + 2, completed)
            _run_with_retries(db, run, "NARRATOR", lambda: NarratorAgent(ctx).run(), "NARRATOR")
            if "NARRATOR" not in completed:
                completed.append("NARRATOR")
            _set_progress(db, run, "NARRATOR", pct_map["NARRATOR"], completed)

        if start_idx <= 6:
            _set_progress(db, run, "PACKAGER", pct_map["NARRATOR"] + 2, completed)
            exports = PackagerAgent(ctx).run()
            out = {
                "statements": _snapshot_statements(db, trial_balance_id, tenant_id),
                "notes": _snapshot_notes(db, trial_balance_id, tenant_id),
                "commentary": ctx.shared.get("commentary") or {},
                "exports": exports,
                "export_paths": ctx.shared.get("export_paths") or {},
            }
            run.output = out
            try:
                upsert_vault_statements(
                    db,
                    tenant_id=tenant_id,
                    company_name=tb.company_name,
                    trial_balance_id=trial_balance_id,
                    period_end=tb.period_end,
                    statements_snapshot=out["statements"],
                )
            except Exception as ve:
                log("NEXUS", f"Financial vault save skipped: {ve!s}")
            run.status = AgentRunStatus.completed
            if "PACKAGER" not in completed:
                completed.append("PACKAGER")
            _set_progress(db, run, None, 100.0, completed)
            log("NEXUS", "Run completed successfully.")
    except Exception as e:
        run.status = AgentRunStatus.failed
        run.error_message = str(e)[:4000]
        db.commit()
        log("NEXUS", f"FAILED: {e!s}")
        raise


def create_run_record(
    db: Session,
    tenant_id: str,
    trial_balance_id: int,
    prior_trial_balance_id: int | None = None,
    manual_prior: dict | None = None,
) -> AgentRun:
    rid = str(uuid.uuid4())
    run = AgentRun(
        run_id=rid,
        tenant_id=tenant_id,
        trial_balance_id=trial_balance_id,
        prior_trial_balance_id=prior_trial_balance_id,
        manual_prior_json=manual_prior,
        status=AgentRunStatus.started,
        progress_pct=0.0,
        current_agent="NEXUS",
        agents_completed=[],
        output=None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run
