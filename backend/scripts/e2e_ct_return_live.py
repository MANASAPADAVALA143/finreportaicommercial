#!/usr/bin/env python3
"""Live E2E — CT return workflow on RDS (generate → approve → file)."""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.client_data import ApCompany, CtReturn
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services import ct_return_service as svc
from app.services.uae_journal_service import create_journal_entry

E2E_PREFIX = "E2E-CT-RET-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 12, 31)


def _db_url() -> str:
    url = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if not url.startswith("postgresql"):
        print("ERROR: DATABASE_URL not set. Run on EC2.")
        return ""
    return url


def _cleanup(db) -> None:
    db.query(CtReturn).filter(
        CtReturn.tenant_id == TENANT,
        CtReturn.company_id == COMPANY_ID,
        CtReturn.period_start == PERIOD_START,
    ).delete(synchronize_session=False)
    for period in ["2026-01", "2026-12"]:
        je_ids = [
            r[0]
            for r in db.query(UAEJournalEntry.id)
            .filter(
                UAEJournalEntry.tenant_id == TENANT,
                UAEJournalEntry.company_id == COMPANY_ID,
                UAEJournalEntry.period == period,
                UAEJournalEntry.reference.like(f"{E2E_PREFIX}%"),
            )
            .all()
        ]
        if je_ids:
            db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id.in_(je_ids)).delete(
                synchronize_session=False
            )
            db.query(UAEJournalEntry).filter(UAEJournalEntry.id.in_(je_ids)).delete(synchronize_session=False)
    db.commit()


def _ensure_company(db) -> None:
    if not db.query(ApCompany).filter_by(id=COMPANY_ID).first():
        db.add(
            ApCompany(
                id=COMPANY_ID,
                tenant_id=TENANT,
                name="ABC TRADING LLC",
                slug="abc-trading-e2e-ct",
            )
        )
        db.commit()


def _ensure_accounts(db) -> None:
    for code, name, atype in [
        ("7010", "Sales Revenue", "income"),
        ("7110", "Operating Expense", "expense"),
    ]:
        existing = (
            db.query(UAEAccount)
            .filter_by(tenant_id=TENANT, code=code, company_id=COMPANY_ID)
            .first()
        )
        if not existing:
            db.add(
                UAEAccount(
                    tenant_id=TENANT,
                    company_id=COMPANY_ID,
                    code=code,
                    name=name,
                    account_type=atype,
                    is_active=True,
                )
            )
    db.commit()


def _seed_gl(db) -> None:
    """Revenue 800k, expense 300k → taxable 500k → CT 11,250."""
    create_journal_entry(
        tenant_id=TENANT,
        entry_date=date(2026, 6, 15),
        description=f"{E2E_PREFIX} revenue",
        reference=f"{E2E_PREFIX}REV",
        source="manual",
        company_id=COMPANY_ID,
        db=db,
        auto_post=True,
        lines=[
            {"account_code": "1100", "account_name": "Bank", "debit": 800_000, "credit": 0},
            {"account_code": "7010", "account_name": "Sales Revenue", "debit": 0, "credit": 800_000},
        ],
    )
    create_journal_entry(
        tenant_id=TENANT,
        entry_date=date(2026, 6, 20),
        description=f"{E2E_PREFIX} expense",
        reference=f"{E2E_PREFIX}EXP",
        source="manual",
        company_id=COMPANY_ID,
        db=db,
        auto_post=True,
        lines=[
            {"account_code": "7110", "account_name": "Operating Expense", "debit": 300_000, "credit": 0},
            {"account_code": "1100", "account_name": "Bank", "debit": 0, "credit": 300_000},
        ],
    )


def main() -> int:
    url = _db_url()
    if not url:
        return 1

    engine = create_engine(url)
    Session = sessionmaker(bind=engine)
    db = Session()
    result: dict = {"pass": False, "steps": []}

    try:
        _cleanup(db)
        _ensure_company(db)
        _ensure_accounts(db)
        _seed_gl(db)

        draft = svc.generate_ct_return(db, TENANT, COMPANY_ID, PERIOD_START, PERIOD_END)
        expected_ct = float(draft["ct_payable_aed"])
        result["steps"].append({"generate": {"id": draft["id"], "ct_payable_aed": expected_ct}})
        assert draft["status"] == "draft", draft
        assert expected_ct >= 0, draft

        blocked = svc.file_ct_return(db, draft["id"])
        assert blocked.get("blocked"), blocked
        result["steps"].append({"file_blocked": True})

        approved = svc.approve_ct_return(db, draft["id"])
        assert approved["status"] == "approved", approved
        result["steps"].append({"approve": approved["status"]})

        filed = svc.file_ct_return(db, draft["id"])
        assert filed["status"] == "filed", filed
        assert filed.get("filed_at"), filed
        result["steps"].append({"file": filed["status"]})

        row = db.query(CtReturn).filter_by(id=draft["id"]).first()
        assert row is not None
        assert row.status == "filed"
        assert float(row.ct_payable_aed) == expected_ct
        result["rds_row"] = {
            "id": row.id,
            "status": row.status,
            "ct_payable_aed": float(row.ct_payable_aed),
            "taxable_income": float(row.taxable_income or 0),
        }
        result["pass"] = True
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        result["error"] = str(exc)
        print(json.dumps(result, indent=2))
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
