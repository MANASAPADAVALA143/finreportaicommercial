"""
GL → IFRS mapping via Anthropic Claude (Week 1).
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session
from app.services.json_llm_extract import parse_llm_json_array
from app.services.llm_service import invoke

from app.models.ifrs_statement import (
    GLMapping,
    IFRSStatementKind,
    MappingSourceEnum,
    MappingTemplate,
    TrialBalance,
    TrialBalanceLine,
    AccountTypeEnum,
)

GL_SYSTEM_PROMPT = """You are an expert IFRS accountant. Map each GL account to ONE line item below.
Use the EXACT ifrs_line_item spelling (including em dashes "—") and the EXACT ifrs_section label.

Return JSON array only. Each object must include:
- ifrs_statement: one of "financial_position", "profit_loss", "other_comprehensive_income", "cash_flows", "equity"
- ifrs_line_item: exact string from the list below
- ifrs_section: exact section header below
- ifrs_sub_section: null or a short note
- confidence: 0.0–1.0
- reasoning: one sentence

### financial_position — Non-current Assets
Property plant and equipment (gross); Accumulated depreciation — PPE; Right-of-use assets;
Accumulated depreciation — ROU; Goodwill; Other intangible assets;
Accumulated amortisation — intangibles; Investments in associates; Other financial assets; Deferred tax assets

### financial_position — Current Assets
Inventories; Trade and other receivables (gross); Loss allowance on receivables; Contract assets;
Prepayments and other current assets; Cash and cash equivalents

### financial_position — Equity
Share capital; Share premium; Retained earnings; Other comprehensive income reserve;
Foreign currency translation reserve; Revaluation reserve

### financial_position — Non-current Liabilities
Borrowings — non-current; Lease liabilities — non-current; Deferred tax liabilities;
Employee benefit obligations; Provisions; Other non-current liabilities

### financial_position — Current Liabilities
Trade and other payables; Borrowings — current; Lease liabilities — current; Contract liabilities;
Income tax payable; Accruals and other payables

### profit_loss — Revenue
Revenue from contracts with customers; Other income; Gain on disposal of PPE

### profit_loss — Cost of Sales
Cost of goods sold; Changes in inventories

### profit_loss — Operating Expenses
Employee benefits expense; Depreciation — PPE; Depreciation — right-of-use assets;
Amortisation of intangibles; Impairment of goodwill; Expected credit loss charge;
Research and development expense; Selling and distribution expense;
General and administrative expense; Other operating expenses

### profit_loss — Finance Items
Finance income; Finance costs — interest on loans; Finance costs — interest on leases;
Foreign exchange loss; Share of profit of associates

### profit_loss — Tax
Income tax expense — current; Income tax expense — deferred

### other_comprehensive_income — OCI — items that may be reclassified
Foreign currency translation differences

### other_comprehensive_income — OCI — items that will not be reclassified
Remeasurement of defined benefit plans; Fair value changes — equity instruments

Use other_comprehensive_income only for true OCI accounts (e.g. actuarial remeasurements, FVOCI equity, FX translation reserve movements posted to OCI).
Use cash_flows / equity only when the account is clearly specific to those statements (rare for a trial balance)."""

BATCH_SIZE = 20

ANTHROPIC_GL_MODEL = os.getenv("ANTHROPIC_GL_MAPPING_MODEL", "claude-sonnet-4-20250514")


def _canonical_gl_code(raw: Any) -> str:
    """Normalize GL codes so TB '1000.0' (Excel) matches model output '1000'."""
    if raw is None:
        return ""
    if isinstance(raw, float) and raw != raw:  # NaN
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    m = re.fullmatch(r"(-?)(\d+)\.0+", s)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    return s


def _line_lookup(lines: list[TrialBalanceLine]) -> dict[str, TrialBalanceLine]:
    """Map multiple key variants → line (first wins on collision)."""
    out: dict[str, TrialBalanceLine] = {}
    for ln in lines:
        raw = str(ln.gl_code).strip()
        can = _canonical_gl_code(ln.gl_code)
        for k in (raw, can):
            if k and k not in out:
                out[k] = ln
    return out


def _resolve_line_for_ai_row(row: dict[str, Any], line_by_code: dict[str, TrialBalanceLine]) -> TrialBalanceLine | None:
    raw = row.get("gl_code")
    for key in (_canonical_gl_code(raw), str(raw).strip() if raw is not None else ""):
        if key and key in line_by_code:
            return line_by_code[key]
    return None


def _fallback_mapping_row(
    db: Session,
    tenant_id: str,
    trial_balance: TrialBalance,
    line: TrialBalanceLine,
    *,
    reason: str,
) -> GLMapping:
    gm = GLMapping(
        tenant_id=tenant_id,
        company_id=None,
        trial_balance_id=trial_balance.id,
        trial_balance_line_id=line.id,
        gl_code=line.gl_code,
        gl_description=line.gl_description,
        ifrs_statement=IFRSStatementKind.financial_position,
        ifrs_line_item="Unclassified",
        ifrs_section="General",
        ifrs_sub_section=None,
        mapping_source=MappingSourceEnum.ai_suggested,
        ai_confidence_score=0.0,
        ai_reasoning=reason,
        is_confirmed=False,
        needs_review=True,
        validator_checked=False,
        validator_passed=False,
        is_contra=False,
        locked=False,
    )
    db.add(gm)
    return gm


def _call_claude_json(user_prompt: str) -> list[dict[str, Any]]:
    text = invoke(
        prompt=user_prompt,
        system=GL_SYSTEM_PROMPT,
        max_tokens=8192,
        temperature=0.1,
        model_id=ANTHROPIC_GL_MODEL,
    )
    arr = parse_llm_json_array(text)
    return [x for x in arr if isinstance(x, dict)]


def _coerce_statement(val: str) -> IFRSStatementKind:
    v = (val or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "balance_sheet": IFRSStatementKind.financial_position,
        "statement_of_financial_position": IFRSStatementKind.financial_position,
        "p_l": IFRSStatementKind.profit_loss,
        "profitandloss": IFRSStatementKind.profit_loss,
        "income": IFRSStatementKind.profit_loss,
        "oci": IFRSStatementKind.other_comprehensive_income,
        "other_comprehensive_income": IFRSStatementKind.other_comprehensive_income,
    }
    if v in aliases:
        return aliases[v]
    try:
        return IFRSStatementKind(v)
    except ValueError:
        return IFRSStatementKind.financial_position


def map_gl_batch_to_ifrs(gl_accounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Call Claude for one batch (max ~20 lines). Returns list of mapping dicts."""
    user_prompt = (
        "Map these GL accounts to IFRS line items:\n"
        f"{json.dumps(gl_accounts, indent=2)}\n\n"
        "Return a JSON array only (no markdown fences, no commentary). One object per GL account.\n"
        "Each object must include gl_code, gl_description, ifrs_statement, ifrs_line_item, ifrs_section, confidence (0–1), reasoning."
    )
    raw = _call_claude_json(user_prompt)
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        out.append(item)
    return out


def apply_ai_mappings_to_db(
    db: Session,
    tenant_id: str,
    trial_balance: TrialBalance,
    lines: list[TrialBalanceLine],
) -> int:
    """
    Batch Claude calls, insert GLMapping rows. Deletes unlocked mappings only; preserves
    human-locked rows (CFO AI Harness definition-of-done).
    Returns count of mappings created.
    """
    locked_line_ids = {
        m.trial_balance_line_id
        for m in db.query(GLMapping)
        .filter(GLMapping.trial_balance_id == trial_balance.id, GLMapping.locked.is_(True))
        .all()
    }
    db.query(GLMapping).filter(
        GLMapping.trial_balance_id == trial_balance.id,
        GLMapping.locked.is_(False),
    ).delete(synchronize_session=False)
    db.commit()

    line_by_code = _line_lookup(lines)
    lines_open = [ln for ln in lines if ln.id not in locked_line_ids]
    created = 0

    for i in range(0, len(lines_open), BATCH_SIZE):
        batch_lines = lines_open[i : i + BATCH_SIZE]
        payload = [
            {
                "gl_code": _canonical_gl_code(ln.gl_code) or str(ln.gl_code).strip(),
                "gl_description": ln.gl_description,
            }
            for ln in batch_lines
        ]
        try:
            results = map_gl_batch_to_ifrs(payload)
        except Exception as _exc:
            logger.exception("GL mapping batch %d failed: %s", i // BATCH_SIZE, _exc)
            results = []

        if not results:
            for line in batch_lines:
                _fallback_mapping_row(
                    db,
                    tenant_id,
                    trial_balance,
                    line,
                    reason="Fallback: AI mapping failed or returned invalid JSON.",
                )
                created += 1
            continue

        matched_line_ids: set[int] = set()
        for row in results:
            if not isinstance(row, dict):
                continue
            line = _resolve_line_for_ai_row(row, line_by_code)
            if not line or line.id in matched_line_ids:
                continue
            conf = float(row.get("confidence", 0.5))
            if conf > 1.0:
                conf = conf / 100.0
            stmt = _coerce_statement(str(row.get("ifrs_statement", "financial_position")))
            gm = GLMapping(
                tenant_id=tenant_id,
                company_id=None,
                trial_balance_id=trial_balance.id,
                trial_balance_line_id=line.id,
                gl_code=line.gl_code,
                gl_description=line.gl_description,
                ifrs_statement=stmt,
                ifrs_line_item=str(row.get("ifrs_line_item", "Unclassified"))[:512],
                ifrs_section=str(row.get("ifrs_section", "General"))[:512],
                ifrs_sub_section=(
                    str(row["ifrs_sub_section"])[:512]
                    if row.get("ifrs_sub_section") not in (None, "")
                    else None
                ),
                mapping_source=MappingSourceEnum.ai_suggested,
                ai_confidence_score=min(max(conf, 0.0), 1.0),
                ai_reasoning=str(row.get("reasoning", "")) or None,
                is_confirmed=False,
                needs_review=conf < 0.6,
                validator_checked=False,
                validator_passed=False,
                is_contra=False,
                locked=False,
            )
            db.add(gm)
            matched_line_ids.add(line.id)
            created += 1

        for line in batch_lines:
            if line.id in matched_line_ids:
                continue
            _fallback_mapping_row(
                db,
                tenant_id,
                trial_balance,
                line,
                reason="Fallback: no matching gl_code in model output for this batch (check TB vs AI keys).",
            )
            created += 1
    db.commit()
    return created


def apply_ai_mappings_only_missing(
    db: Session,
    tenant_id: str,
    trial_balance: TrialBalance,
    lines: list[TrialBalanceLine],
) -> int:
    """
    Run Claude mapping only for lines that do not already have a GLMapping row.
    Does not delete existing mappings (e.g. Tally pre-fill).
    """
    mapped_ids = {
        r[0]
        for r in db.query(GLMapping.trial_balance_line_id)
        .filter(GLMapping.trial_balance_id == trial_balance.id)
        .all()
    }
    pending = [ln for ln in lines if ln.id not in mapped_ids]
    if not pending:
        return 0

    line_by_code = _line_lookup(lines)
    created = 0

    for i in range(0, len(pending), BATCH_SIZE):
        batch_lines = pending[i : i + BATCH_SIZE]
        payload = [
            {
                "gl_code": _canonical_gl_code(ln.gl_code) or str(ln.gl_code).strip(),
                "gl_description": ln.gl_description,
            }
            for ln in batch_lines
        ]
        try:
            results = map_gl_batch_to_ifrs(payload)
        except Exception as _exc:
            logger.exception("GL mapping batch %d failed: %s", i // BATCH_SIZE, _exc)
            results = []

        if not results:
            for line in batch_lines:
                if line.id in mapped_ids:
                    continue
                _fallback_mapping_row(
                    db,
                    tenant_id,
                    trial_balance,
                    line,
                    reason="Fallback: AI mapping failed or returned invalid JSON.",
                )
                mapped_ids.add(line.id)
                created += 1
            continue

        matched_batch: set[int] = set()
        for row in results:
            if not isinstance(row, dict):
                continue
            line = _resolve_line_for_ai_row(row, line_by_code)
            if not line or line.id in mapped_ids or line.id in matched_batch:
                continue
            conf = float(row.get("confidence", 0.5))
            if conf > 1.0:
                conf = conf / 100.0
            stmt = _coerce_statement(str(row.get("ifrs_statement", "financial_position")))
            gm = GLMapping(
                tenant_id=tenant_id,
                company_id=None,
                trial_balance_id=trial_balance.id,
                trial_balance_line_id=line.id,
                gl_code=line.gl_code,
                gl_description=line.gl_description,
                ifrs_statement=stmt,
                ifrs_line_item=str(row.get("ifrs_line_item", "Unclassified"))[:512],
                ifrs_section=str(row.get("ifrs_section", "General"))[:512],
                ifrs_sub_section=(
                    str(row["ifrs_sub_section"])[:512]
                    if row.get("ifrs_sub_section") not in (None, "")
                    else None
                ),
                mapping_source=MappingSourceEnum.ai_suggested,
                ai_confidence_score=min(max(conf, 0.0), 1.0),
                ai_reasoning=str(row.get("reasoning", "")) or None,
                is_confirmed=False,
                needs_review=conf < 0.6,
                validator_checked=False,
                validator_passed=False,
                is_contra=False,
                locked=False,
            )
            db.add(gm)
            mapped_ids.add(line.id)
            matched_batch.add(line.id)
            created += 1

        for line in batch_lines:
            if line.id in mapped_ids:
                continue
            _fallback_mapping_row(
                db,
                tenant_id,
                trial_balance,
                line,
                reason="Fallback: no matching gl_code in model output for this batch.",
            )
            mapped_ids.add(line.id)
            created += 1
    db.commit()
    return created


def _load_default_template_entries(db: Session, tenant_id: str) -> list[dict[str, Any]]:
    """Most recent is_default template for tenant."""
    tmpl = (
        db.query(MappingTemplate)
        .filter(
            MappingTemplate.tenant_id == tenant_id,
            MappingTemplate.is_default.is_(True),
        )
        .order_by(MappingTemplate.created_at.desc())
        .first()
    )
    if not tmpl or not tmpl.entries:
        return []
    return list(tmpl.entries)


def clear_unlocked_gl_mappings(db: Session, trial_balance_id: int) -> None:
    """Remove unlocked mappings before a full remap (preserves locked human rows)."""
    db.query(GLMapping).filter(
        GLMapping.trial_balance_id == trial_balance_id,
        GLMapping.locked.is_(False),
    ).delete(synchronize_session=False)
    db.commit()


def apply_template_mappings_first(
    db: Session,
    tenant_id: str,
    trial_balance: TrialBalance,
    lines: list[TrialBalanceLine],
) -> int:
    """
    Pre-fill GL mappings from tenant default mapping_templates before Claude.
    Skips lines that already have a mapping row (e.g. locked / tally).
    """
    entries = _load_default_template_entries(db, tenant_id)
    if not entries:
        logger.info("No default mapping template for tenant=%s", tenant_id)
        return 0

    by_code: dict[str, dict[str, Any]] = {}
    for ent in entries:
        if not isinstance(ent, dict):
            continue
        code = _canonical_gl_code(ent.get("gl_code"))
        if code and code not in by_code:
            by_code[code] = ent
        raw = str(ent.get("gl_code", "")).strip()
        if raw and raw not in by_code:
            by_code[raw] = ent

    mapped_line_ids = {
        r[0]
        for r in db.query(GLMapping.trial_balance_line_id)
        .filter(GLMapping.trial_balance_id == trial_balance.id)
        .all()
    }

    created = 0
    for line in lines:
        if line.id in mapped_line_ids:
            continue
        can = _canonical_gl_code(line.gl_code)
        raw = str(line.gl_code).strip()
        ent = by_code.get(can) or by_code.get(raw)
        if not ent:
            continue
        stmt = _coerce_statement(str(ent.get("ifrs_statement", "financial_position")))
        gm = GLMapping(
            tenant_id=tenant_id,
            company_id=None,
            trial_balance_id=trial_balance.id,
            trial_balance_line_id=line.id,
            gl_code=line.gl_code,
            gl_description=line.gl_description,
            ifrs_statement=stmt,
            ifrs_line_item=str(ent.get("ifrs_line_item", "Unclassified"))[:512],
            ifrs_section=str(ent.get("ifrs_section", "General"))[:512],
            ifrs_sub_section=(
                str(ent["ifrs_sub_section"])[:512]
                if ent.get("ifrs_sub_section") not in (None, "")
                else None
            ),
            mapping_source=MappingSourceEnum.template_suggested,
            ai_confidence_score=0.98,
            ai_reasoning="Pre-filled from company onboarding mapping template",
            is_confirmed=False,
            needs_review=False,
            validator_checked=False,
            validator_passed=False,
            is_contra=False,
            locked=False,
        )
        db.add(gm)
        mapped_line_ids.add(line.id)
        created += 1

    if created:
        db.commit()
        logger.info(
            "Template pre-fill: %d mappings from default template for trial_balance_id=%s tenant=%s",
            created,
            trial_balance.id,
            tenant_id,
        )
    return created


def infer_account_type(
    debit: float, credit: float, raw: str | None
) -> AccountTypeEnum:
    if raw:
        r = raw.lower().replace(" ", "_")
        for e in AccountTypeEnum:
            if e.value in r:
                return e
    # Keyword hints
    text = (raw or "").lower()
    if any(k in text for k in ("revenue", "sales", "income")):
        return AccountTypeEnum.revenue
    if any(k in text for k in ("expense", "cogs", "cost of", "salaries", "depreciation")):
        return AccountTypeEnum.expense
    if "equity" in text or "retained" in text or "capital" in text:
        return AccountTypeEnum.equity
    net = debit - credit
    if net >= 0:
        return AccountTypeEnum.asset
    return AccountTypeEnum.liability
