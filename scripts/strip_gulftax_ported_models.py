#!/usr/bin/env python3
"""
Strip auth / collision ORM classes from GulfTax ported/models.py after standalone sync.

Standalone GulfTax may ship its own User table; FinReportAI uses unified Supabase
auth (app.models.users). Re-importing User on sync causes SQLAlchemy mapper conflicts.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS_PATH = ROOT / "backend" / "app" / "modules" / "gulftax" / "ported" / "models.py"

# Classes that must never live in ported/models.py — owned by the main FinReportAI app.
EXCLUDED_CLASSES: frozenset[str] = frozenset(
    {
        "User",  # legacy standalone login ORM; auth is Supabase JWT + UserCompany
        "AuthUser",
        "JournalAuthUser",
        "RbacUser",
    }
)

SYNC_HEADER = """\
# NOTE: This file is synced from the standalone GulfTax repo.
# User/auth models are intentionally excluded — see scripts/sync_gulftax.sh.
# Do not add auth models here; use app.models.users.User (RbacUser).

"""

_CLASS_START = re.compile(r"^class\s+(\w+)\s*(?:\(|:)")
_USER_ALIAS = re.compile(r"^User\s*=")


def _remove_class_blocks(text: str) -> tuple[str, list[str]]:
    """Drop entire class definitions whose names are in EXCLUDED_CLASSES."""
    removed: list[str] = []
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    skipping = False

    for line in lines:
        match = _CLASS_START.match(line)
        if match:
            name = match.group(1)
            if name in EXCLUDED_CLASSES:
                skipping = True
                removed.append(name)
                continue
            skipping = False

        if skipping:
            continue

        if _USER_ALIAS.match(line.strip()):
            removed.append("User (alias)")
            continue

        out.append(line)

    return "".join(out), removed


def _ensure_sync_header(text: str) -> str:
    marker = "synced from the standalone GulfTax repo"
    if marker in text:
        return text
    # Keep module docstring if present; insert header after it.
    if text.startswith('"""') or text.startswith("'''"):
        quote = text[:3]
        end = text.find(quote, 3)
        if end != -1:
            end += 3
            if text[end : end + 1] == "\n":
                end += 1
            return text[:end] + SYNC_HEADER + text[end:]
    return SYNC_HEADER + text


def strip_ported_models(path: Path = MODELS_PATH) -> list[str]:
    if not path.is_file():
        print(f"  SKIP — not found: {path}")
        return []

    original = path.read_text(encoding="utf-8")
    stripped, removed = _remove_class_blocks(original)
    updated = _ensure_sync_header(stripped)

    if updated != original:
        path.write_text(updated, encoding="utf-8")
        if removed:
            print(f"  stripped from {path.name}: {', '.join(removed)}")
        else:
            print(f"  updated sync header in {path.name}")
    else:
        print(f"  no changes needed for {path.name}")

    return removed


def main() -> int:
    strip_ported_models()
    return 0


if __name__ == "__main__":
    sys.exit(main())
