import os
import re
from pathlib import Path

from anthropic import Anthropic, AuthenticationError, RateLimitError

# ── Read the API key directly from backend/.env — works regardless of cwd ─────
def _read_key_from_file() -> str:
    """Parse ANTHROPIC_API_KEY directly from backend/.env — no dotenv dependency."""
    candidates = [
        Path(__file__).resolve().parents[2] / ".env",   # backend/app/services/../../.env
        Path(__file__).resolve().parents[3] / "backend" / ".env",  # fallback
        Path(os.getcwd()) / ".env",
        Path(os.getcwd()).parent / ".env",
    ]
    for env_file in candidates:
        try:
            if env_file.exists():
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    m = re.match(r"^\s*ANTHROPIC_API_KEY\s*=\s*(.+)$", line.strip())
                    if m:
                        return m.group(1).strip().strip('"').strip("'")
        except Exception:
            continue
    return ""

# Load once at import time — sets os.environ so all other code works too
_found_key = _read_key_from_file()
if _found_key:
    os.environ["ANTHROPIC_API_KEY"] = _found_key

# ── Lazy client — created on first call so load_dotenv() has already run ──────
_client: Anthropic | None = None


def _get_client() -> Anthropic:
    global _client
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    # Re-create if key changed (e.g. hot-reload) or first call
    if _client is None or not key:
        _client = Anthropic(api_key=key)
    return _client


class LLMNotConfiguredError(Exception):
    """Raised when ANTHROPIC_API_KEY is missing — Nova and other AI routes cannot run."""


class LLMRateLimitError(Exception):
    """Anthropic TPM/RPM exceeded — caller should return 429 and suggest retry after delay."""


def _key() -> str:
    """Return the API key — checks env first, then reads directly from .env file."""
    k = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not k:
        k = _read_key_from_file()
        if k:
            os.environ["ANTHROPIC_API_KEY"] = k  # cache for subsequent calls
    return k


def is_configured() -> bool:
    return bool(_key())


def provider_label() -> str:
    return "Anthropic Claude"


def invoke(
    prompt: str,
    max_tokens: int = 1000,
    temperature: float = 0.3,
    system: str | None = None,
    model_id: str | None = None,
) -> str:
    key = _key()
    if not key:
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
        response = Anthropic(api_key=key).messages.create(**kwargs)
    except RateLimitError as e:
        raise LLMRateLimitError(
            "AI provider rate limit reached (too many tokens or requests per minute). "
            "Wait about one minute, then try again."
        ) from e
    except AuthenticationError as e:
        raise LLMNotConfiguredError(
            f"ANTHROPIC_API_KEY is invalid or expired: {e}"
        ) from e
    return response.content[0].text
