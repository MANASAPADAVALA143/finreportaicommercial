"""Single source of truth for Anthropic Claude model IDs."""

from __future__ import annotations

import os

# Override in backend/.env: ANTHROPIC_MODEL=claude-sonnet-4-6
# claude-sonnet-4-20250514 is deprecated/unavailable (API returns 404).
DEFAULT_CLAUDE_MODEL = (
    os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"
)
