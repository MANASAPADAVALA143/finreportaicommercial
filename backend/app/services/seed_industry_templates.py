"""
Seed system-level industry mapping templates into mapping_templates.

Uses tenant_id=__system__ and is_system_template=True so tenants can adopt
via onboarding without a second storage mechanism.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs_statement import MappingTemplate
from app.services.ifrs_dot_path_translate import translate_dot_path

logger = logging.getLogger(__name__)

SYSTEM_TENANT_ID = "__system__"
_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "industry_templates.json"


def _load_definitions() -> list[dict[str, Any]]:
    with _DATA_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    return list(data.get("templates") or [])


def _entries_from_mappings(mappings: dict[str, str]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for gl_code, dot_path in mappings.items():
        tr = translate_dot_path(dot_path)
        if not tr["ok"]:
            raise ValueError(f"Cannot seed {gl_code}: {dot_path} — {tr.get('error')}")
        entries.append(
            {
                "gl_code": gl_code,
                "gl_description": gl_code,
                "ifrs_statement": tr["ifrs_statement"],
                "ifrs_section": tr["ifrs_section"],
                "ifrs_line_item": tr["ifrs_line_item"],
                "dot_path": dot_path,
                "match_quality": tr["match_quality"],
                "ai_confidence_score": 0.98,
            }
        )
    return entries


def seed_industry_templates(db: Session) -> int:
    """Upsert canonical industry templates. Returns count seeded/updated."""
    definitions = _load_definitions()
    seeded = 0
    for defn in definitions:
        tmpl_id = str(defn["id"])
        entries = _entries_from_mappings(defn.get("mappings") or {})
        existing = (
            db.query(MappingTemplate)
            .filter(
                MappingTemplate.tenant_id == SYSTEM_TENANT_ID,
                MappingTemplate.is_system_template.is_(True),
                MappingTemplate.template_name == tmpl_id,
            )
            .first()
        )
        if existing:
            existing.industry = defn.get("industry")
            existing.entries = entries
            existing.is_default = False
        else:
            db.add(
                MappingTemplate(
                    tenant_id=SYSTEM_TENANT_ID,
                    template_name=tmpl_id,
                    industry=defn.get("industry"),
                    is_default=False,
                    is_system_template=True,
                    entries=entries,
                )
            )
        seeded += 1
    db.commit()
    logger.info("Seeded %s system industry templates", seeded)
    return seeded


def list_system_industry_templates(db: Session) -> list[dict[str, Any]]:
    """Return system industry templates with metadata for API/UI."""
    definitions = {d["id"]: d for d in _load_definitions()}
    rows = (
        db.query(MappingTemplate)
        .filter(
            MappingTemplate.tenant_id == SYSTEM_TENANT_ID,
            MappingTemplate.is_system_template.is_(True),
        )
        .order_by(MappingTemplate.id)
        .all()
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        meta = definitions.get(row.template_name, {})
        out.append(
            {
                "id": row.template_name,
                "name": meta.get("name") or row.template_name,
                "industry": row.industry,
                "description": meta.get("description"),
                "icon": meta.get("icon"),
                "accountCount": len(row.entries or []),
                "entries_count": len(row.entries or []),
            }
        )
    return out
