#!/usr/bin/env python3
"""
Prabu demo seed — realistic UAE SME data for two companies.

Run manually from backend/:
  python app/scripts/seed_prabu_demo.py

Does NOT run automatically. Safe to re-run (clears prior prabu_demo JEs first).
"""
from __future__ import annotations

import sys
import uuid
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session

from app.core.database import SessionLocal, engine, Base
from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.uae_accounting_full import (
    UAECustomer,
    UAEJournalEntry,
    UAEJournalLine,
    UAESalesInvoice,
)
from app.models.uae_ap import UAEPurchaseInvoice, UAEVendor
from app.models.users import User
from app.models.workspace import Workspace, WorkspaceMember
from app.services.uae_coa_service import seed_uae_chart_of_accounts
from app.services.uae_journal_service import create_journal_entry

COMPANY_1 = {
    "company_name": "Al Noor Trading LLC",
    "legal_type": "LLC",
    "trn": "100123456700003",
    "industry": "Trading",
    "financial_year_start": 1,
}
COMPANY_2 = {
    "company_name": "Noor Services FZE",
    "legal_type": "FZE",
    "trn": "100987654300001",
    "industry": "Services",
    "financial_year_start": 1,
}

# GL codes (UAE default CoA)
CASH = "1002"
TRADE_REC = "1100"
INVENTORY = "1200"
PPE = "2001"
TRADE_PAY = "3001"
SHARE_CAP = "5001"
RETAINED = "5010"
SALES = "6001"
SERVICE_REV = "6010"
COGS = "7001"
SALARIES = "7101"
RENT = "7110"
UTILITIES = "7120"
PROF_FEES = "7140"

DEMO_YEAR = 2025
DEMO_MONTHS = list(range(1, 7))  # Jan–Jun 2025
SOURCE = "prabu_demo"


def ensure_schema() -> None:
    """Ensure multi-company columns/tables exist (SQLite dev DB may skip Alembic)."""
    import app.models.company_setup  # noqa: F401
    import app.models.uae_accounting_full  # noqa: F401
    import app.models.uae_ap  # noqa: F401

    Base.metadata.create_all(bind=engine)
    from sqlalchemy import text

    tables = (
        "uae_accounts",
        "uae_journal_entries",
        "uae_sales_invoices",
        "uae_bank_accounts",
        "uae_fixed_assets",
    )
    with engine.connect() as conn:
        for tbl in tables:
            try:
                cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({tbl})"))}
                if cols and "company_id" not in cols:
                    conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN company_id VARCHAR(36)"))
            except Exception:
                pass
        conn.commit()


def _uid() -> str:
    return str(uuid.uuid4())


def resolve_workspace(db: Session) -> tuple[Workspace, User]:
    user = db.query(User).filter(User.email == "admin@gnanova.com").first()
    if not user:
        raise SystemExit("admin@gnanova.com not found. Start backend once to seed auth.")
    member = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.created_at.asc())
        .first()
    )
    if member:
        ws = db.query(Workspace).filter(Workspace.id == member.workspace_id).first()
        if ws:
            return ws, user
    ws = db.query(Workspace).order_by(Workspace.created_at.asc()).first()
    if not ws:
        raise SystemExit("No workspace found. Log in and create a workspace first.")
    return ws, user


def get_or_create_company(db: Session, workspace_id: str, spec: dict) -> UaeCompanyProfile:
    row = (
        db.query(UaeCompanyProfile)
        .filter_by(workspace_id=workspace_id, company_name=spec["company_name"])
        .first()
    )
    if row:
        row.status = "active"
        row.setup_step = 6
        row.legal_type = spec["legal_type"]
        row.trn = spec["trn"]
        row.industry = spec["industry"]
        row.financial_year_start = spec["financial_year_start"]
        row.base_currency = "AED"
        row.reporting_standard = "IFRS"
        row.updated_at = datetime.utcnow()
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    profile = UaeCompanyProfile(
        id=_uid(),
        workspace_id=workspace_id,
        company_name=spec["company_name"],
        legal_type=spec["legal_type"],
        trn=spec["trn"],
        industry=spec["industry"],
        financial_year_start=spec["financial_year_start"],
        base_currency="AED",
        reporting_standard="IFRS",
        status="active",
        setup_step=6,
        opening_balance_date=date(DEMO_YEAR, 1, 1),
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def clear_demo_data(db: Session, workspace_id: str, company_ids: list[str]) -> None:
    je_ids = [
        j.id
        for j in db.query(UAEJournalEntry)
        .filter(
            UAEJournalEntry.tenant_id == workspace_id,
            UAEJournalEntry.company_id.in_(company_ids),
            UAEJournalEntry.source.in_([SOURCE, "opening_balance"]),
        )
        .all()
    ]
    if je_ids:
        db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id.in_(je_ids)).delete(
            synchronize_session=False
        )
        db.query(UAEJournalEntry).filter(UAEJournalEntry.id.in_(je_ids)).delete(synchronize_session=False)

    db.query(UAEPurchaseInvoice).filter(
        UAEPurchaseInvoice.tenant_id == workspace_id,
        UAEPurchaseInvoice.source == SOURCE,
    ).delete(synchronize_session=False)
    db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == workspace_id,
        UAESalesInvoice.notes == SOURCE,
    ).delete(synchronize_session=False)
    db.query(UAEVendor).filter(
        UAEVendor.tenant_id == workspace_id,
        UAEVendor.email.like("%@prabu-demo.ae"),
    ).delete(synchronize_session=False)
    db.query(UAECustomer).filter(
        UAECustomer.tenant_id == workspace_id,
        UAECustomer.email.like("%@prabu-demo.ae"),
    ).delete(synchronize_session=False)

    for cid in company_ids:
        db.query(AccountingPeriod).filter_by(workspace_id=workspace_id, company_id=cid).delete()
    db.commit()


def seed_periods(db: Session, workspace_id: str, company_id: str) -> dict[int, AccountingPeriod]:
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    out: dict[int, AccountingPeriod] = {}
    for i, m in enumerate(DEMO_MONTHS):
        last = monthrange(DEMO_YEAR, m)[1]
        p = AccountingPeriod(
            id=_uid(),
            workspace_id=workspace_id,
            company_id=company_id,
            period_number=i + 1,
            period_name=f"{month_names[m - 1]} {DEMO_YEAR}",
            start_date=date(DEMO_YEAR, m, 1),
            end_date=date(DEMO_YEAR, m, last),
            status="open" if m == 6 else "closed",
        )
        db.add(p)
        out[m] = p
    db.commit()
    return out


def post_je(
    db: Session,
    tenant_id: str,
    company_id: str,
    entry_date: date,
    description: str,
    lines: list[dict],
    source: str = SOURCE,
) -> None:
    create_journal_entry(
        tenant_id=tenant_id,
        entry_date=entry_date,
        description=description,
        lines=lines,
        reference=description[:50],
        source=source,
        company_id=company_id,
        db=db,
        auto_post=True,
    )


def seed_company1(db: Session, ws_id: str, company: UaeCompanyProfile) -> None:
    seed_uae_chart_of_accounts(ws_id, db, company_id=company.id)

    post_je(
        db, ws_id, company.id, date(DEMO_YEAR, 1, 1), "Opening balances",
        [
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 250_000, "credit": 0},
            {"account_code": INVENTORY, "account_name": "Inventories", "debit": 180_000, "credit": 0},
            {"account_code": PPE, "account_name": "PPE Cost", "debit": 320_000, "credit": 0},
            {"account_code": TRADE_PAY, "account_name": "Trade Payables", "debit": 0, "credit": 95_000},
            {"account_code": SHARE_CAP, "account_name": "Share Capital", "debit": 0, "credit": 500_000},
            {"account_code": RETAINED, "account_name": "Retained Earnings", "debit": 0, "credit": 155_000},
        ],
        source="opening_balance",
    )

    for m in DEMO_MONTHS:
        d = date(DEMO_YEAR, m, 15)
        post_je(db, ws_id, company.id, d, f"Sales revenue {m:02d}/{DEMO_YEAR}", [
            {"account_code": TRADE_REC, "account_name": "Trade Receivables", "debit": 180_000, "credit": 0},
            {"account_code": SALES, "account_name": "Sales Revenue", "debit": 0, "credit": 180_000},
        ])
        post_je(db, ws_id, company.id, d, f"COGS {m:02d}/{DEMO_YEAR}", [
            {"account_code": COGS, "account_name": "Cost of Goods Sold", "debit": 108_000, "credit": 0},
            {"account_code": INVENTORY, "account_name": "Inventories", "debit": 0, "credit": 108_000},
        ])
        post_je(db, ws_id, company.id, d, f"Rent {m:02d}/{DEMO_YEAR}", [
            {"account_code": RENT, "account_name": "Office Rent", "debit": 15_000, "credit": 0},
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 15_000},
        ])
        post_je(db, ws_id, company.id, d, f"Salaries {m:02d}/{DEMO_YEAR}", [
            {"account_code": SALARIES, "account_name": "Salaries", "debit": 35_000, "credit": 0},
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 35_000},
        ])
        post_je(db, ws_id, company.id, d, f"Utilities {m:02d}/{DEMO_YEAR}", [
            {"account_code": UTILITIES, "account_name": "Utilities", "debit": 3_000, "credit": 0},
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 3_000},
        ])

    # Intercompany Q1 — Jan
    post_je(db, ws_id, company.id, date(DEMO_YEAR, 1, 20), "Intercompany management fee to Noor Services", [
        {"account_code": PROF_FEES, "account_name": "Professional Fees", "debit": 30_000, "credit": 0},
        {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 30_000},
    ])


def seed_company2(db: Session, ws_id: str, company: UaeCompanyProfile) -> None:
    seed_uae_chart_of_accounts(ws_id, db, company_id=company.id)

    post_je(
        db, ws_id, company.id, date(DEMO_YEAR, 1, 1), "Opening balances",
        [
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 180_000, "credit": 0},
            {"account_code": TRADE_REC, "account_name": "Trade Receivables", "debit": 65_000, "credit": 0},
            {"account_code": PPE, "account_name": "PPE Cost", "debit": 95_000, "credit": 0},
            {"account_code": TRADE_PAY, "account_name": "Trade Payables", "debit": 0, "credit": 25_000},
            {"account_code": SHARE_CAP, "account_name": "Share Capital", "debit": 0, "credit": 300_000},
            {"account_code": RETAINED, "account_name": "Retained Earnings", "debit": 0, "credit": 15_000},
        ],
        source="opening_balance",
    )

    for m in DEMO_MONTHS:
        d = date(DEMO_YEAR, m, 15)
        post_je(db, ws_id, company.id, d, f"Consulting revenue {m:02d}/{DEMO_YEAR}", [
            {"account_code": TRADE_REC, "account_name": "Trade Receivables", "debit": 95_000, "credit": 0},
            {"account_code": SERVICE_REV, "account_name": "Service Revenue", "debit": 0, "credit": 95_000},
        ])
        post_je(db, ws_id, company.id, d, f"Salaries {m:02d}/{DEMO_YEAR}", [
            {"account_code": SALARIES, "account_name": "Salaries", "debit": 45_000, "credit": 0},
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 45_000},
        ])
        post_je(db, ws_id, company.id, d, f"Rent {m:02d}/{DEMO_YEAR}", [
            {"account_code": RENT, "account_name": "Office Rent", "debit": 12_000, "credit": 0},
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 12_000},
        ])
        post_je(db, ws_id, company.id, d, f"Professional fees {m:02d}/{DEMO_YEAR}", [
            {"account_code": PROF_FEES, "account_name": "Professional Fees", "debit": 8_000, "credit": 0},
            {"account_code": CASH, "account_name": "Cash at Bank", "debit": 0, "credit": 8_000},
        ])

    # Intercompany receipt — Jan
    post_je(db, ws_id, company.id, date(DEMO_YEAR, 1, 20), "Intercompany management fee from Al Noor Trading", [
        {"account_code": CASH, "account_name": "Cash at Bank", "debit": 30_000, "credit": 0},
        {"account_code": SERVICE_REV, "account_name": "Service Revenue", "debit": 0, "credit": 30_000},
    ])


def seed_ap_invoices(db: Session, ws_id: str) -> None:
    vendors_spec = [
        ("Gulf Supplies FZE", 45_000, "approved"),
        ("Dubai Logistics LLC", 85_000, "approved"),
        ("Emirates Materials Co", 32_000, "draft"),
        ("Al Fardan Trading", 20_000, "draft"),
    ]
    vendors = []
    for i, (name, _, _) in enumerate(vendors_spec):
        v = UAEVendor(
            id=_uid(),
            tenant_id=ws_id,
            workspace_id=ws_id,
            name=name,
            trn=f"100{100000000 + i:09d}"[:15],
            email=f"vendor{i}@prabu-demo.ae",
        )
        db.add(v)
        vendors.append(v)
    db.flush()

    today = date.today()
    for i, (_, amount, status) in enumerate(vendors_spec):
        inv_date = date(DEMO_YEAR, 4, 1) + timedelta(days=i * 10)
        due = inv_date + timedelta(days=30)
        sub = Decimal(str(amount))
        vat = (sub * Decimal("0.05")).quantize(Decimal("0.01"))
        total = sub + vat
        outstanding = total if status != "approved" else Decimal("0")
        pi = UAEPurchaseInvoice(
            id=_uid(),
            tenant_id=ws_id,
            workspace_id=ws_id,
            invoice_number=f"AP-2025-{i + 1:03d}",
            vendor_id=vendors[i].id,
            invoice_date=inv_date,
            due_date=due,
            subtotal=sub,
            vat_amount=vat,
            total_amount=total,
            outstanding=outstanding if due < today else total,
            status="approved" if status == "approved" else "draft",
            source=SOURCE,
            notes="Prabu demo AP",
        )
        db.add(pi)

    # Overdue invoice
    v = UAEVendor(
        id=_uid(), tenant_id=ws_id, workspace_id=ws_id,
        name="Sharjah Industrial Supplies", trn="100555666777888",
        email="overdue@prabu-demo.ae",
    )
    db.add(v)
    db.flush()
    sub = Decimal("62000")
    vat = (sub * Decimal("0.05")).quantize(Decimal("0.01"))
    total = sub + vat
    db.add(UAEPurchaseInvoice(
        id=_uid(), tenant_id=ws_id, workspace_id=ws_id,
        invoice_number="AP-2025-OVERDUE",
        vendor_id=v.id,
        invoice_date=date(DEMO_YEAR, 2, 1),
        due_date=date(DEMO_YEAR, 2, 28),
        subtotal=sub, vat_amount=vat, total_amount=total, outstanding=total,
        status="approved", source=SOURCE, notes="Overdue demo",
    ))
    db.commit()


def seed_ar_invoices(db: Session, ws_id: str, company_id: str) -> None:
    customers_spec = [
        ("Bin Laden Group", 120_000, "paid"),
        ("Dubai Municipality", 85_000, "paid"),
        ("Emirates NBD", 45_000, "paid"),
        ("Majid Al Futtaim", 60_000, "paid"),
        ("Emaar Properties", 95_000, "sent"),
        ("ADNOC Distribution", 30_000, "sent"),
    ]
    customers = []
    for i, (name, _, _) in enumerate(customers_spec):
        c = UAECustomer(
            id=_uid(), tenant_id=ws_id, name=name,
            trn=f"100{200000000 + i:09d}"[:15],
            email=f"customer{i}@prabu-demo.ae",
            emirate="Dubai",
        )
        db.add(c)
        customers.append(c)
    db.flush()

    for i, (_, amount, status) in enumerate(customers_spec):
        inv_date = date(DEMO_YEAR, 3, 1) + timedelta(days=i * 12)
        due = inv_date + timedelta(days=45)
        sub = Decimal(str(amount))
        vat = (sub * Decimal("0.05")).quantize(Decimal("0.01"))
        total = sub + vat
        paid = total if status == "paid" else Decimal("0")
        out = total - paid
        db.add(UAESalesInvoice(
            id=_uid(), tenant_id=ws_id, company_id=company_id,
            invoice_number=f"INV-2025-{i + 1:04d}",
            customer_id=customers[i].id,
            invoice_date=inv_date, due_date=due,
            period=inv_date.strftime("%Y-%m"),
            subtotal=sub, vat_amount=vat, total_amount=total,
            paid_amount=paid, outstanding=out,
            status=status, notes=SOURCE,
        ))
    db.commit()


def main() -> None:
    ensure_schema()
    db = SessionLocal()
    try:
        ws, _user = resolve_workspace(db)
        ws_id = ws.id
        print(f"Workspace: {ws.name} ({ws_id})")

        c1 = get_or_create_company(db, ws_id, COMPANY_1)
        c2 = get_or_create_company(db, ws_id, COMPANY_2)
        clear_demo_data(db, ws_id, [c1.id, c2.id])

        seed_periods(db, ws_id, c1.id)
        seed_periods(db, ws_id, c2.id)
        seed_company1(db, ws_id, c1)
        seed_company2(db, ws_id, c2)
        seed_ap_invoices(db, ws_id)
        seed_ar_invoices(db, ws_id, c1.id)

        h1_revenue = 180_000 * 6 + 95_000 * 6
        jun_revenue = 180_000 + 95_000
        monthly_opex_c1 = 15_000 + 35_000 + 3_000
        monthly_opex_c2 = 45_000 + 12_000 + 8_000
        jun_net = (
            jun_revenue
            - 108_000 - monthly_opex_c1
            + (95_000 - monthly_opex_c2)
        )

        db.commit()
        print()
        print("Seed complete:")
        print(f"  Company 1: {c1.company_name} — 6 months JEs posted")
        print(f"  Company 2: {c2.company_name} — 6 months JEs posted")
        print(f"  H1 cumulative group revenue: AED {h1_revenue:,}")
        print(f"  Jun 2025 group revenue (consolidation period): AED {jun_revenue:,}")
        print(f"  Jun 2025 approximate group net profit: AED {jun_net:,}")
        print("  Intercompany: Al Noor -> Noor Services AED 30,000 management fee")
        print("    -> Enter AED 30,000 elimination on Operating Expenses or Revenue in Group Consolidation")
        print("  Login: admin@gnanova.com / Admin@123")
        print()
        print("  Demo tip: select Jun 2025 period on /consolidation for monthly group view")
    finally:
        db.close()


if __name__ == "__main__":
    main()
