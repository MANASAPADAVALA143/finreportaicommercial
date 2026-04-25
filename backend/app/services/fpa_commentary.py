"""CFO-style narrative for FP&A Suite extended endpoints."""

from __future__ import annotations

import json
import os

from app.services import llm_service

FPA_CFO_SYSTEM = """You are a senior FP&A analyst and CFO advisor.
Write in clear, executive-ready English. Be specific with numbers.
Flag risks prominently. Keep commentary to 3 focused paragraphs."""


def fpa_commentary(context: str, data: dict) -> str:
    model = (
        os.environ.get("ANTHROPIC_FPA_MODEL")
        or os.environ.get("ANTHROPIC_MODEL_ID")
        or "claude-sonnet-4-20250514"
    )
    payload = json.dumps(data, indent=2, default=str)[:14000]
    prompt = f"{context.strip()}\n\nStructured data:\n{payload}"
    if not llm_service.is_configured():
        return (
            "AI commentary is unavailable because ANTHROPIC_API_KEY is not configured "
            "on the server. The quantitative results shown are still valid."
        )
    return llm_service.invoke(
        prompt=prompt,
        system=FPA_CFO_SYSTEM,
        max_tokens=1600,
        temperature=0.25,
        model_id=model,
    )
