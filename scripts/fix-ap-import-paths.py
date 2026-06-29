#!/usr/bin/env python3
"""Rewrite standalone @/lib/foo imports to @/lib/ap-invoice/foo for AP modules."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "frontend" / "src"
AP_LIB = ROOT / "lib" / "ap-invoice"
modules = sorted(
    {p.stem for p in AP_LIB.glob("*.ts") if p.stem != "utils"},
    key=len,
    reverse=True,
)

count = 0
for path in ROOT.rglob("*.ts"):
    if "node_modules" in path.parts:
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    orig = text
    for mod in modules:
        text = text.replace(f"@/lib/{mod}", f"@/lib/ap-invoice/{mod}")
    text = text.replace("@/lib/ap-invoice/ap-invoice/", "@/lib/ap-invoice/")
    if text != orig:
        path.write_text(text, encoding="utf-8")
        count += 1
        print(path.relative_to(ROOT.parent.parent))

for path in ROOT.rglob("*.tsx"):
    if "node_modules" in path.parts:
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    orig = text
    for mod in modules:
        text = text.replace(f"@/lib/{mod}", f"@/lib/ap-invoice/{mod}")
    text = text.replace("@/lib/ap-invoice/ap-invoice/", "@/lib/ap-invoice/")
    if text != orig:
        path.write_text(text, encoding="utf-8")
        count += 1
        print(path.relative_to(ROOT.parent.parent))

print(f"Fixed {count} files")
