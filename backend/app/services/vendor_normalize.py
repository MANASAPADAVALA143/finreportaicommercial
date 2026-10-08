"""Vendor identity normalisation shared by matching, duplicate and anomaly rules.

Mirrors frontend/src/lib/ap-invoice/apSourceMapping.ts and public.normalize_vendor_name().
"""

from __future__ import annotations

import re

_NOISE = {
    "llc", "fze", "fzco", "fz", "fzllc", "pjsc", "psc", "plc", "ltd", "limited",
    "inc", "co", "company", "est", "establishment", "uae", "the",
}


def normalize_vendor_name(name: str | None) -> str:
    """'DEWA (Dubai Electricity)' and 'DEWA' → 'dewa'; 'Oracle Middle East' → 'oracle'."""
    s = (name or "").lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("middle east", " ")
    s = re.sub(r"[^a-z0-9&\s]", " ", s)
    return " ".join(w for w in s.split() if w not in _NOISE)


def same_vendor(
    a: str | None,
    b: str | None,
    code_a: str | None = None,
    code_b: str | None = None,
) -> bool:
    """Codes decide when both exist; else normalised names equal or whole-word prefix."""
    ca = (code_a or "").strip().upper()
    cb = (code_b or "").strip().upper()
    if ca and cb:
        return ca == cb
    na, nb = normalize_vendor_name(a), normalize_vendor_name(b)
    if not na or not nb:
        return False
    return na == nb or na.startswith(nb + " ") or nb.startswith(na + " ")
