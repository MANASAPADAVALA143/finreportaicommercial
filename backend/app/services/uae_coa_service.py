"""UAE Chart of Accounts — seed + GL balance helpers."""
from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.uae_accounting_full import UAEAccount, UAEJournalLine

UAE_COA = [
    # ASSETS
    {"code":"1000","name":"CURRENT ASSETS","type":"Asset","sub":"Header","vat":False},
    {"code":"1001","name":"Cash in Hand - AED","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1002","name":"Cash at Bank - ENBD","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1003","name":"Cash at Bank - FAB","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1004","name":"Cash at Bank - ADCB","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1100","name":"Trade Receivables","type":"Asset","sub":"Current Asset","vat":True,"vr":5},
    {"code":"1101","name":"Allowance for Doubtful Debts","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1110","name":"VAT Recoverable (Input Tax)","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1120","name":"Prepayments","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1130","name":"Other Receivables","type":"Asset","sub":"Current Asset","vat":False},
    {"code":"1200","name":"Inventories","type":"Asset","sub":"Current Asset","vat":True,"vr":5},
    {"code":"2000","name":"NON-CURRENT ASSETS","type":"Asset","sub":"Header","vat":False},
    {"code":"2001","name":"Property Plant & Equipment - Cost","type":"Asset","sub":"Fixed Asset","vat":True,"vr":5},
    {"code":"2002","name":"Accumulated Depreciation - PPE","type":"Asset","sub":"Fixed Asset","vat":False},
    {"code":"2010","name":"Right-of-Use Asset (IFRS 16)","type":"Asset","sub":"Fixed Asset","vat":False},
    {"code":"2011","name":"Accumulated Depreciation - ROU","type":"Asset","sub":"Fixed Asset","vat":False},
    {"code":"2020","name":"Intangible Assets - Cost","type":"Asset","sub":"Fixed Asset","vat":False},
    {"code":"2030","name":"Security Deposits","type":"Asset","sub":"Fixed Asset","vat":False},
    # LIABILITIES
    {"code":"3000","name":"CURRENT LIABILITIES","type":"Liability","sub":"Header","vat":False},
    {"code":"3001","name":"Trade Payables","type":"Liability","sub":"Current Liability","vat":True,"vr":5},
    {"code":"3010","name":"VAT Payable (Output Tax)","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"3011","name":"Corporate Tax Payable","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"3020","name":"Accrued Expenses","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"3021","name":"Accrued Salaries","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"3022","name":"Accrued Rent","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"3030","name":"Lease Liability - Current (IFRS 16)","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"3040","name":"Customer Deposits","type":"Liability","sub":"Current Liability","vat":False},
    {"code":"4000","name":"NON-CURRENT LIABILITIES","type":"Liability","sub":"Header","vat":False},
    {"code":"4001","name":"Lease Liability - Non-Current (IFRS 16)","type":"Liability","sub":"Non-Current Liability","vat":False},
    {"code":"4010","name":"End of Service Benefits (EOSB)","type":"Liability","sub":"Non-Current Liability","vat":False},
    {"code":"4020","name":"Bank Loans - Long Term","type":"Liability","sub":"Non-Current Liability","vat":False},
    # EQUITY
    {"code":"5000","name":"EQUITY","type":"Equity","sub":"Header","vat":False},
    {"code":"5001","name":"Share Capital","type":"Equity","sub":"Equity","vat":False},
    {"code":"5010","name":"Retained Earnings","type":"Equity","sub":"Equity","vat":False},
    {"code":"5020","name":"Current Year Profit/Loss","type":"Equity","sub":"Equity","vat":False},
    # INCOME
    {"code":"6000","name":"REVENUE","type":"Income","sub":"Header","vat":False},
    {"code":"6001","name":"Sales - Standard Rated (5% VAT)","type":"Income","sub":"Revenue","vat":True,"vr":5},
    {"code":"6002","name":"Sales - Zero Rated","type":"Income","sub":"Revenue","vat":True,"vr":0},
    {"code":"6003","name":"Sales - Exempt","type":"Income","sub":"Revenue","vat":False},
    {"code":"6010","name":"Service Revenue","type":"Income","sub":"Revenue","vat":True,"vr":5},
    {"code":"6020","name":"Other Income","type":"Income","sub":"Other Income","vat":False},
    {"code":"6021","name":"Interest Income","type":"Income","sub":"Other Income","vat":False},
    # EXPENSES
    {"code":"7000","name":"COST OF SALES","type":"Expense","sub":"Header","vat":False},
    {"code":"7001","name":"Cost of Goods Sold","type":"Expense","sub":"COGS","vat":True,"vr":5},
    {"code":"7002","name":"Direct Labour","type":"Expense","sub":"COGS","vat":False},
    {"code":"7100","name":"OPERATING EXPENSES","type":"Expense","sub":"Header","vat":False},
    {"code":"7101","name":"Salaries & Wages","type":"Expense","sub":"Staff Cost","vat":False},
    {"code":"7102","name":"End of Service Benefits","type":"Expense","sub":"Staff Cost","vat":False},
    {"code":"7103","name":"Air Ticket Allowance","type":"Expense","sub":"Staff Cost","vat":False},
    {"code":"7110","name":"Office Rent","type":"Expense","sub":"Occupancy","vat":True,"vr":5},
    {"code":"7111","name":"Depreciation - PPE","type":"Expense","sub":"Depreciation","vat":False},
    {"code":"7112","name":"Depreciation - ROU Asset","type":"Expense","sub":"Depreciation","vat":False},
    {"code":"7120","name":"Utilities","type":"Expense","sub":"Occupancy","vat":True,"vr":5},
    {"code":"7130","name":"Marketing & Advertising","type":"Expense","sub":"Sales","vat":True,"vr":5},
    {"code":"7140","name":"Professional Fees","type":"Expense","sub":"Admin","vat":True,"vr":5},
    {"code":"7141","name":"Audit Fees","type":"Expense","sub":"Admin","vat":True,"vr":5},
    {"code":"7150","name":"Travel & Entertainment","type":"Expense","sub":"Admin","vat":True,"vr":5},
    {"code":"7160","name":"Bank Charges","type":"Expense","sub":"Finance","vat":False},
    {"code":"7170","name":"Interest Expense (IFRS 16)","type":"Expense","sub":"Finance","vat":False},
    {"code":"7200","name":"Corporate Tax Expense","type":"Expense","sub":"Tax","vat":False},
    {"code":"7210","name":"Fines & Penalties","type":"Expense","sub":"Other","vat":False},
]


def seed_uae_chart_of_accounts(tenant_id: str, db: Session) -> int:
    """Seed UAE-standard 62-account CoA. Safe to call multiple times (idempotent)."""
    existing = {
        a.code
        for a in db.query(UAEAccount.code)
        .filter(UAEAccount.tenant_id == tenant_id)
        .all()
    }
    added = 0
    for row in UAE_COA:
        if row["code"] in existing:
            continue
        acct = UAEAccount(
            tenant_id=tenant_id,
            code=row["code"],
            name=row["name"],
            account_type=row["type"],
            sub_type=row["sub"],
            is_vat_applicable=row.get("vat", False),
            vat_rate=row.get("vr", 0),
        )
        db.add(acct)
        added += 1
    db.commit()
    return added


def get_account_balances(tenant_id: str, period: str, db: Session) -> dict[str, float]:
    """
    Return {account_code: net_balance} for all posted JE lines in the period.
    Assets/Expenses = debit normal; Liabilities/Equity/Income = credit normal.
    """
    from app.models.uae_accounting_full import UAEJournalEntry
    rows = (
        db.query(UAEJournalLine)
        .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
        .filter(
            UAEJournalEntry.tenant_id == tenant_id,
            UAEJournalEntry.period == period,
            UAEJournalEntry.status == "posted",
        )
        .all()
    )
    balances: dict[str, float] = {}
    for line in rows:
        code = line.account_code or ""
        balances[code] = balances.get(code, 0.0) + float(line.debit or 0) - float(line.credit or 0)
    return balances
