"""SCRIBE — wraps Week 3 disclosure note generators (TB-backed; no new numbers invented here)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from sqlalchemy.orm import Session

from app.agents.agent_models import MODEL_SCRIBE
from app.agents.base_agent import AgentContext, BaseAgent
from app.models.ifrs_statement import DisclosureNote, DisclosureNoteStatus, TrialBalance
from app.services.disclosure_generator import (
    generate_n1_accounting_policies,
    generate_n10_subsequent_events,
    generate_n2_fixed_assets,
    generate_n3_leases,
    generate_n4_financial_instruments,
    generate_n5_revenue,
    generate_n6_borrowings,
    generate_n7_tax,
    generate_n8_related_parties,
    generate_n9_contingencies,
)
from app.services.llm_service import is_configured
from datetime import datetime


_FIRST_BATCH = [
    ("N1", "Significant Accounting Policies", generate_n1_accounting_policies),
    ("N2", "Property Plant and Equipment", generate_n2_fixed_assets),
    ("N3", "Leases", generate_n3_leases),
    ("N4", "Financial Instruments", generate_n4_financial_instruments),
    ("N5", "Revenue", generate_n5_revenue),
]

_SECOND_BATCH = [
    ("N6", "Borrowings", generate_n6_borrowings),
    ("N7", "Income Tax", generate_n7_tax),
    ("N8", "Related Party Transactions", generate_n8_related_parties),
    ("N9", "Contingent Liabilities", generate_n9_contingencies),
    ("N10", "Events After Reporting Date", generate_n10_subsequent_events),
]


def _run_one_note(code: str, title: str, fn, tb_data: dict) -> tuple[str, str, str]:
    """Isolated worker (thread): returns (code, title, content)."""
    try:
        # Re-bind to Opus for agentic SCRIBE when API key present
        if is_configured():
            # Generators call invoke internally without model_id — we cannot swap per thread
            # without changing disclosure_generator. Use generator as-is.
            content = fn(tb_data)
        else:
            content = f"[{code}] Disclosure skipped — no ANTHROPIC_API_KEY."
    except Exception as e:
        content = f"[{code} generation error: {e!s}]"
    return code, title, content


class ScribeAgent(BaseAgent):
    agent_id = "SCRIBE"

    def run(self) -> None:
        ctx = self.ctx
        from app.services.statement_generator import build_tb_data_from_db

        tb_data = build_tb_data_from_db(
            ctx.trial_balance_id,
            ctx.db,
            prior_trial_balance_id=ctx.shared.get("prior_trial_balance_id"),
            manual_prior=ctx.shared.get("manual_prior"),
        )
        ctx.emit(self.agent_id, "Generating disclosure notes (two parallel batches of 5).")

        tb = ctx.db.query(TrialBalance).filter(TrialBalance.id == ctx.trial_balance_id).first()
        if not tb:
            raise RuntimeError("Trial balance missing")

        for n in ctx.db.query(DisclosureNote).filter(DisclosureNote.trial_balance_id == ctx.trial_balance_id).all():
            ctx.db.delete(n)
        ctx.db.commit()

        results: dict[str, dict] = {}
        note_i = 0

        def run_batch(batch: list, label: str) -> list[tuple[str, str, str]]:
            ctx.emit(self.agent_id, f"{label} — {len(batch)} notes")
            out: list[tuple[str, str, str]] = []
            with ThreadPoolExecutor(max_workers=5) as ex:
                futs = [ex.submit(_run_one_note, code, title, fn, tb_data) for code, title, fn in batch]
                for fut in as_completed(futs):
                    out.append(fut.result())
            return out

        # Note: parallel threads + one tb_data dict read-only is safe; DB writes happen serially below.
        batch_a = run_batch(_FIRST_BATCH, "Batch A")
        batch_b = run_batch(_SECOND_BATCH, "Batch B")
        ordered = sorted(batch_a + batch_b, key=lambda x: int(x[0][1:]) if x[0][1:].isdigit() else 0)

        for code, title, content in ordered:
            if tb_data.get("has_comparative"):
                pr = tb_data.get("prior_revenue")
                cr = tb_data.get("revenue")
                if isinstance(pr, (int, float)) and isinstance(cr, (int, float)) and pr:
                    try:
                        pct = (float(cr) - float(pr)) / float(pr) * 100.0
                        content += (
                            f"\n\n[IAS 1 comparative] Revenue {float(cr):,.0f} vs prior period "
                            f"{float(pr):,.0f} ({pct:+.1f}% YoY). Prior period end: {tb_data.get('prior_period_end', 'N/A')}."
                        )
                    except (TypeError, ValueError, ZeroDivisionError):
                        content += "\n\n[IAS 1 comparative] Prior-year figures are presented in the Excel statements export."
                else:
                    content += "\n\n[IAS 1 comparative] Prior-year figures are presented in the Excel statements export."
            note_i += 1
            note = DisclosureNote(
                tenant_id=tb.tenant_id,
                trial_balance_id=ctx.trial_balance_id,
                note_number=note_i,
                note_code=code,
                note_title=title,
                status=DisclosureNoteStatus.ai_draft,
                ai_generated_content=content,
                user_edited_content=content,
                is_user_edited=False,
                word_count=len(content.split()),
                generated_at=datetime.utcnow(),
            )
            ctx.db.add(note)
            ctx.db.flush()
            results[code] = {"id": note.id, "title": title, "word_count": note.word_count}

        ctx.db.commit()
        ctx.shared["scribe_notes"] = results
        ctx.emit(self.agent_id, f"Persisted {len(results)} notes to disclosure_notes.")
        # Silence lint: model reserved for future disclosure invoke override
        _ = MODEL_SCRIBE
