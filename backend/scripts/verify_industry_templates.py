"""
Verify all INDUSTRY_TEMPLATES dot-path entries translate via ifrs_dot_path_translate.

Run from backend/:  python scripts/verify_industry_templates.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

DATA_PATH = BACKEND / "app" / "data" / "industry_templates.json"


def main() -> int:
    from app.services.ifrs_dot_path_translate import translate_dot_path

    with DATA_PATH.open(encoding="utf-8") as f:
        data = json.load(f)

    templates = data.get("templates") or []
    assert len(templates) == 4, f"expected 4 canonical industry templates, got {len(templates)}"

    total_entries = 0
    failures: list[str] = []

    print("=== Industry template dot-path verification ===\n")
    for tmpl in templates:
        tmpl_id = tmpl["id"]
        mappings: dict[str, str] = tmpl.get("mappings") or {}
        tmpl_failures = 0
        for gl_code, dot_path in mappings.items():
            total_entries += 1
            tr = translate_dot_path(dot_path)
            if not tr["ok"]:
                tmpl_failures += 1
                failures.append(f"{tmpl_id}/{gl_code}: {dot_path} -> {tr.get('error')}")
        status = "OK" if tmpl_failures == 0 else f"FAIL ({tmpl_failures})"
        print(f"{status} {tmpl['name']}: {len(mappings)} entries")

    print()
    if failures:
        print(f"FAIL {len(failures)}/{total_entries} entries did not translate:")
        for line in failures:
            print(f"  - {line}")
        return 1

    print(f"OK {total_entries}/{total_entries} industry template entries translate cleanly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
