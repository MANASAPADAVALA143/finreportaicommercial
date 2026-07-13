"""Shared Anthropic Claude model ID — override via ANTHROPIC_MODEL in .env."""

import os

CLAUDE_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"
