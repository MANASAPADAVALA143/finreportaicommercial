"""Claude JSON contracts for Audit Intelligence agents."""

from __future__ import annotations

import json
import re
from typing import Any

from app.services import llm_service

AUDIT_MODEL = "claude-sonnet-4-20250514"


def strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def invoke_audit_json(system: str, user_content: str, *, max_tokens: int = 8192) -> dict[str, Any]:
    if not llm_service.is_configured():
        return {"_error": "llm_not_configured", "message": "ANTHROPIC_API_KEY is not set."}
    try:
        raw = llm_service.invoke(
            user_content,
            max_tokens=max_tokens,
            temperature=0.2,
            system=system,
            model_id=AUDIT_MODEL,
        )
        parsed = json.loads(strip_json_fence(raw))
    except Exception as exc:  # noqa: BLE001
        return {"_error": "claude_parse_or_api", "message": str(exc)}
    if not isinstance(parsed, dict):
        return {"_error": "invalid_shape", "message": "Claude did not return a JSON object."}
    return parsed
