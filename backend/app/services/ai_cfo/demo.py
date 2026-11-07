"""Clearly labelled synthetic demo company for the AI CFO flow.

Creates (or rebuilds) one company named "... (synthetic data)" inside the caller's
workspace with seven months of posted, balanced journals and an FP&A budget. The last
month contains three planted anomalies: a one-off consulting spike, a utility bill posted
twice, and travel well over budget. Real companies are never touched: rebuilding only
deletes rows belonging to the demo company.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoFinding, AiCfoInvestigation, AiCfoToolCall
from app.models.client_data import ApCompany
from app.models.company_setup import UaeCompanyProfile
from app.models.fpa_master import FpaMasterRow
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine
from app.services.ai_cfo.ledger import period_add
from app.services.uae_coa_service import seed_uae_chart_of_accounts

DEMO_NAME = "Gnanova Demo Trading LLC (synthetic data)"
DEMO_SLUG = "gnanova-ai-cfo-demo"
DEMO_SOURCE = "ai_cfo_demo"
DEMO_UPLOAD_ID = "ai-cfo-demo"
BANK = ("1002", "Cash at Bank - ENBD")

# account, name, monthly base amount, description
RECURRING = [
    ("6010", "Service Revenue", 420000, "Monthly service billings"),
    ("7001", "Cost of Goods Sold", 150000, "Direct costs of services delivered"),
    ("7101", "Salaries & Wages", 110000, "Monthly payroll"),
    ("7110", "Office Rent", 35000, "Office rent - Business Bay"),
    ("7120", "Utilities", 6200, "DEWA electricity and water bill"),
    ("7130", "Marketing & Advertising", 14000, "Digital marketing retainer"),
    ("7140", "Professional Fees", 9500, "Monthly bookkeeping and payroll retainer"),
    ("7150", "Travel & Entertainment", 7000, "Client travel"),
    ("7160", "Bank Charges", 900, "Bank charges"),
]
# small, repeatable month-to-month variation (no randomness)
VARIATION = [0.97, 1.02, 0.99, 1.03, 0.98, 1.01]
BUDGET_MULTIPLIER = 1.05


def _months(today: date) -> list[str]:
    last = period_add(f"{today.year:04d}-{today.month:02d}", -1)
    return [period_add(last, -i) for i in range(6, -1, -1)]


def _entry(tenant: str, company: str, period: str, n: int, day: int, description: str,
           debit: tuple[str, str], credit: tuple[str, str], amount: float, reference: str | None = None) -> UAEJournalEntry:
    year, month = int(period[:4]), int(period[5:7])
    entry = UAEJournalEntry(
        tenant_id=tenant, company_id=company, entry_number=f"DEMO-JE-{period}-{n:02d}",
        entry_date=date(year, month, day), period=period, description=description,
        reference=reference or f"DEMO-{period}-{n:02d}", source=DEMO_SOURCE, status="posted",
        posted_at=datetime.utcnow(),
    )
    amount = round(amount, 2)
    entry.lines = [
        UAEJournalLine(account_code=debit[0], account_name=debit[1], description=description, debit=amount, credit=0),
        UAEJournalLine(account_code=credit[0], account_name=credit[1], description=description, debit=0, credit=amount),
    ]
    return entry


def _clear(db: Session, tenant: str, company_id: str) -> None:
    inv_ids = [i for (i,) in db.query(AiCfoInvestigation.id).filter(
        AiCfoInvestigation.workspace_id == tenant, AiCfoInvestigation.company_id == company_id)]
    if inv_ids:
        db.query(AiCfoToolCall).filter(AiCfoToolCall.investigation_id.in_(inv_ids)).delete(synchronize_session=False)
    for model in (AiCfoApprovalRequest, AiCfoInvestigation, AiCfoFinding):
        db.query(model).filter(model.workspace_id == tenant, model.company_id == company_id).delete(synchronize_session=False)
    entry_ids = [e for (e,) in db.query(UAEJournalEntry.id).filter(
        UAEJournalEntry.tenant_id == tenant, UAEJournalEntry.company_id == company_id,
        UAEJournalEntry.source == DEMO_SOURCE)]
    if entry_ids:
        db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id.in_(entry_ids)).delete(synchronize_session=False)
        db.query(UAEJournalEntry).filter(UAEJournalEntry.id.in_(entry_ids)).delete(synchronize_session=False)
    db.query(FpaMasterRow).filter(
        FpaMasterRow.company_id == company_id, FpaMasterRow.upload_id == DEMO_UPLOAD_ID
    ).delete(synchronize_session=False)


def seed_demo_company(db: Session, workspace_id: str, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    profile = (
        db.query(UaeCompanyProfile)
        .filter(UaeCompanyProfile.workspace_id == workspace_id, UaeCompanyProfile.company_name == DEMO_NAME)
        .first()
    )
    if profile is None:
        profile = UaeCompanyProfile(
            workspace_id=workspace_id, company_name=DEMO_NAME, trade_name="Gnanova Demo",
            base_currency="AED", reporting_standard="IFRS", financial_year_start=1,
            industry="Professional services", status="active", setup_step=5, coa_option="default",
        )
        db.add(profile)
        db.flush()
    if db.get(ApCompany, profile.id) is None:
        db.add(ApCompany(id=profile.id, tenant_id=workspace_id, name=DEMO_NAME, slug=DEMO_SLUG, market="uae"))
        db.flush()
    _clear(db, workspace_id, profile.id)
    seed_uae_chart_of_accounts(workspace_id, db, company_id=profile.id)

    months = _months(today)
    entries: list[UAEJournalEntry] = []
    for idx, period in enumerate(months):
        factor = VARIATION[idx % len(VARIATION)]
        n = 0
        for code, name, base, desc in RECURRING:
            n += 1
            amount = base * factor
            if code.startswith("6"):
                entries.append(_entry(workspace_id, profile.id, period, n, 5, desc, BANK, (code, name), amount))
            else:
                entries.append(_entry(workspace_id, profile.id, period, n, 10 + n, desc, (code, name), BANK, amount))
        if period == months[-1]:
            entries.append(_entry(workspace_id, profile.id, period, 20, 18,
                                  "Strategy consulting - Meridian Advisory (one-off market entry study)",
                                  ("7140", "Professional Fees"), BANK, 68000, reference="MER-INV-2207"))
            entries.append(_entry(workspace_id, profile.id, period, 21, 22, RECURRING[4][3] + " (posted again)",
                                  ("7120", "Utilities"), BANK, round(6200 * factor, 2)))
            entries[-1].lines[0].description = RECURRING[4][3]
            entries[-1].lines[1].description = RECURRING[4][3]
            entries[-1].description = RECURRING[4][3]
            entries.append(_entry(workspace_id, profile.id, period, 22, 25,
                                  "Client workshop travel - Riyadh delegation", ("7150", "Travel & Entertainment"),
                                  BANK, 16500, reference="TRV-0925"))
    db.add_all(entries)

    years = sorted({p[:4] for p in months})
    budget_rows = 0
    for year in years:
        for code, name, base, _ in RECURRING:
            if not code.startswith("7"):
                continue
            db.add(FpaMasterRow(
                upload_id=DEMO_UPLOAD_ID, section="PL", currency="AED", fiscal_year=f"FY{year}",
                account_code=code, account_name=name, account_type="expense",
                monthly_actuals=json.dumps([0.0] * 12),
                monthly_budgets=json.dumps([round(base * BUDGET_MULTIPLIER, 2)] * 12),
                company_id=profile.id, notes="Synthetic demo budget",
            ))
            budget_rows += 1
    db.commit()
    return {
        "company_id": profile.id, "company_name": DEMO_NAME, "periods": months,
        "journal_entries": len(entries), "budget_rows": budget_rows,
        "planted_anomalies": [
            "Professional Fees spike: one-off Meridian Advisory study in the last month",
            "Utilities: the DEWA bill posted twice in the last month",
            "Travel & Entertainment over budget in the last month",
        ],
    }
