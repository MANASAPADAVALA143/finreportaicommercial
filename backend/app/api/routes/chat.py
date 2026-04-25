"""Excel Add-in and taskpane chat — POST /api/chat/ask"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import llm_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


class ChatHistoryItem(BaseModel):
    role: str = "user"
    message: str = ""


class ChatAskRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    context: str = Field(default="", max_length=120_000)
    history: List[ChatHistoryItem] = Field(default_factory=list)


class ChatAskResponse(BaseModel):
    response: str
    trigger_action: Optional[str] = None


SYSTEM = """You are FinReportAI Assistant — a senior FP&A advisor embedded in the CFO's Excel.
The user may paste live sheet context (rows as JSON). Use their ACTUAL numbers when present.
Be specific, concise, and CFO-level. Under 120 words for the main reply text.

You MUST respond with a single JSON object only (no markdown fences, no prose outside JSON).
Schema:
{"response": "<your reply to the user>", "trigger_action": "<action or empty string>"}

trigger_action must be exactly one of:
"", "run_pvm", "run_variance", "run_monte_carlo", "run_arr", "run_headcount", "run_sensitivity", "run_board_pack"

Set trigger_action when the user clearly asks to run that analysis now. Otherwise use "".
"""


def _parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in model output")
    return json.loads(text[start : end + 1])


@router.post("/ask", response_model=ChatAskResponse)
async def chat_ask(body: ChatAskRequest):
    if not llm_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="LLM is not configured (ANTHROPIC_API_KEY missing on server).",
        )
    parts: list[str] = []
    for h in body.history[-12:]:
        parts.append(f"{h.role.upper()}: {h.message}")
    parts.append(f"USER: {body.message}")
    if body.context.strip():
        parts.append(f"SHEET_CONTEXT:\n{body.context[:100_000]}")
    prompt = "\n\n".join(parts)
    try:
        raw = llm_service.invoke(
            prompt=prompt,
            system=SYSTEM,
            max_tokens=900,
            temperature=0.25,
        )
        data = _parse_json_object(raw)
        resp = str(data.get("response", "")).strip() or "I could not generate a reply."
        trig = data.get("trigger_action")
        trig_s = str(trig).strip() if trig is not None else ""
        allowed = {
            "",
            "run_pvm",
            "run_variance",
            "run_monte_carlo",
            "run_arr",
            "run_headcount",
            "run_sensitivity",
            "run_board_pack",
        }
        if trig_s not in allowed:
            trig_s = ""
        return ChatAskResponse(response=resp, trigger_action=trig_s or None)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("chat ask failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
