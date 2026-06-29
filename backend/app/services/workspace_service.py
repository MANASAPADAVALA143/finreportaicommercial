"""Workspace CRUD, dashboard KPIs, and seed data."""

from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.uae_accounting_full import (
    UAEAccount,
    UAEAccrual,
    UAEBankAccount,
    UAEBankStatement,
    UAEBankStatementLine,
    UAECustomer,
    UAEFixedAsset,
    UAEJournalEntry,
    UAEJournalLine,
    UAESalesInvoice,
)
from app.models.users import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole, WorkspaceVATSettings
from app.services.uae_coa_service import seed_uae_chart_of_accounts


def create_workspace(
    db: Session,
    *,
    name: str,
    legal_entity_name: str,
    trn_number: str | None,
    country: str,
    currency: str,
    fiscal_year_start_month: int,
    fiscal_year_end_month: int,
    industry: str | None,
    owner_user_id: str,
) -> Workspace:
    ws = Workspace(
        id=str(uuid.uuid4()),
        name=name,
        legal_entity_name=legal_entity_name,
        trn_number=trn_number,
        country=country,
        currency=currency,
        fiscal_year_start_month=fiscal_year_start_month,
        fiscal_year_end_month=fiscal_year_end_month,
        industry=industry,
    )
    db.add(ws)
    db.flush()

    db.add(WorkspaceMember(
        id=str(uuid.uuid4()),
        workspace_id=ws.id,
        user_id=owner_user_id,
        role=WorkspaceRole.owner,
    ))

    db.add(WorkspaceVATSettings(
        id=str(uuid.uuid4()),
        workspace_id=ws.id,
        entity_type="mainland",
        vat_registered=True,
        standard_rate="5",
        filing_frequency="quarterly",
    ))

    seed_uae_chart_of_accounts(ws.id, db)
    db.commit()
    db.refresh(ws)
    return ws


def list_user_workspaces(db: Session, user_id: str, is_super_admin: bool = False) -> list[dict[str, Any]]:
    if is_super_admin:
        rows = db.query(Workspace).filter(Workspace.is_active == True).order_by(Workspace.name).all()  # noqa: E712
        return [_ws_dict(ws, WorkspaceRole.owner) for ws in rows]

    members = (
        db.query(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .filter(WorkspaceMember.user_id == user_id, Workspace.is_active == True)  # noqa: E712
        .order_by(Workspace.name)
        .all()
    )
    return [_ws_dict(ws, m.role) for m, ws in members]


def _ws_dict(ws: Workspace, role: WorkspaceRole | None) -> dict[str, Any]:
    return {
        "id": ws.id,
        "name": ws.name,
        "legal_entity_name": ws.legal_entity_name,
        "trn_number": ws.trn_number,
        "country": ws.country,
        "currency": ws.currency,
        "fiscal_year_start_month": ws.fiscal_year_start_month,
        "fiscal_year_end_month": ws.fiscal_year_end_month,
        "industry": ws.industry,
        "role": role.value if role else None,
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
    }


def get_workspace_dashboard(db: Session, workspace_id: str) -> dict[str, Any]:
    tid = workspace_id

    def _sum_balances(account_types: list[str], side: str) -> float:
        accounts = (
            db.query(UAEAccount)
            .filter(UAEAccount.tenant_id == tid, UAEAccount.account_type.in_(account_types))
            .all()
        )
        codes = {a.code for a in accounts}
        if not codes:
            return 0.0
        lines = (
            db.query(
                func.coalesce(func.sum(UAEJournalLine.debit), 0),
                func.coalesce(func.sum(UAEJournalLine.credit), 0),
            )
            .join(UAEJournalEntry, UAEJournalEntry.id == UAEJournalLine.journal_entry_id)
            .filter(
                UAEJournalEntry.tenant_id == tid,
                UAEJournalEntry.status == "posted",
                UAEJournalLine.account_code.in_(codes),
            )
            .first()
        )
        debit, credit = float(lines[0] or 0), float(lines[1] or 0)
        return debit - credit if side == "debit" else credit - debit

    revenue = _sum_balances(["Income"], "credit")
    expenses = _sum_balances(["Expense"], "debit")
    assets = _sum_balances(["Asset"], "debit")
    liabilities = _sum_balances(["Liability"], "credit")

    cash_accounts = (
        db.query(UAEAccount.code)
        .filter(UAEAccount.tenant_id == tid, UAEAccount.name.ilike("%cash%bank%"))
        .all()
    )
    cash_codes = [r[0] for r in cash_accounts] or ["1001", "1002", "1003", "1004"]
    cash_row = (
        db.query(
            func.coalesce(func.sum(UAEJournalLine.debit), 0) - func.coalesce(func.sum(UAEJournalLine.credit), 0)
        )
        .join(UAEJournalEntry, UAEJournalEntry.id == UAEJournalLine.journal_entry_id)
        .filter(
            UAEJournalEntry.tenant_id == tid,
            UAEJournalEntry.status == "posted",
            UAEJournalLine.account_code.in_(cash_codes),
        )
        .scalar()
    )
    cash_balance = float(cash_row or 0)

    open_ar = (
        db.query(func.coalesce(func.sum(UAESalesInvoice.outstanding), 0))
        .filter(UAESalesInvoice.tenant_id == tid, UAESalesInvoice.status.in_(["sent", "partial", "overdue"]))
        .scalar()
    )

    try:
        from app.models.uae_ap import UAEPurchaseInvoice
        open_ap = (
            db.query(func.coalesce(func.sum(UAEPurchaseInvoice.outstanding), 0))
            .filter(UAEPurchaseInvoice.tenant_id == tid, UAEPurchaseInvoice.status.in_(["approved", "posted", "partial"]))
            .scalar()
        )
    except Exception:
        open_ap = 0

    vat_payable_row = (
        db.query(
            func.coalesce(func.sum(UAEJournalLine.credit), 0) - func.coalesce(func.sum(UAEJournalLine.debit), 0)
        )
        .join(UAEJournalEntry, UAEJournalEntry.id == UAEJournalLine.journal_entry_id)
        .filter(
            UAEJournalEntry.tenant_id == tid,
            UAEJournalEntry.status == "posted",
            UAEJournalLine.account_code == "3010",
        )
        .scalar()
    )

    return {
        "workspace_id": workspace_id,
        "revenue": round(revenue, 2),
        "expenses": round(expenses, 2),
        "profit": round(revenue - expenses, 2),
        "cash_balance": round(cash_balance, 2),
        "open_ap": round(float(open_ap or 0), 2),
        "open_ar": round(float(open_ar or 0), 2),
        "vat_payable": round(float(vat_payable_row or 0), 2),
        "assets": round(assets, 2),
        "liabilities": round(liabilities, 2),
        "journal_count": db.query(UAEJournalEntry).filter_by(tenant_id=tid).count(),
        "customer_count": db.query(UAECustomer).filter_by(tenant_id=tid).count(),
        "fixed_asset_count": db.query(UAEFixedAsset).filter_by(tenant_id=tid).count(),
    }


def add_workspace_member(
    db: Session,
    workspace_id: str,
    user_id: str,
    role: WorkspaceRole,
) -> WorkspaceMember:
    existing = db.query(WorkspaceMember).filter_by(workspace_id=workspace_id, user_id=user_id).first()
    if existing:
        existing.role = role
        db.commit()
        db.refresh(existing)
        return existing
    m = WorkspaceMember(
        id=str(uuid.uuid4()),
        workspace_id=workspace_id,
        user_id=user_id,
        role=role,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def seed_abc_trading_workspace(db: Session, owner_user: User) -> Workspace:
    """Seed ABC Trading LLC with demo accounting data."""
    existing = db.query(Workspace).filter(Workspace.name == "ABC Trading LLC").first()
    if existing:
        return existing

    ws = create_workspace(
        db,
        name="ABC Trading LLC",
        legal_entity_name="ABC Trading LLC",
        trn_number="100123456700003",
        country="UAE",
        currency="AED",
        fiscal_year_start_month=1,
        fiscal_year_end_month=12,
        industry="Trading",
        owner_user_id=owner_user.id,
    )
    tid = ws.id

    from app.models.uae_ap import UAEPurchaseInvoice, UAEPurchaseInvoiceLine, UAEVendor

    vendors = []
    vendor_names = [
        "Emirates Office Supplies", "Dubai Logistics Co", "Gulf IT Solutions",
        "Al Futtaim Motors Parts", "Sharjah Steel Trading", "RAK Cement Suppliers",
        "Abu Dhabi Catering", "JAFZA Freight Forwarders", "DEWA Utilities",
        "Etisalat Business", "Noon Marketplace", "Amazon UAE",
        "Carrefour Wholesale", "Lulu Hypermarket B2B", "ADNOC Distribution",
        "Transguard Security", "Emaar Facilities", "DHL Express UAE",
        "FedEx Middle East", "Aramex Corporate",
    ]
    for i, vname in enumerate(vendor_names):
        v = UAEVendor(
            id=str(uuid.uuid4()),
            tenant_id=tid,
            name=vname,
            trn=f"100{random.randint(100000000, 999999999):09d}"[:15],
            email=f"accounts{i+1}@vendor{i+1}.ae",
            payment_terms_days=30,
        )
        db.add(v)
        vendors.append(v)
    db.flush()

    customers = []
    customer_names = [
        "Dubai Retail Group", "Sharjah Construction", "Abu Dhabi Hotels",
        "RAK Manufacturing", "Ajman Trading House", "Fujairah Exports",
        "JLT Tech Park", "DIFC Financial Services", "Mall of Emirates Tenant",
        "Dubai Marina Residences",
    ]
    for cname in customer_names:
        c = UAECustomer(
            id=str(uuid.uuid4()),
            tenant_id=tid,
            name=cname,
            trn=f"100{random.randint(100000000, 999999999):09d}"[:15],
            emirate="Dubai",
        )
        db.add(c)
        customers.append(c)
    db.flush()

    base_date = date.today() - timedelta(days=180)
    je_count = 0

    for i in range(200):
        entry_date = base_date + timedelta(days=random.randint(0, 180))
        period = entry_date.strftime("%Y-%m")
        je = UAEJournalEntry(
            id=str(uuid.uuid4()),
            tenant_id=tid,
            entry_number=f"JE-{entry_date.year}-{i+1:04d}",
            entry_date=entry_date,
            period=period,
            description=f"Auto-seed journal entry {i+1}",
            source="seed",
            status="posted",
            posted_at=datetime.utcnow(),
        )
        db.add(je)
        amount = Decimal(str(random.randint(500, 50000)))
        db.add(UAEJournalLine(
            id=str(uuid.uuid4()),
            journal_entry_id=je.id,
            account_code="7101",
            account_name="Salaries & Wages",
            debit=amount,
            credit=0,
        ))
        db.add(UAEJournalLine(
            id=str(uuid.uuid4()),
            journal_entry_id=je.id,
            account_code="1002",
            account_name="Cash at Bank - ENBD",
            debit=0,
            credit=amount,
        ))
        je_count += 1

    for i in range(50):
        inv_date = base_date + timedelta(days=random.randint(0, 150))
        vendor = random.choice(vendors)
        subtotal = Decimal(str(random.randint(1000, 80000)))
        vat = (subtotal * Decimal("0.05")).quantize(Decimal("0.01"))
        total = subtotal + vat
        pi = UAEPurchaseInvoice(
            id=str(uuid.uuid4()),
            tenant_id=tid,
            invoice_number=f"PINV-{inv_date.year}-{i+1:04d}",
            vendor_id=vendor.id,
            invoice_date=inv_date,
            due_date=inv_date + timedelta(days=30),
            subtotal=subtotal,
            vat_amount=vat,
            total_amount=total,
            outstanding=total if random.random() > 0.3 else Decimal("0"),
            status=random.choice(["posted", "approved", "paid"]),
            workspace_id=tid,
        )
        db.add(pi)
        db.add(UAEPurchaseInvoiceLine(
            id=str(uuid.uuid4()),
            invoice_id=pi.id,
            description=f"Purchase from {vendor.name}",
            quantity=1,
            unit_price=subtotal,
            line_total=subtotal,
            vat_rate=Decimal("5"),
            vat_amount=vat,
        ))

    for i in range(25):
        inv_date = base_date + timedelta(days=random.randint(0, 150))
        customer = random.choice(customers)
        subtotal = Decimal(str(random.randint(5000, 120000)))
        vat = (subtotal * Decimal("0.05")).quantize(Decimal("0.01"))
        total = subtotal + vat
        si = UAESalesInvoice(
            id=str(uuid.uuid4()),
            tenant_id=tid,
            invoice_number=f"INV-{inv_date.year}-{i+1:04d}",
            customer_id=customer.id,
            invoice_date=inv_date,
            due_date=inv_date + timedelta(days=30),
            period=inv_date.strftime("%Y-%m"),
            subtotal=subtotal,
            vat_amount=vat,
            total_amount=total,
            outstanding=total if random.random() > 0.4 else Decimal("0"),
            status=random.choice(["sent", "paid", "partial"]),
            seller_trn=ws.trn_number,
        )
        db.add(si)

    asset_categories = ["Computer", "Vehicle", "Furniture", "Machinery", "Building"]
    for i in range(20):
        cost = Decimal(str(random.randint(5000, 200000)))
        fa = UAEFixedAsset(
            id=str(uuid.uuid4()),
            tenant_id=tid,
            asset_code=f"FA-{date.today().year}-{i+1:03d}",
            name=f"{random.choice(asset_categories)} Asset {i+1}",
            category=random.choice(asset_categories),
            purchase_date=base_date + timedelta(days=random.randint(0, 365)),
            purchase_cost=cost,
            net_book_value=cost * Decimal("0.8"),
            status="active",
        )
        db.add(fa)

    bank = UAEBankAccount(
        id=str(uuid.uuid4()),
        tenant_id=tid,
        bank_name="ENBD",
        account_number="1234567890",
        iban="AE070331234567890123456",
        currency="AED",
    )
    db.add(bank)
    db.flush()

    stmt = UAEBankStatement(
        id=str(uuid.uuid4()),
        tenant_id=tid,
        bank_account_id=bank.id,
        statement_date=date.today(),
        opening_balance=Decimal("500000"),
        closing_balance=Decimal("620000"),
        status="reconciled",
    )
    db.add(stmt)
    db.flush()

    for i in range(100):
        tx_date = base_date + timedelta(days=random.randint(0, 180))
        is_credit = random.random() > 0.45
        amt = Decimal(str(random.randint(100, 25000)))
        db.add(UAEBankStatementLine(
            id=str(uuid.uuid4()),
            statement_id=stmt.id,
            transaction_date=tx_date,
            description=f"Bank transaction {i+1}",
            debit=0 if is_credit else amt,
            credit=amt if is_credit else 0,
            match_status="matched" if random.random() > 0.2 else "unmatched",
        ))

    db.commit()
    db.refresh(ws)
    return ws
