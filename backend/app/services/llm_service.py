import os

from anthropic import Anthropic

client = Anthropic()


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
    kwargs = {
        "model": model_id or "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    response = client.messages.create(**kwargs)
    return response.content[0].text
