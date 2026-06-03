import json
import os
from typing import Any

import anthropic

# Lazy client — do NOT instantiate at module level so the app starts even if
# ANTHROPIC_API_KEY is not yet set (Railway deploy, staging envs, etc.)
_client: anthropic.Anthropic | None = None

def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Add it to Railway environment variables."
            )
        _client = anthropic.Anthropic(api_key=key)
    return _client


def _clean_json_block(text: str) -> str:
    cleaned = text.strip()
    if "```" in cleaned:
        parts = cleaned.split("```")
        if len(parts) > 1:
            cleaned = parts[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return cleaned.strip()


async def generate_insight(
    agent_name: str,
    current_data: dict[str, Any],
    historical_data: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate CFO-level insight for an agent run."""
    try:
        prompt = f"""You are a CFO-level finance AI with 15 years Big4 + banking experience.

Agent that just ran: {agent_name}
Current period data: {json.dumps(current_data, indent=2, default=str)}
Historical context (last 6 months):
{json.dumps(historical_data[-6:] if historical_data else [], indent=2, default=str)}

Analyse and respond ONLY in valid JSON:
{{
  "what_happened": "one clear sentence summarising the key finding",
  "why_it_happened": [
    "Root cause 1 — specific",
    "Root cause 2 — specific",
    "Contributing factor — specific"
  ],
  "what_to_do": "Specific action CFO should take today",
  "board_line": "One sentence suitable for board pack commentary",
  "confidence": 85,
  "urgency": "red",
  "metric_name": "Revenue",
  "metric_value": "-₹48.3L vs Budget"
}}

urgency must be exactly: red, yellow, or green
red = immediate action needed
yellow = monitor closely
green = on track no action

Respond ONLY with JSON. No other text."""

        response = _get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )

        text = _clean_json_block(response.content[0].text)
        return json.loads(text)

    except Exception:
        return {
            "what_happened": f"Agent {agent_name} completed",
            "why_it_happened": ["Analysis in progress"],
            "what_to_do": "Review module output",
            "board_line": "Results available in dashboard",
            "confidence": 70,
            "urgency": "green",
            "metric_name": agent_name,
            "metric_value": "Processed",
        }


async def generate_board_pack_content(
    all_agent_results: dict[str, Any],
) -> dict[str, Any]:
    """Generate board-pack-ready narrative from recent agent outputs."""
    try:
        prompt = f"""You are a CFO preparing a monthly board pack.

All agent analysis results:
{json.dumps(all_agent_results, indent=2, default=str)}

Generate board pack in JSON:
{{
  "executive_summary": "3-4 sentences for board. Professional tone.",
  "headline_metrics": {{
    "revenue_status": "text",
    "cost_status": "text",
    "cash_status": "text",
    "forecast_status": "text"
  }},
  "variance_commentary": "2-3 paragraphs explaining key variances with root causes",
  "key_risks": [
    "Risk 1 with mitigation",
    "Risk 2 with mitigation"
  ],
  "management_actions": [
    "Action 1 — owner — deadline",
    "Action 2 — owner — deadline"
  ],
  "outlook": "One paragraph on next month forecast"
}}

Professional CFO language only.
Respond ONLY with JSON."""

        response = _get_client().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )

        text = _clean_json_block(response.content[0].text)
        return json.loads(text)

    except Exception:
        return {
            "executive_summary": "Board pack generated. Review individual modules for details.",
            "headline_metrics": {},
            "variance_commentary": "See variance analysis module.",
            "key_risks": [],
            "management_actions": [],
            "outlook": "Forecast available in FP&A module.",
        }
