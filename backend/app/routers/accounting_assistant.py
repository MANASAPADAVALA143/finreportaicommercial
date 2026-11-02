"""Technical Accounting AI Assistant — Claude-backed accounting research chat.

Conversations belong to the signed-in user within a workspace company they can read;
nobody else, including colleagues in the same company, can list or open them.
Phase 1 answers from the model alone. Retrieval over standards (phase 2) slots in at
`_build_system_prompt` without changing the API.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.accounting_assistant import AccountingConversation, AccountingMessage
from app.routers.internal_audit import Scope, _read, _row
from app.services import llm_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/accounting-assistant", tags=["accounting-assistant"])

Jurisdiction = Literal["IFRS", "Ind AS", "US GAAP"]
HISTORY_MESSAGES = 10
MAX_ANSWER_TOKENS = 4096
CAVEAT = (
    "AI-assisted accounting research, not authoritative advice. Verify paragraph references "
    "against the source standards and have conclusions reviewed before relying on them."
)
_REVIEW_FLAGS = re.compile(r"requires verification|technical accounting partner", re.IGNORECASE)

SYSTEM_PROMPT = """You are a Senior Technical Accounting Research Assistant at a Big-4 accounting firm.

Your role is to provide technically accurate, professional accounting guidance based on the selected jurisdiction.

Rules:
- Answer in precise professional accounting language.
- Work through the accounting reasoning step by step.
- Prioritise the selected jurisdiction ({jurisdiction}).
- Clearly distinguish between IFRS, Ind AS and US GAAP where they differ.
- NEVER invent or fabricate accounting standard paragraph references.
- If you are uncertain about a specific paragraph number or reference, explicitly say: "Reference requires verification against the source standard."
- Ask for missing transaction facts when the question cannot be answered without them.
- Provide practical examples and illustrative journal entries where useful; present journal entries as markdown tables with Account, Debit and Credit columns.
- Explain alternative accounting treatments where relevant.
- Clearly distinguish accounting requirements (mandatory) from professional judgement (discretionary).
- Flag matters that require review by a qualified technical accounting partner.
- Never state that a specific accounting treatment is compliant without sufficient evidence.

Structure your answer with these sections (use markdown headers):
1. Executive Conclusion
2. Applicable Accounting Requirements
3. Detailed Accounting Analysis
4. Practical Example (if relevant)
5. Illustrative Journal Entries (if relevant)
6. Key Assumptions
7. References Requiring Verification (list any paragraph numbers you cited but cannot verify)
8. Professional Review Considerations
"""


def _user_scope(scope: Scope = Depends(_read)) -> Scope:
    if not scope.user_email:
        raise HTTPException(status_code=401, detail="Sign in to use the accounting assistant")
    return scope


def _conversation_query(db: Session, scope: Scope):
    return db.query(AccountingConversation).filter(
        *scope.filter(AccountingConversation), AccountingConversation.user_email == scope.user_email
    )


def _get_conversation(db: Session, scope: Scope, cid: int) -> AccountingConversation:
    conv = _conversation_query(db, scope).filter(AccountingConversation.id == cid).first()
    if conv is None:
        raise HTTPException(status_code=404, detail="Not found")
    return conv


def _message_out(msg: AccountingMessage) -> dict[str, Any]:
    row = _row(msg)
    review = bool(row.pop("requires_review", False))
    out = {k: row[k] for k in ("id", "conversation_id", "role", "content", "created_at")}
    if msg.role == "assistant":
        out["requires_human_review"] = review
        out["caveats"] = CAVEAT
    return out


def _title_from(message: str) -> str:
    text = " ".join(message.split())
    return text if len(text) <= 80 else text[:79].rstrip() + "…"


def _build_system_prompt(jurisdiction: str, topic: str | None) -> str:
    system = SYSTEM_PROMPT.replace("{jurisdiction}", jurisdiction)
    if topic:
        system += f"\n\nFocus area for this conversation: {topic}"
    return system


def _history(db: Session, conv: AccountingConversation | None) -> list[dict[str, str]]:
    """Recent turns, oldest first, starting with a user turn as the Messages API requires."""
    if conv is None:
        return []
    recent = (
        db.query(AccountingMessage)
        .filter(AccountingMessage.conversation_id == conv.id)
        .order_by(AccountingMessage.id.desc())
        .limit(HISTORY_MESSAGES)
        .all()
    )
    turns = [{"role": m.role, "content": m.content} for m in reversed(recent)]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


@router.get("/conversations")
def list_conversations(scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    rows = _conversation_query(db, scope).order_by(
        AccountingConversation.updated_at.desc(), AccountingConversation.id.desc()
    ).limit(100).all()
    return [_row(c) for c in rows]


@router.get("/conversations/{cid}/messages")
def list_messages(cid: int, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    conv = _get_conversation(db, scope, cid)
    rows = (
        db.query(AccountingMessage)
        .filter(AccountingMessage.conversation_id == conv.id)
        .order_by(AccountingMessage.id)
        .all()
    )
    return [_message_out(m) for m in rows]


@router.delete("/conversations/{cid}", status_code=204)
def delete_conversation(cid: int, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    conv = _get_conversation(db, scope, cid)
    db.query(AccountingMessage).filter(AccountingMessage.conversation_id == conv.id).delete(
        synchronize_session=False
    )
    db.delete(conv)
    db.commit()
    return Response(status_code=204)


class ChatIn(BaseModel):
    conversation_id: int | None = None
    message: str = Field(min_length=1, max_length=8000)
    jurisdiction: Jurisdiction = "IFRS"
    accounting_topic: str | None = Field(default=None, max_length=200)


@router.post("/chat")
def chat(body: ChatIn, scope: Scope = Depends(_user_scope), db: Session = Depends(get_db)):
    question = body.message.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Message cannot be empty")
    conv = _get_conversation(db, scope, body.conversation_id) if body.conversation_id is not None else None
    topic = (body.accounting_topic or "").strip() or None

    try:
        answer = llm_service.chat(
            [*_history(db, conv), {"role": "user", "content": question}],
            system=_build_system_prompt(body.jurisdiction, topic),
            max_tokens=MAX_ANSWER_TOKENS,
        ).strip()
    except llm_service.LLMNotConfiguredError as exc:
        logger.warning("accounting-assistant: model not configured: %s", exc)
        raise HTTPException(status_code=503, detail="The AI assistant is not configured on this server") from exc
    except llm_service.LLMRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("accounting-assistant: model call failed: %s", exc)
        raise HTTPException(status_code=502, detail="The AI assistant could not answer right now. Try again.") from exc
    if not answer:
        raise HTTPException(status_code=502, detail="The AI assistant returned an empty answer. Try again.")

    if conv is None:
        conv = AccountingConversation(
            workspace_id=scope.workspace_id,
            company_id=scope.company_id,
            user_email=scope.user_email,
            title=_title_from(question),
        )
        db.add(conv)
        db.flush()
    conv.jurisdiction = body.jurisdiction
    conv.updated_at = datetime.now(timezone.utc)
    common = {"conversation_id": conv.id, "workspace_id": scope.workspace_id, "company_id": scope.company_id}
    user_msg = AccountingMessage(**common, role="user", content=question)
    db.add(user_msg)
    db.flush()
    reply = AccountingMessage(
        **common, role="assistant", content=answer, requires_review=bool(_REVIEW_FLAGS.search(answer))
    )
    db.add(reply)
    db.commit()
    db.refresh(conv)

    out = _message_out(reply)
    return {
        "conversation_id": conv.id,
        "message_id": reply.id,
        "answer": answer,
        "structured": None,
        "requires_human_review": out["requires_human_review"],
        "caveats": out["caveats"],
        "conversation": _row(conv),
        "user_message": _message_out(user_msg),
        "assistant_message": out,
    }
