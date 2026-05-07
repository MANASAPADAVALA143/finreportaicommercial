import os

from anthropic import Anthropic, RateLimitError

client = Anthropic()


class LLMNotConfiguredError(Exception):
    """Raised when ANTHROPIC_API_KEY is missing — Nova and other AI routes cannot run."""


class LLMRateLimitError(Exception):
    """Anthropic TPM/RPM exceeded — caller should return 429 and suggest retry after delay."""


def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def provider_label() -> str:
    return "Anthropic Claude"


def invoke(
    prompt: str,
    max_tokens: int = 1000,
    temperature: float = 0.3,
    system: str | None = None,
    model_id: str | None = None,
) -> str:
    if not is_configured():
        raise LLMNotConfiguredError(
            "ANTHROPIC_API_KEY is not set. Add it to backend/.env and restart the API server."
        )
    kwargs = {
        "model": model_id or "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    try:
        response = client.messages.create(**kwargs)
    except RateLimitError as e:
        raise LLMRateLimitError(
            "AI provider rate limit reached (too many tokens or requests per minute for your org). "
            "Wait about one minute, then try again."
        ) from e
    return response.content[0].text
