#!/usr/bin/env python3
"""Live E2E — CT return Phase 2 on RDS (50% entertainment, SBR election)."""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.client_data import ApCompany, CtReturn
from app.models.uae_account_classification import UAEAccountClassification
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.services import ct_return_service as svc
from app.services.uae_journal_service import create_journal_entry

E2E_PREFIX = "E2E-CT-P2-"
TENANT = "59818b25-a981-4fe4-9a1f-7ffaafecef13"
COMPANY_ID = "e26d6523-d86b-4e77-8e16-23f251304480"
PERIOD_START = date(2099, 1, 1)
PERIOD_END = date(2099, 12, 31)


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
    db.query(UAEAccountClassification).filter(
        UAEAccountClassification.workspace_id == TENANT,
        UAEAccountClassification.company_id == COMPANY_ID,
        UAEAccountClassification.account_code == "7188",
    ).delete(synchronize_session=False)
    for period in ["2099-01", "2099-12"]:
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
                slug="abc-trading-e2e-ct-p2",
            )
        )
        db.commit()


def _ensure_accounts(db) -> None:
    for code, name, atype in [
        ("7010", "Sales Revenue", "income"),
        ("7110", "Operating Expense", "expense"),
        ("7188", "Entertainment", "expense"),
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
    """Revenue 2M, opex 1.4M, entertainment 100k → profit 500k, 50k add-back."""
    create_journal_entry(
        tenant_id=TENANT,
        entry_date=date(2099, 3, 10),
        description=f"{E2E_PREFIX} revenue",
        reference=f"{E2E_PREFIX}REV",
        source="manual",
        company_id=COMPANY_ID,
        db=db,
        auto_post=True,
        lines=[
            {"account_code": "1100", "account_name": "Bank", "debit": 2_000_000, "credit": 0},
            {"account_code": "7010", "account_name": "Sales Revenue", "debit": 0, "credit": 2_000_000},
        ],
    )
    create_journal_entry(
        tenant_id=TENANT,
        entry_date=date(2099, 3, 15),
        description=f"{E2E_PREFIX} opex",
        reference=f"{E2E_PREFIX}OPEX",
        source="manual",
        company_id=COMPANY_ID,
        db=db,
        auto_post=True,
        lines=[
            {"account_code": "7110", "account_name": "Operating Expense", "debit": 1_400_000, "credit": 0},
            {"account_code": "1100", "account_name": "Bank", "debit": 0, "credit": 1_400_000},
        ],
    )
    create_journal_entry(
        tenant_id=TENANT,
        entry_date=date(2099, 3, 20),
        description=f"{E2E_PREFIX} entertainment",
        reference=f"{E2E_PREFIX}ENT",
        source="manual",
        company_id=COMPANY_ID,
        db=db,
        auto_post=True,
        lines=[
            {"account_code": "7188", "account_name": "Entertainment", "debit": 100_000, "credit": 0},
            {"account_code": "1100", "account_name": "Bank", "debit": 0, "credit": 100_000},
        ],
    )


def _seed_entertainment_classification(db) -> None:
    existing = (
        db.query(UAEAccountClassification)
        .filter_by(workspace_id=TENANT, company_id=COMPANY_ID, account_code="7188")
        .first()
    )
    if existing:
        existing.cit_category = "Entertainment"
        existing.cit_add_back = True
    else:
        db.add(
            UAEAccountClassification(
                workspace_id=TENANT,
                company_id=COMPANY_ID,
                account_code="7188",
                account_name="Entertainment",
                cit_category="Entertainment",
                cit_add_back=True,
            )
        )
    db.commit()


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
        _seed_entertainment_classification(db)

        draft = svc.generate_ct_return(db, TENANT, COMPANY_ID, PERIOD_START, PERIOD_END)
        add_backs = [a for a in (draft.get("adjustments") or []) if a.get("type") == "add_back"]
        ent = next((a for a in add_backs if a.get("account_code") == "7188"), None)
        assert ent is not None, draft
        assert ent["add_back_pct"] == 0.5, ent
        assert ent["add_back_amount"] == 50_000, ent
        assert draft["non_deductible_expenses"] == 50_000, draft
        assert draft["taxable_income"] == 550_000, draft
        expected_ct = 15_750.0  # (550k - 375k) * 9%
        assert float(draft["ct_payable_aed"]) == expected_ct, draft

        row = db.query(CtReturn).filter_by(id=draft["id"]).first()
        assert row is not None
        assert row.adjustments is not None
        assert len(row.adjustments) >= 1

        result["steps"].append({
            "entertainment_50pct": {
                "add_back_amount": ent["add_back_amount"],
                "taxable_income": draft["taxable_income"],
                "ct_payable_aed": draft["ct_payable_aed"],
                "adjustments_json": row.adjustments,
            }
        })

        db.query(CtReturn).filter_by(id=draft["id"]).delete()
        db.commit()

        sbr = svc.generate_ct_return(
            db, TENANT, COMPANY_ID, PERIOD_START, PERIOD_END, elect_sbr=True
        )
        assert sbr["sbr_eligible"] is True, sbr
        assert sbr["sbr_elected"] is True, sbr
        assert float(sbr["ct_payable_aed"]) == 0.0, sbr

        result["steps"].append({
            "sbr_election": {
                "sbr_eligible": sbr["sbr_eligible"],
                "sbr_elected": sbr["sbr_elected"],
                "ct_payable_aed": sbr["ct_payable_aed"],
            }
        })

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
