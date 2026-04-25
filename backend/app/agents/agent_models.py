"""Anthropic model IDs per agent role (override via env)."""
from __future__ import annotations

import os

# User spec names; map to current Anthropic API slugs with sane fallbacks.
MODEL_NEXUS = os.getenv("IFRS_AGENT_MODEL_NEXUS", "claude-opus-4-20250514")
MODEL_MAPPER = os.getenv("IFRS_AGENT_MODEL_MAPPER", "claude-sonnet-4-20250514")
MODEL_BUILDER = os.getenv("IFRS_AGENT_MODEL_BUILDER", "claude-sonnet-4-20250514")
MODEL_FIXER = os.getenv("IFRS_AGENT_MODEL_FIXER", "claude-sonnet-4-20250514")
MODEL_SCRIBE = os.getenv("IFRS_AGENT_MODEL_SCRIBE", "claude-opus-4-20250514")
MODEL_NARRATOR = os.getenv("IFRS_AGENT_MODEL_NARRATOR", "claude-opus-4-20250514")

MAX_AGENT_RETRIES = 3
MAX_FIXER_LOOPS = 3

CONFIDENCE_AUTO = 0.85
CONFIDENCE_HUMAN = 0.65
