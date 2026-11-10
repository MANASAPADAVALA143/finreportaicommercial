"""Clearly labelled synthetic demo company for the AI CFO and month-end close flows.

Creates (or rebuilds) one company named "... (synthetic data)" inside the caller's
workspace with seven months of posted, balanced journals, customer invoices and receipts,
an Emirates NBD bank account with monthly statements, and an FP&A budget. Every figure is
deterministic. The last month contains planted items for the agents to find:

- AI CFO: a one-off consulting spike, a utility bill posted twice, travel over budget.
- Close: SWIFT charges and bank interest not yet in the ledger, an unidentified deposit,
  an uncleared cheque, and a customer more than 90 days overdue.

Real companies are never touched: rebuilding deletes only rows of the demo company.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoFinding, AiCfoInvestigation, AiCfoToolCall
from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.models.client_data import ApCompany
from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.fpa_master import FpaMasterRow
from app.models.uae_accounting_full import (
    UAEAccount,
    UAEBankAccount,
    UAEBankStatement,
    UAEBankStatementLine,
    UAECustomer,
    UAEJournalEntry,
    UAEJournalLine,
    UAESalesInvoice,
)
from app.services.ai_cfo.ledger import period_add
from app.services.ai_close.context import period_bounds
from app.services.uae_coa_service import seed_uae_chart_of_accounts

DEMO_NAME = "Gnanova Demo Trading LLC (synthetic data)"
DEMO_SLUG = "gnanova-ai-cfo-demo"
DEMO_SOURCE = "ai_cfo_demo"
DEMO_UPLOAD_ID = "ai-cfo-demo"
BANK = ("1002", "Cash at Bank - ENBD")
AR = ("1100", "Trade Receivables")
SERVICE_REVENUE = ("6010", "Service Revenue")
CARD_SALES = ("6001", "Sales - Standard Rated (5% VAT)")

# account, name, monthly base amount, description (paid from the bank in the month)
EXPENSES = [
    ("7001", "Cost of Goods Sold", 150000, "Direct costs of services delivered"),
    ("7101", "Salaries & Wages", 110000, "Monthly payroll"),
    ("7110", "Office Rent", 35000, "Office rent - Business Bay"),
    ("7120", "Utilities", 6200, "DEWA electricity and water bill"),
    ("7130", "Marketing & Advertising", 14000, "Digital marketing retainer"),
    ("7140", "Professional Fees", 9500, "Monthly bookkeeping and payroll retainer"),
    ("7150", "Travel & Entertainment", 7000, "Client travel"),
    ("7160", "Bank Charges", 900, "Bank charges"),
]
MONTHLY_SERVICE_REVENUE = 420000
INVOICE_SPLIT = (0.45, 0.35, 0.20)
# name, days paid after the due date (None = has stopped paying)
CUSTOMERS = [
    ("Emirates Retail Group LLC (demo)", 0),
    ("Gulf Logistics FZE (demo)", 5),
    ("Al Marina Hospitality LLC (demo)", 15),
    ("Desert Bloom Trading (demo)", 40),
    ("Northgate Contracting LLC (demo)", None),
]
STOPPED_PAYING_FROM = 2  # month index from which the last customer no longer pays
CARD_SETTLEMENTS_PER_MONTH = 40
VARIATION = [0.97, 1.02, 0.99, 1.03, 0.98, 1.01]
BUDGET_MULTIPLIER = 1.05


def _months(today: date) -> list[str]:
    last = period_add(f"{today.year:04d}-{today.month:02d}", -1)
    return [period_add(last, -i) for i in range(6, -1, -1)]


def _entry(tenant: str, company: str, number: str, day: date, description: str,
           debit: tuple[str, str], credit: tuple[str, str], amount: float, reference: str) -> UAEJournalEntry:
    amount = round(amount, 2)
    entry = UAEJournalEntry(
        tenant_id=tenant, company_id=company, entry_number=number, entry_date=day,
        period=f"{day.year:04d}-{day.month:02d}", description=description, reference=reference,
        source=DEMO_SOURCE, status="posted", posted_at=datetime.utcnow(),
    )
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
    for model in (AiCfoApprovalRequest, AiCfoInvestigation, AiCfoFinding,
                  AiCloseJournalProposal, AiCloseException, AiCloseTask, AiCloseRun):
        db.query(model).filter(model.workspace_id == tenant, model.company_id == company_id).delete(synchronize_session=False)

    account_ids = [a for (a,) in db.query(UAEBankAccount.id).filter(
        UAEBankAccount.tenant_id == tenant, UAEBankAccount.company_id == company_id)]
    if account_ids:
        stmt_ids = [s for (s,) in db.query(UAEBankStatement.id).filter(UAEBankStatement.bank_account_id.in_(account_ids))]
        if stmt_ids:
            db.query(UAEBankStatementLine).filter(UAEBankStatementLine.statement_id.in_(stmt_ids)).delete(synchronize_session=False)
            db.query(UAEBankStatement).filter(UAEBankStatement.id.in_(stmt_ids)).delete(synchronize_session=False)
        db.query(UAEBankAccount).filter(UAEBankAccount.id.in_(account_ids)).delete(synchronize_session=False)

    invoices = db.query(UAESalesInvoice.id, UAESalesInvoice.customer_id).filter(
        UAESalesInvoice.tenant_id == tenant, UAESalesInvoice.company_id == company_id).all()
    customer_ids = {c for _, c in invoices if c}
    if invoices:
        db.query(UAESalesInvoice).filter(UAESalesInvoice.id.in_([i for i, _ in invoices])).delete(synchronize_session=False)
    if customer_ids:
        db.query(UAECustomer).filter(UAECustomer.id.in_(customer_ids), UAECustomer.tenant_id == tenant).delete(synchronize_session=False)

    entry_ids = [e for (e,) in db.query(UAEJournalEntry.id).filter(
        UAEJournalEntry.tenant_id == tenant, UAEJournalEntry.company_id == company_id)]
    if entry_ids:
        db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id.in_(entry_ids)).delete(synchronize_session=False)
        db.query(UAEJournalEntry).filter(UAEJournalEntry.id.in_(entry_ids)).delete(synchronize_session=False)
    db.query(AccountingPeriod).filter(
        AccountingPeriod.workspace_id == tenant, AccountingPeriod.company_id == company_id).delete(synchronize_session=False)
    db.query(FpaMasterRow).filter(FpaMasterRow.company_id == company_id).delete(synchronize_session=False)


def _card_amount(idx: int, k: int) -> float:
    return round(1800 + ((idx * 7 + k * 13) % 17) * 95.5, 2)


def seed_demo_company(db: Session, workspace_id: str, today: date | None = None,
                      card_settlements: int = CARD_SETTLEMENTS_PER_MONTH) -> dict[str, Any]:
    """`card_settlements` sets the monthly number of card-terminal settlements; their amounts scale so
    monthly card revenue stays the same at any volume."""
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
    db.flush()
    seed_uae_chart_of_accounts(workspace_id, db, company_id=profile.id)
    cid = profile.id

    months = _months(today)
    last_end = period_bounds(months[-1])[1]
    entries: list[UAEJournalEntry] = []
    bank_events: list[tuple[date, str, str, float]] = []  # date, description, reference, amount (+ in, - out)

    def post(number, day, desc, debit, credit, amount, reference, bank_amount=None):
        entries.append(_entry(workspace_id, cid, number, day, desc, debit, credit, amount, reference))
        if bank_amount is not None:
            bank_events.append((day, desc, reference, round(bank_amount, 2)))

    customers = [UAECustomer(tenant_id=workspace_id, name=name, currency="AED", payment_terms_days=30) for name, _ in CUSTOMERS]
    db.add_all(customers)
    db.flush()
    invoices: list[UAESalesInvoice] = []

    for idx, period in enumerate(months):
        factor = VARIATION[idx % len(VARIATION)]
        start, _ = period_bounds(period)
        for n, (code, name, base, desc) in enumerate(EXPENSES, start=2):
            day = start + timedelta(days=9 + n)
            ref = f"DEMO-{period}-{n:02d}"
            post(f"DEMO-JE-{period}-{n:02d}", day, desc, (code, name), BANK, base * factor, ref, -round(base * factor, 2))

        for k, share in enumerate(INVOICE_SPLIT):
            cust_idx = (idx + k) % len(CUSTOMERS)
            amount = round(MONTHLY_SERVICE_REVENUE * factor * share, 2)
            inv_date = start + timedelta(days=4)
            due = inv_date + timedelta(days=30)
            number = f"DEMO-INV-{period}-{k + 1}"
            delay = CUSTOMERS[cust_idx][1]
            if cust_idx == len(CUSTOMERS) - 1 and idx < STOPPED_PAYING_FROM:
                delay = 20
            paid_on = due + timedelta(days=delay) if delay is not None else None
            paid = paid_on is not None and paid_on <= last_end
            post(f"DEMO-SI-{period}-{k + 1}", inv_date, f"Invoice {number}", AR, SERVICE_REVENUE, amount, number)
            invoices.append(UAESalesInvoice(
                tenant_id=workspace_id, company_id=cid, invoice_number=number, customer_id=customers[cust_idx].id,
                invoice_date=inv_date, due_date=due, period=period, subtotal=amount, vat_amount=0, total_amount=amount,
                paid_amount=amount if paid else 0, outstanding=0 if paid else amount, status="paid" if paid else "sent",
                paid_date=paid_on if paid else None, notes="Synthetic demo invoice",
            ))
            if paid:
                post(f"DEMO-RC-{number[9:]}", paid_on, f"Receipt {number}", BANK, AR, amount, number, amount)

        for k in range(card_settlements):
            day = start + timedelta(days=k % 28)
            amount = round(_card_amount(idx, k) * CARD_SETTLEMENTS_PER_MONTH / card_settlements, 2)
            ref = f"POS-{period}-{k + 1:03d}"
            post(f"DEMO-POS-{period}-{k + 1:03d}", day, "Card terminal settlement", BANK, CARD_SALES, amount, ref, amount)

        if period == months[-1]:
            post(f"DEMO-JE-{period}-20", start + timedelta(days=17),
                 "Strategy consulting - Meridian Advisory (one-off market entry study)",
                 ("7140", "Professional Fees"), BANK, 68000, "MER-INV-2207")  # cheque not yet cleared
            post(f"DEMO-JE-{period}-21", start + timedelta(days=21), EXPENSES[3][3],
                 ("7120", "Utilities"), BANK, round(6200 * factor, 2), f"DEMO-{period}-21")  # posted twice
            post(f"DEMO-JE-{period}-22", start + timedelta(days=24), "Client workshop travel - Riyadh delegation",
                 ("7150", "Travel & Entertainment"), BANK, 16500, "TRV-0925", -16500)
            bank_events += [
                (start + timedelta(days=26), "SWIFT transfer charges", "FT-CHG-1029", -450.0),
                (start + timedelta(days=27), "Profit credit on call account", "INT-1030", 1250.0),
                (start + timedelta(days=28), "Cash deposit - unidentified", "DEP-77812", 8750.0),
            ]

    db.add_all(entries)
    db.add_all(invoices)

    bank_gl = db.query(UAEAccount).filter(
        UAEAccount.tenant_id == workspace_id, UAEAccount.company_id == cid, UAEAccount.code == BANK[0]).first()
    account = UAEBankAccount(
        tenant_id=workspace_id, company_id=cid, bank_name="Emirates NBD", account_number="1015-DEMO-0001",
        iban="AE07 0260 0010 1500 0000 001", currency="AED", gl_account_id=bank_gl.id if bank_gl else None,
    )
    db.add(account)
    db.flush()
    balance = 0.0
    statement_lines = 0
    for period in months:
        start, end = period_bounds(period)
        events = sorted((e for e in bank_events if start <= e[0] <= end), key=lambda e: (e[0], e[2]))
        opening = round(balance, 2)
        stmt = UAEBankStatement(tenant_id=workspace_id, bank_account_id=account.id, statement_date=end,
                                opening_balance=opening, status="pending")
        db.add(stmt)
        db.flush()
        for day, desc, ref, amount in events:
            balance = round(balance + amount, 2)
            db.add(UAEBankStatementLine(
                statement_id=stmt.id, transaction_date=day, value_date=day, description=desc, reference=ref,
                debit=max(-amount, 0), credit=max(amount, 0), balance=balance, match_status="unmatched",
            ))
            statement_lines += 1
        stmt.closing_balance = round(balance, 2)

    years = sorted({p[:4] for p in months})
    budget_rows = 0
    for year in years:
        for code, name, base, _ in EXPENSES:
            db.add(FpaMasterRow(
                upload_id=DEMO_UPLOAD_ID, section="PL", currency="AED", fiscal_year=f"FY{year}",
                account_code=code, account_name=name, account_type="expense",
                monthly_actuals=json.dumps([0.0] * 12),
                monthly_budgets=json.dumps([round(base * BUDGET_MULTIPLIER, 2)] * 12),
                company_id=cid, notes="Synthetic demo budget",
            ))
            budget_rows += 1
    db.commit()
    return {
        "company_id": cid, "company_name": DEMO_NAME, "periods": months,
        "journal_entries": len(entries), "sales_invoices": len(invoices), "bank_statement_lines": statement_lines,
        "budget_rows": budget_rows,
        "planted_anomalies": [
            "Professional Fees spike: one-off Meridian Advisory study, paid by a cheque not yet cleared",
            "Utilities: the DEWA bill posted twice in the last month",
            "Travel & Entertainment over budget in the last month",
            "Bank: SWIFT charges and interest credited not yet in the ledger, plus an unidentified deposit",
            "Receivables: Northgate Contracting has stopped paying (90+ days overdue)",
        ],
    }
