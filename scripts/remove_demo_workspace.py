"""Remove hardcoded 'demo' workspace fallbacks from frontend source files."""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "src"

REPLACEMENTS = [
    (re.compile(r" \?\? 'demo'"), ""),
    (re.compile(r" \|\| 'demo'"), ""),
    (re.compile(r"\n    'demo';"), "\n    '';"),
]

for path in ROOT.rglob("*"):
    if path.suffix not in {".ts", ".tsx"}:
        continue
    if path.name == "workspaceHeaders.ts":
        continue
    text = path.read_text(encoding="utf-8")
    original = text
    for pattern, repl in REPLACEMENTS:
        text = pattern.sub(repl, text)
    if text != original:
        path.write_text(text, encoding="utf-8")
        print(path.relative_to(ROOT))
