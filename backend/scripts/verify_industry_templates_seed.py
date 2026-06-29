"""
Verify system industry templates are seeded in mapping_templates.

Run from backend/:  python scripts/verify_industry_templates_seed.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

_DB = BACKEND / "verify_industry_seed_tmp.db"
if _DB.exists():
    _DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_DB.as_posix()}"


def main() -> int:
    import app.models.ifrs_statement  # noqa: F401
    from app.core.database import Base, SessionLocal, engine
    from app.models.ifrs_statement import MappingTemplate
    from app.services.seed_industry_templates import SYSTEM_TENANT_ID, seed_industry_templates

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        n = seed_industry_templates(db)
        rows = (
            db.query(MappingTemplate)
            .filter(
                MappingTemplate.tenant_id == SYSTEM_TENANT_ID,
                MappingTemplate.is_system_template.is_(True),
            )
            .order_by(MappingTemplate.template_name)
            .all()
        )
        assert n == 4, f"expected 4 seeded, got {n}"
        assert len(rows) == 4, f"expected 4 rows, got {len(rows)}"
        ids = {r.template_name for r in rows}
        assert ids == {"manufacturing", "retail", "services", "technology"}, ids

        total_entries = sum(len(r.entries or []) for r in rows)
        print("=== Industry template DB seed verification ===")
        for r in rows:
            print(f"OK system template {r.template_name!r}: {len(r.entries or [])} entries, industry={r.industry!r}")
        print(f"OK {len(rows)} system templates, {total_entries} total translated entries, tenant_id={SYSTEM_TENANT_ID!r}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
