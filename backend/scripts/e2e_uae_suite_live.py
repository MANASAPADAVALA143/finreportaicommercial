#!/usr/bin/env python3
"""Live E2E — uae_suite role summary + middleware access on RDS."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.middleware.product_role_middleware import _path_allowed
from app.modules.gulftax.ported_mount import get_ported_db
from app.services.uae_suite_service import build_uae_suite_summary

TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"


def _db_url() -> str:
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if not url.startswith("postgresql"):
        print("ERROR: DATABASE_URL not set. Run on EC2.")
        return ""
    return url


def main() -> int:
    url = _db_url()
    if not url:
        return 1

    result: dict = {"pass": False, "steps": []}

    try:
        middleware_checks = {
            "ar_allowed": _path_allowed("uae_suite", "accountant", "/api/uae/ar/aging"),
            "suite_summary_allowed": _path_allowed("uae_suite", "accountant", "/api/uae-suite/summary"),
            "fpa_blocked": not _path_allowed("uae_suite", "accountant", "/api/fpa/variance"),
            "uae_client_ar_blocked": not _path_allowed("uae_client", "accountant", "/api/uae/ar/aging"),
        }
        result["steps"].append({"middleware": middleware_checks})
        assert all(middleware_checks.values()), middleware_checks

        engine = create_engine(url)
        Session = sessionmaker(bind=engine)
        db = Session()
        ported_gen = get_ported_db()
        ported_db = next(ported_gen)
        try:
            summary = build_uae_suite_summary(
                db,
                ported_db,
                tenant_id=TENANT,
                company_id=COMPANY_ID,
            )
        finally:
            try:
                next(ported_gen)
            except StopIteration:
                pass
            db.close()

        assert "ap" in summary and "ar" in summary and "uae_tax" in summary, summary
        result["steps"].append({
            "summary": {
                "ap_outstanding": summary["ap"]["total_outstanding"],
                "ar_outstanding": summary["ar"]["total_outstanding"],
                "vat_payable": summary["uae_tax"]["estimated_vat_payable_aed"],
                "ct_status": summary["uae_tax"]["ct_return"]["status"],
                "recon_status": summary["uae_tax"]["recon_status"],
                "einvoicing_score": summary["uae_tax"]["e_invoicing"]["readiness_score"],
            }
        })
        result["pass"] = True
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        result["error"] = str(exc)
        print(json.dumps(result, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
