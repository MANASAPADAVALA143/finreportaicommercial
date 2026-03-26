"""
Unified LLM calls: Anthropic Claude (default) or Google Gemini.
Configure with AI_PROVIDER=anthropic|gemini and the matching API key in backend/.env.
"""
from __future__ import annotations

import os
from typing import Optional

_PROVIDER = (os.getenv("AI_PROVIDER") or "anthropic").strip().lower()
_ANTHROPIC_KEY = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
_GOOGLE_KEY = (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
_ANTHROPIC_MODEL = (os.getenv("ANTHROPIC_MODEL") or "claude-3-5-haiku-20241022").strip()
_GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-1.5-flash").strip()


def is_configured() -> bool:
    if _PROVIDER == "gemini":
        return bool(_GOOGLE_KEY)
    return bool(_ANTHROPIC_KEY)


def provider_label() -> str:
    return "Google Gemini" if _PROVIDER == "gemini" else "Anthropic Claude"


def _ignore_legacy_model_id(model_id: Optional[str]) -> Optional[str]:
    """Bedrock/Nova model ids from older clients are ignored."""
    if not model_id:
        return None
    m = model_id.strip().lower()
    if "amazon" in m or "nova" in m or m.startswith("us.") or m.startswith("eu."):
        return None
    return model_id.strip()


def _invoke_anthropic(
    prompt: str,
    max_tokens: int,
    temperature: float,
    model_id: Optional[str],
) -> str:
    import anthropic

    if not _ANTHROPIC_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set in backend/.env")
    model = _ignore_legacy_model_id(model_id) or _ANTHROPIC_MODEL
    client = anthropic.Anthropic(api_key=_ANTHROPIC_KEY)
    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
    )
    if not msg.content:
        raise RuntimeError("Empty response from Anthropic")
    block = msg.content[0]
    if block.type != "text":
        raise RuntimeError("Unexpected Anthropic response type")
    return block.text.strip()


def _invoke_gemini(prompt: str, max_tokens: int, temperature: float) -> str:
    import google.generativeai as genai

    if not _GOOGLE_KEY:
        raise RuntimeError("GOOGLE_API_KEY (or GEMINI_API_KEY) is not set in backend/.env")
    genai.configure(api_key=_GOOGLE_KEY)
    model = genai.GenerativeModel(_GEMINI_MODEL)
    cfg = genai.types.GenerationConfig(
        max_output_tokens=max_tokens,
        temperature=temperature,
    )
    response = model.generate_content(prompt, generation_config=cfg)
    if not response.candidates:
        raise RuntimeError("Gemini returned no output (safety filter or empty)")
    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Empty response from Gemini")
    return text


def invoke(
    prompt: str,
    max_tokens: int = 600,
    temperature: float = 0.3,
    model_id: Optional[str] = None,
) -> str:
    if not is_configured():
        raise RuntimeError(
            "AI is not configured. Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY, "
            "or AI_PROVIDER=gemini and GOOGLE_API_KEY in backend/.env"
        )
    if _PROVIDER == "gemini":
        return _invoke_gemini(prompt, max_tokens, temperature)
    return _invoke_anthropic(prompt, max_tokens, temperature, model_id)
