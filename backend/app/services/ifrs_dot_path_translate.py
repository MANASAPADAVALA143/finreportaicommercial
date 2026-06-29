"""
Translate CompanyOnboarding dot-path keys → ifrs_line_item_master triples.

Source of truth: backend/app/data/ifrs_dot_path_map.json
(keep in sync with frontend/src/data/ifrs_dot_path_map.json)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

_MAP_PATH = Path(__file__).resolve().parent.parent / "data" / "ifrs_dot_path_map.json"


class MasterTriple(TypedDict, total=False):
    ifrs_statement: str
    ifrs_section: str
    ifrs_line_item: str
    match_quality: str
    note: str


class TranslateResult(TypedDict):
    ok: bool
    dot_path: str
    ifrs_statement: str | None
    ifrs_section: str | None
    ifrs_line_item: str | None
    match_quality: str
    note: str | None
    error: str | None


def _load_map() -> dict[str, dict[str, Any]]:
    with _MAP_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    return dict(data.get("mappings") or {})


def translate_dot_path(dot_path: str) -> TranslateResult:
    """Map one dot-path to master triple. Unmapped paths return ok=False."""
    raw = (dot_path or "").strip()
    entry = _load_map().get(raw)
    if not entry:
        logger.warning("ifrs_dot_path_translate: unknown dot-path %r", raw)
        return {
            "ok": False,
            "dot_path": raw,
            "ifrs_statement": None,
            "ifrs_section": None,
            "ifrs_line_item": None,
            "match_quality": "unknown",
            "note": None,
            "error": f"Unknown dot-path: {raw}",
        }
    quality = str(entry.get("match_quality") or "")
    if quality == "unmapped" or not entry.get("ifrs_line_item"):
        logger.warning(
            "ifrs_dot_path_translate: unmapped dot-path %r — %s",
            raw,
            entry.get("note"),
        )
        return {
            "ok": False,
            "dot_path": raw,
            "ifrs_statement": None,
            "ifrs_section": None,
            "ifrs_line_item": None,
            "match_quality": "unmapped",
            "note": entry.get("note"),
            "error": entry.get("note") or "No master line item mapping",
        }
    if quality == "best_fit":
        logger.info(
            "ifrs_dot_path_translate: best_fit %r → %s / %s — %s",
            raw,
            entry.get("ifrs_section"),
            entry.get("ifrs_line_item"),
            entry.get("note"),
        )
    return {
        "ok": True,
        "dot_path": raw,
        "ifrs_statement": entry["ifrs_statement"],
        "ifrs_section": entry["ifrs_section"],
        "ifrs_line_item": entry["ifrs_line_item"],
        "match_quality": quality,
        "note": entry.get("note"),
        "error": None,
    }


def translate_dot_path_mappings(
    mappings: dict[str, str],
) -> tuple[list[dict[str, Any]], list[TranslateResult]]:
    """
    Convert { gl_code: dot_path } onboarding map to template entries.
    Returns (successful_entries, failures_per_gl).
    """
    successes: list[dict[str, Any]] = []
    failures: list[TranslateResult] = []
    for gl_code, dot_path in mappings.items():
        tr = translate_dot_path(dot_path)
        if not tr["ok"]:
            failures.append(tr)
            continue
        successes.append(
            {
                "gl_code": gl_code,
                "gl_description": gl_code,
                "ifrs_statement": tr["ifrs_statement"],
                "ifrs_section": tr["ifrs_section"],
                "ifrs_line_item": tr["ifrs_line_item"],
                "dot_path": dot_path,
                "match_quality": tr["match_quality"],
            }
        )
    return successes, failures
