"""Technical Accounting Memo Generator — Claude drafts a structured memo, the user edits it.

Memos belong to the signed-in user within a workspace company they can read, like
accounting-assistant conversations; colleagues in the same company cannot list or open them.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.accounting_memo import AccountingMemo
from app.routers.internal_audit import Scope, _read, _row
from app.services import llm_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/accounting-memos", tags=["accounting-memos"])

Jurisdiction = Literal["IFRS", "Ind AS", "US GAAP"]
MemoStatus = Literal["draft", "under_review", "finalised"]
MAX_MEMO_TOKENS = 8000
MAX_SECTION_CHARS = 50_000

# Model JSON key -> memo column.
SECTIONS = {
    "executive_summary": "section_executive_summary",
    "background": "section_background",
    "applicable_standards": "section_applicable_standards",
    "accounting_analysis": "section_accounting_analysis",
    "conclusion": "section_conclusion",
    "journal_entries": "section_journal_entries",
    "disclosures": "section_disclosures",
    "assumptions": "section_assumptions",
}
_REVIEW_FLAGS = re.compile(r"requires verification", re.IGNORECASE)

MEMO_SYSTEM_PROMPT = """You are a Senior Technical Accounting Partner at a Big-4 firm.

Your task is to draft a professional technical accounting memo based on the transaction
described by the user. The memo must be suitable for inclusion in a client file and must
meet the standard of a Big-4 technical accounting review.

Jurisdiction: {jurisdiction}
Topic area: {topic}

Rules:
- Use precise, professional accounting language throughout.
- Apply {jurisdiction} as the primary framework.
- Clearly distinguish mandatory requirements from professional judgement.
- NEVER fabricate standard paragraph references. If you cite a paragraph number, note
  "Reference requires verification against source standard" immediately after.
- State the facts you assumed where the description is incomplete.
- Structure your response EXACTLY as JSON with these keys (all strings, use markdown
  within each string for formatting):
    executive_summary
    background
    applicable_standards
    accounting_analysis
    conclusion
    journal_entries          (markdown table with Account, Debit and Credit columns; empty string if not applicable)
    disclosures              (key disclosure requirements; empty string if not applicable)
    assumptions              (key assumptions underlying the analysis)
    requires_partner_review  (the string "true" or "false")

Return ONLY the JSON object. No wrapper text, no markdown code fences."""


def _user_scope(scope: Scope = Depends(_read)) -> Scope:
    if not scope.user_email:
        raise HTTPException(status_code=401, detail="Sign in to use the memo generator")
    return scope


def _get_memo(db: Session, scope: Scope, mid: int) -> AccountingMemo:
    memo = (
        db.query(AccountingMemo)
        .filter(*scope.filter(AccountingMemo), AccountingMemo.user_email == scope.user_email, AccountingMemo.id == mid)
        .first()
    )
    if memo is None:
        raise HTTPException(status_code=404, detail="Not found")
    return memo


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(f"- {_text(v)}" for v in value)
    return json.dumps(value, ensure_ascii=False, indent=2)


def _parse_memo(raw: str) -> dict[str, Any]:
    """The model's JSON object, tolerating code fences or stray text around it."""
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in model output")
    data = json.loads(raw[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("model output is not a JSON object")
    sections = {column: _text(data.get(key)) for key, column in SECTIONS.items()}
    if not any(sections.values()):
        raise ValueError("model output has no memo sections")
    flag = data.get("requires_partner_review")
    review = flag is True or str(flag).strip().lower() == "true"
    review = review or any(_REVIEW_FLAGS.search(v) for v in sections.values())
    return {**sections, "requires_partner_review": review}


def _generate_sections(description: str, jurisdiction: str, topic: str | None) -> dict[str, Any]:
    system = MEMO_SYSTEM_PROMPT.replace("{jurisdiction}", jurisdiction).replace(
        "{topic}", topic or "General Technical Accounting"
    )
    try:
        raw = llm_service.chat(
            [{"role": "user", "content": description}], system=system, max_tokens=MAX_MEMO_TOKENS
        )
    except llm_service.LLMNotConfiguredError as exc:
        logger.warning("accounting-memo: model not configured: %s", exc)
        raise HTTPException(status_code=503, detail="The memo generator is not configured on this server") from exc
    except llm_service.LLMRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("accounting-memo: model call failed: %s", exc)
        raise HTTPException(status_code=502, detail="The memo could not be drafted right now. Try again.") from exc
    try:
        return _parse_memo(raw)
    except ValueError as exc:
        logger.warning("accounting-memo: unreadable model output (%s chars): %s", len(raw), exc)
        raise HTTPException(
            status_code=502, detail="The AI returned a memo in an unexpected format. Try generating again."
        ) from exc


class GenerateMemoIn(BaseModel):
    title: str = Field(default="", max_length=200)
    transaction_description: str = Field(min_length=1, max_length=8000)
    jurisdiction: Jurisdiction = "IFRS"
    accounting_topic: str | None = Field(default=None, max_length=128)


class UpdateMemoIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: MemoStatus | None = None
    section_executive_summary: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_background: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_applicable_standards: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_accounting_analysis: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_conclusion: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_journal_entries: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_disclosures: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    section_assumptions: str | None = Field(default=None, max_length=MAX_SECTION_CHARS)
    requires_partner_review: bool | None = None


def _title_from(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 80 else text[:79].rstrip() + "…"


@router.get("")
def list_memos(scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    rows = (
        db.query(AccountingMemo)
        .filter(*scope.filter(AccountingMemo), AccountingMemo.user_email == scope.user_email)
        .order_by(AccountingMemo.updated_at.desc(), AccountingMemo.id.desc())
        .limit(200)
        .all()
    )
    return [_row(m) for m in rows]


@router.post("/generate")
def generate_memo(body: GenerateMemoIn, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    description = body.transaction_description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Describe the transaction first")
    topic = (body.accounting_topic or "").strip() or None
    sections = _generate_sections(description, body.jurisdiction, topic)
    memo = AccountingMemo(
        workspace_id=scope.workspace_id,
        company_id=scope.company_id,
        user_email=scope.user_email,
        title=body.title.strip() or _title_from(description),
        status="draft",
        transaction_description=description,
        jurisdiction=body.jurisdiction,
        accounting_topic=topic,
        ai_generated=True,
        **sections,
    )
    db.add(memo)
    db.commit()
    db.refresh(memo)
    return _row(memo)


@router.get("/{mid}")
def get_memo(mid: int, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    return _row(_get_memo(db, scope, mid))


@router.patch("/{mid}")
def update_memo(mid: int, body: UpdateMemoIn, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    memo = _get_memo(db, scope, mid)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(memo, field, value.strip() if field == "title" else value)
    memo.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memo)
    return _row(memo)


@router.post("/{mid}/regenerate")
def regenerate_memo(mid: int, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    """Redraft every section from the memo's saved description; title and status are kept."""
    memo = _get_memo(db, scope, mid)
    if not (memo.transaction_description or "").strip():
        raise HTTPException(status_code=422, detail="This memo has no transaction description to redraft from")
    sections = _generate_sections(memo.transaction_description, memo.jurisdiction or "IFRS", memo.accounting_topic)
    for field, value in sections.items():
        setattr(memo, field, value)
    memo.ai_generated = True
    memo.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memo)
    return _row(memo)


@router.delete("/{mid}", status_code=204)
def delete_memo(mid: int, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    db.delete(_get_memo(db, scope, mid))
    db.commit()
    return Response(status_code=204)
