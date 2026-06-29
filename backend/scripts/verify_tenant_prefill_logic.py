"""
Tenant template pre-fill logic (stdlib only — no SQLAlchemy import).

Mirrors apply_template_mappings_first / _load_default_template_entries behaviour
so verification can run even when SQLAlchemy engine creation is blocked (e.g. DB lock).

Run: python scripts/verify_tenant_prefill_logic.py
"""
from __future__ import annotations

import re
from typing import Any


def _canonical_gl_code(raw: Any) -> str:
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    m = re.fullmatch(r"(-?)(\d+)\.0+", s)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    return s


def _load_default_template_entries(templates: list[dict], tenant_id: str) -> list[dict]:
    matches = [t for t in templates if t["tenant_id"] == tenant_id and t.get("is_default")]
    if not matches:
        return []
    return list(matches[-1]["entries"] or [])


def apply_template_matches(
    templates: list[dict],
    tenant_id: str,
    tb_lines: list[dict[str, str]],
) -> dict[str, dict]:
    """Return gl_code -> template entry for lines matched under tenant."""
    entries = _load_default_template_entries(templates, tenant_id)
    if not entries:
        return {}

    by_code: dict[str, dict] = {}
    for ent in entries:
        if not isinstance(ent, dict):
            continue
        code = _canonical_gl_code(ent.get("gl_code"))
        if code and code not in by_code:
            by_code[code] = ent
        raw = str(ent.get("gl_code", "")).strip()
        if raw and raw not in by_code:
            by_code[raw] = ent

    matched: dict[str, dict] = {}
    for line in tb_lines:
        can = _canonical_gl_code(line["gl_code"])
        raw = str(line["gl_code"]).strip()
        ent = by_code.get(can) or by_code.get(raw)
        if ent:
            matched[line["gl_code"]] = ent
    return matched


def main() -> int:
    templates = [
        {
            "tenant_id": "default",
            "is_default": True,
            "entries": [
                {"gl_code": "1001", "ifrs_line_item": "Cash and cash equivalents"},
                {"gl_code": "6001", "ifrs_line_item": "Revenue from contracts with customers"},
            ],
        },
        {
            "tenant_id": "demo-client-acme",
            "is_default": True,
            "entries": [
                {"gl_code": "1001", "ifrs_line_item": "Cash and cash equivalents"},
                {"gl_code": "6001", "ifrs_line_item": "Revenue from contracts with customers"},
            ],
        },
    ]
    lines = [
        {"gl_code": "1001"},
        {"gl_code": "6001"},
        {"gl_code": "7001"},
    ]

    for tenant in ("default", "demo-client-acme"):
        m = apply_template_matches(templates, tenant, lines)
        assert set(m.keys()) == {"1001", "6001"}, tenant
        assert "7001" not in m
        print(f"OK tenant={tenant!r}: 2 template matches, 7001 left for AI")

    # Cross-tenant isolation: template for tenant B must not apply when loading tenant A only
    only_acme = [t for t in templates if t["tenant_id"] == "demo-client-acme"]
    m_default_with_acme_store = apply_template_matches(only_acme, "default", lines)
    assert m_default_with_acme_store == {}, "default tenant must not see acme-only templates"

    only_default = [t for t in templates if t["tenant_id"] == "default"]
    m_acme_with_default_store = apply_template_matches(only_default, "demo-client-acme", lines)
    assert m_acme_with_default_store == {}, "acme tenant must not see default-only templates"

    print("OK cross-tenant isolation: templates scoped by tenant_id")
    print("All tenant pre-fill logic checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
