"""
je_narrative.py
───────────────
LLM-powered audit narrative generator for flagged Journal Entries.

Uses the Anthropic Claude API to produce concise, professional audit
observations for CRITICAL and HIGH-risk entries identified by the
5-layer JE Anomaly Engine.

Key design decisions
────────────────────
• Async throughout — `asyncio.gather` with a semaphore cap (default 5)
  so we never fire 50 concurrent Claude requests.
• Hard timeout per narrative (15 s) with graceful fallback to a rule-based
  template so the analysis endpoint is never blocked.
• Only generates for CRITICAL / HIGH entries; LOW/MEDIUM get a short
  rule-based summary instead.
• `generate_batch` returns a dict[journal_id -> narrative_str] so callers
  can merge by key without caring about ordering.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

log = logging.getLogger(__name__)

_SEMAPHORE_LIMIT = 5          # max concurrent Claude API calls
_TIMEOUT_SEC     = 15.0       # per-narrative timeout before fallback
_MAX_TOKENS      = 200        # Claude output tokens per narrative
_MODEL           = "claude-sonnet-4-5"  # latest Sonnet

# Risk levels that warrant a full LLM narrative
_LLM_RISK_LEVELS = {"CRITICAL", "HIGH"}


# ─────────────────────────────────────────────────────────────────────────────
# Fallback template (no API call needed)
# ─────────────────────────────────────────────────────────────────────────────

def _rule_based_narrative(entry: dict[str, Any], scores: dict[str, Any]) -> str:
    """Generate a lightweight template narrative when LLM is unavailable."""
    risk   = scores.get("risk_level", "MEDIUM")
    score  = scores.get("composite_score", 0.0)
    amount = entry.get("amount", 0.0)
    acct   = entry.get("account", "unknown")
    user   = entry.get("user_id", "unknown")
    top    = scores.get("top_reasons", [])
    reason = "; ".join(top[:2]) if top else "multiple statistical anomalies"

    return (
        f"This {risk}-risk journal entry (composite score {score:.0f}/100) "
        f"for account {acct} with an amount of ₹{amount:,.2f} posted by {user} "
        f"was flagged due to: {reason}. "
        "Recommend auditor review and corroborating documentation."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Prompt builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_prompt(entry: dict[str, Any], scores: dict[str, Any]) -> str:
    risk        = scores.get("risk_level", "HIGH")
    comp_score  = scores.get("composite_score", 0.0)
    top_reasons = scores.get("top_reasons", [])
    layer_scores = scores.get("layer_scores", {})

    stat  = layer_scores.get("statistical", 0)
    ml    = layer_scores.get("ml", 0)
    pat   = layer_scores.get("pattern", 0)
    beh   = layer_scores.get("behavioral", 0)

    reason_block = "\n".join(f"  • {r}" for r in top_reasons[:5]) if top_reasons else "  • (no specific reasons)"

    prompt = f"""You are a senior forensic accountant writing a concise audit observation.

Journal Entry Details
─────────────────────
• Journal ID   : {entry.get('journal_id', 'N/A')}
• Account      : {entry.get('account', 'N/A')}
• Amount       : ₹{entry.get('amount', 0):,.2f}
• Posted by    : {entry.get('user_id', 'N/A')}
• Source       : {entry.get('source', 'N/A')}
• Posting date : {entry.get('posting_date', 'N/A')}
• Description  : {entry.get('description', 'N/A') or 'None'}
• Entity       : {entry.get('entity', 'N/A') or 'None'}

Detection Results
─────────────────
• Risk level      : {risk}
• Composite score : {comp_score:.1f} / 100
• Statistical     : {stat:.0f}   ML : {ml:.0f}   Pattern : {pat:.0f}   Behavioral : {beh:.0f}

Primary risk indicators:
{reason_block}

Instructions
────────────
Write a single audit observation paragraph (3-5 sentences, ≤150 words) that:
1. States what was found and why it is anomalous
2. References the specific risk indicators above
3. Describes the potential financial-reporting or fraud risk
4. Recommends the most important next audit step

Use professional audit language. Do NOT repeat the raw numbers already visible
in the UI. Do NOT add headers, bullets, or markdown — plain prose only."""

    return prompt


# ─────────────────────────────────────────────────────────────────────────────
# Main service class
# ─────────────────────────────────────────────────────────────────────────────

class JENarrativeService:
    """Async Claude-powered audit narrative generator."""

    def __init__(self) -> None:
        self._client: Any = None   # lazy-init on first call
        self._semaphore: asyncio.Semaphore | None = None

    # ── Private helpers ───────────────────────────────────────────────────────

    def _get_client(self) -> Any:
        """Lazy-init the Anthropic client (avoids import cost at module load)."""
        if self._client is None:
            try:
                import anthropic  # noqa: PLC0415
                api_key = os.environ.get("ANTHROPIC_API_KEY", "")
                if not api_key:
                    raise ValueError("ANTHROPIC_API_KEY environment variable not set")
                self._client = anthropic.AsyncAnthropic(api_key=api_key)
                log.info("[NARRATIVE] Anthropic async client initialised")
            except Exception as exc:
                log.warning("[NARRATIVE] Failed to init Anthropic client: %s", exc)
                self._client = None
        return self._client

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Return (or lazily create) the concurrency semaphore."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(_SEMAPHORE_LIMIT)
        return self._semaphore

    # ── Public API ────────────────────────────────────────────────────────────

    def build_prompt(self, entry: dict[str, Any], scores: dict[str, Any]) -> str:
        """Return the Claude prompt for a single journal entry. Exposed for testing."""
        return _build_prompt(entry, scores)

    async def generate_narrative(
        self,
        entry: dict[str, Any],
        scores: dict[str, Any],
    ) -> str:
        """
        Generate a single audit narrative for *entry*.

        Falls back to a rule-based template if:
        • The Anthropic client is unavailable
        • The Claude call times out (> _TIMEOUT_SEC seconds)
        • Any exception is raised
        """
        client = self._get_client()
        if client is None:
            return _rule_based_narrative(entry, scores)

        prompt = _build_prompt(entry, scores)

        async def _call() -> str:
            async with self._get_semaphore():
                message = await client.messages.create(
                    model=_MODEL,
                    max_tokens=_MAX_TOKENS,
                    messages=[{"role": "user", "content": prompt}],
                )
                return message.content[0].text.strip()

        try:
            return await asyncio.wait_for(_call(), timeout=_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            log.warning(
                "[NARRATIVE] Claude timeout for journal_id=%s — using fallback",
                entry.get("journal_id"),
            )
            return _rule_based_narrative(entry, scores)
        except Exception as exc:
            log.warning(
                "[NARRATIVE] Claude error for journal_id=%s: %s — using fallback",
                entry.get("journal_id"),
                exc,
            )
            return _rule_based_narrative(entry, scores)

    async def generate_batch(
        self,
        entries_with_scores: list[dict[str, Any]],
        max_entries: int = 20,
    ) -> dict[str, str]:
        """
        Generate narratives for a batch of entries concurrently.

        Parameters
        ----------
        entries_with_scores:
            Each item must have shape::

                {
                    "entry":  { journal_id, account, amount, ... },
                    "scores": { risk_level, composite_score, top_reasons, layer_scores, ... }
                }

        max_entries:
            Hard cap — only the first *max_entries* items are processed.
            The caller is responsible for pre-filtering to CRITICAL/HIGH only.

        Returns
        -------
        dict[journal_id, narrative_str]
        """
        subset = entries_with_scores[:max_entries]
        if not subset:
            return {}

        log.info("[NARRATIVE] Generating %d narrative(s) concurrently", len(subset))

        async def _one(item: dict[str, Any]) -> tuple[str, str]:
            entry  = item["entry"]
            scores = item["scores"]
            jid    = entry.get("journal_id", "unknown")
            text   = await self.generate_narrative(entry, scores)
            return jid, text

        tasks = [_one(item) for item in subset]
        pairs = await asyncio.gather(*tasks, return_exceptions=True)

        result: dict[str, str] = {}
        for i, pair in enumerate(pairs):
            if isinstance(pair, Exception):
                jid = subset[i]["entry"].get("journal_id", f"entry_{i}")
                log.warning("[NARRATIVE] gather exception for %s: %s", jid, pair)
                result[jid] = _rule_based_narrative(
                    subset[i]["entry"], subset[i]["scores"]
                )
            else:
                jid, text = pair
                result[jid] = text

        log.info("[NARRATIVE] Batch complete — %d narratives generated", len(result))
        return result
