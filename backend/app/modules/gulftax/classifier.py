"""
GulfTax AI — Core VAT Classifier (embedded in FinReportAI)
============================================================
Classifies UAE transactions using Claude API + UAE VAT Law rules.
RAG layer (Supabase pgvector) is optional — falls back gracefully.

Originally from: https://github.com/MANASAPADAVALA143/uaetax.git
Embedded into FinReportAI — no separate port 8000 needed.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Optional RAG layer ────────────────────────────────────────────────────────
_rag = None

def _get_rag():
    """Lazily load the RAG service. Returns None if unavailable."""
    global _rag
    if _rag is not None:
        return _rag
    try:
        from app.modules.gulftax.rag import UAETaxRAG
        _rag = UAETaxRAG()
    except Exception:
        _rag = None
    return _rag


# ── Claude client ─────────────────────────────────────────────────────────────
def _get_claude():
    import anthropic
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic(api_key=key)


# ── UAE VAT system prompt (from GulfTax) ─────────────────────────────────────
_SYSTEM_PROMPT = """You are a UAE VAT specialist with deep knowledge of Federal Decree-Law No. 8 of 2017 and FTA clarifications. You classify transactions for UAE VAT returns with precision.

You must return ONLY valid JSON with no additional text, markdown, or code blocks.

CRITICAL UAE VAT RULES — READ FIRST:

PROFESSIONAL SERVICES ARE ALWAYS STANDARD RATED (5% VAT, Art.25):
- Audit and assurance fees (KPMG, PwC, Deloitte, EY, BDO, Grant Thornton)
- Tax advisory, CT advisory, corporate tax consulting fees
- Legal advisory fees (law firms, advocates, LLPs, Hadef & Partners, Clifford Chance, Baker McKenzie)
- Management consulting and strategy consulting (McKinsey, BCG, Bain, Pinnacle)
- Financial advisory, M&A advisory, financial modelling
- Compliance training and certification (Thomson Reuters, etc.)
- Company secretarial and registered agent services
- HR and payroll processing services
- IT consulting, IT security, penetration testing, cybersecurity
- Any service described as "advisory", "consulting", "assurance", "training", "secretarial"
DO NOT classify these as exempt — they are NEVER exempt under UAE VAT.

EXEMPT (Art.42) covers ONLY these financial services:
- Bank interest, loan charges, credit facility fees
- Currency exchange and foreign exchange transactions
- Life insurance policies (not general/commercial insurance)
- Investment fund management fees
- Deposit and savings account services
DO NOT apply exempt to professional fee services.

INSURANCE (Art.25 STANDARD RATED — 5% VAT):
- General/commercial insurance (AXA, Chubb, RSA, QBE, property, liability, cyber, indemnity)
- Professional indemnity insurance = STANDARD RATED
- Only pure life insurance policies = exempt

COMMERCIAL PROPERTY (Art.25 STANDARD RATED):
- Commercial office rent, warehouse rent, retail space = STANDARD RATED
- DIFC, Business Bay, JLT, SZR, Burj Daman, DWTC office rent = ALWAYS standard rated
- Free zone office rent = STANDARD RATED
- Only residential villa/apartment rent for private use = EXEMPT (Art.28)

SPECIFIC VENDOR RULES (ALWAYS STANDARD RATED):
- KPMG, PwC, Deloitte, EY, McKinsey, BCG, Bain, Hadef, Thomson Reuters
- Any "& Partners", "& Co", "LLP", "Advocates", "Consulting", "Advisory" in name
- DIFC Investments, Emaar Facilities, any facilities management company

ENTERTAINMENT / CATERING (Art.53 — Input VAT BLOCKED):
- When description contains: catering, dinner, entertainment, hospitality, gala, buffet, restaurant
- AND transaction_type = purchase:
  - vat_treatment = standard_rated (the supply is taxable)
  - Set blocked_input_vat = true
  - Set blocked_reason = "Art.53(1)(b) — input VAT on entertainment/meals not recoverable"
  - blocked_vat_amount = amount * 0.05"""


def classify_transaction(
    description: str,
    amount_aed: float,
    vendor_or_customer: Optional[str] = None,
    transaction_type: str = "purchase",
    entity_type: str = "mainland",
) -> Dict[str, Any]:
    """
    Classify a single UAE transaction. Returns classification dict.
    Safe to call directly — never raises (falls back to standard_rated on any error).
    """
    # Try RAG context
    rag_context = ""
    rag_sources: List[str] = []
    try:
        rag = _get_rag()
        if rag:
            rag_context, rag_sources = rag.retrieve_and_format(
                query=f"{description} {transaction_type} {entity_type}",
                law_type="VAT",
            )
    except Exception:
        pass

    context_section = (
        f"Relevant UAE VAT law context:\n{rag_context}"
        if rag_context
        else "No specific UAE law context retrieved — apply general UAE VAT rules."
    )

    user_prompt = f"""Classify this UAE transaction:
Description: {description}
Amount: AED {amount_aed}
Party: {vendor_or_customer or 'Not specified'}
Transaction type: {transaction_type}
Entity type: {entity_type}

{context_section}

Return JSON only:
{{
  "vat_treatment": "standard_rated|zero_rated|exempt|out_of_scope|reverse_charge",
  "vat_rate": 5 or 0,
  "vat_amount_aed": <calculated float>,
  "confidence_score": <0.0-1.0>,
  "reasoning": "one sentence explanation citing UAE VAT law",
  "flag_for_review": true or false,
  "flag_reason": "reason if flagged, null otherwise",
  "blocked_input_vat": false,
  "blocked_reason": null,
  "blocked_vat_amount": 0.0
}}"""

    try:
        claude = _get_claude()
        message = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            temperature=0.1,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        response_text = message.content[0].text.strip()
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        result = json.loads(response_text)
        return {
            "vat_treatment": result.get("vat_treatment", "standard_rated"),
            "vat_rate": int(result.get("vat_rate", 5)),
            "vat_amount_aed": float(result.get("vat_amount_aed", amount_aed * 0.05)),
            "confidence_score": float(result.get("confidence_score", 0.85)),
            "reasoning": result.get("reasoning", "Classified under UAE VAT Law"),
            "flag_for_review": bool(result.get("flag_for_review", False)),
            "flag_reason": result.get("flag_reason"),
            "blocked_input_vat": bool(result.get("blocked_input_vat", False)),
            "blocked_reason": result.get("blocked_reason"),
            "blocked_vat_amount": float(result.get("blocked_vat_amount", 0.0)),
            "rag_citations": rag_sources,
            "uae_law_sources": rag_sources,
        }
    except Exception as exc:
        logger.warning("GulfTax classify error: %s", exc)
        return {
            "vat_treatment": "standard_rated",
            "vat_rate": 5,
            "vat_amount_aed": round(amount_aed * 0.05, 2),
            "confidence_score": 0.5,
            "reasoning": "Classification unavailable — defaulting to standard rated 5%. Please review.",
            "flag_for_review": True,
            "flag_reason": f"Classification error: {exc}",
            "blocked_input_vat": False,
            "blocked_reason": None,
            "blocked_vat_amount": 0.0,
            "rag_citations": [],
            "uae_law_sources": [],
        }


def classify_batch(
    items: List[Dict[str, Any]],
    entity_type: str = "mainland",
) -> List[Dict[str, Any]]:
    """
    Classify multiple transactions in a single Claude API call.
    Each item: {description, amount, vendor, transaction_type}
    Returns list of classification dicts in same order.
    """
    if not items:
        return []

    batch_items = "\n".join(
        f'{i+1}. description="{s["description"]}" | amount={s["amount"]} AED'
        f' | party="{s.get("vendor") or "N/A"}" | type={s.get("transaction_type","purchase")}'
        for i, s in enumerate(items)
    )

    batch_prompt = f"""You are a UAE VAT expert. Classify each transaction under Federal Decree-Law No.8 of 2017.

Entity type: {entity_type}

Transactions:
{batch_items}

Return a JSON array (one object per transaction, in the same order). Each object:
{{
  "index": <1-based int>,
  "vat_treatment": "standard_rated|zero_rated|exempt|out_of_scope|reverse_charge",
  "vat_rate": 5 or 0,
  "vat_amount_aed": <net_amount * rate/100>,
  "confidence_score": <0.0-1.0>,
  "reasoning": "<one sentence citing UAE VAT law>",
  "flag_for_review": true or false,
  "flag_reason": "<string or null>",
  "blocked_input_vat": false,
  "blocked_reason": null,
  "blocked_vat_amount": 0.0
}}

CRITICAL: For any purchase transaction containing catering/entertainment/dinner/hospitality/gala/buffet/restaurant:
set blocked_input_vat=true, blocked_reason="Art.53(1)(b) — input VAT on entertainment/meals not recoverable"

Return ONLY the JSON array. No markdown, no preamble."""

    try:
        claude = _get_claude()
        msg = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8192,
            temperature=0.1,
            messages=[{"role": "user", "content": batch_prompt}],
        )
        raw_text = msg.content[0].text.strip()
        if "```" in raw_text:
            raw_text = raw_text.split("```")[1].split("```")[0].strip()
            if raw_text.startswith("json"):
                raw_text = raw_text[4:].strip()
        start = raw_text.find("[")
        end = raw_text.rfind("]")
        if start != -1 and end != -1:
            raw_text = raw_text[start:end + 1]
        batch_results = json.loads(raw_text)
        result_map = {r["index"]: r for r in batch_results}

        out = []
        for i, spec in enumerate(items):
            r = result_map.get(i + 1, {})
            out.append({
                "vat_treatment": r.get("vat_treatment", "standard_rated"),
                "vat_rate": int(r.get("vat_rate", 5)),
                "vat_amount_aed": float(r.get("vat_amount_aed", spec["amount"] * 0.05)),
                "confidence_score": float(r.get("confidence_score", 0.8)),
                "reasoning": r.get("reasoning", "Classified under UAE VAT Law"),
                "flag_for_review": bool(r.get("flag_for_review", False)),
                "flag_reason": r.get("flag_reason"),
                "blocked_input_vat": bool(r.get("blocked_input_vat", False)),
                "blocked_reason": r.get("blocked_reason"),
                "blocked_vat_amount": float(r.get("blocked_vat_amount", 0.0)),
                "rag_citations": [],
            })
        return out
    except Exception as exc:
        logger.warning("GulfTax batch classify error: %s", exc)
        return [
            {
                "vat_treatment": "standard_rated",
                "vat_rate": 5,
                "vat_amount_aed": round(s["amount"] * 0.05, 2),
                "confidence_score": 0.5,
                "reasoning": "Batch classification failed — defaulting to standard rated.",
                "flag_for_review": True,
                "flag_reason": str(exc),
                "blocked_input_vat": False,
                "blocked_reason": None,
                "blocked_vat_amount": 0.0,
                "rag_citations": [],
            }
            for s in items
        ]
