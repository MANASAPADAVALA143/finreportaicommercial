"""Synthetic demo group for the month-end close: the AI CFO demo company as parent plus two
subsidiaries, all labelled "(synthetic data)", and AP InvoiceFlow data for the group.

Every figure is deterministic; the real agents find the planted items:
- Parent AP (Supabase, tagged to the demo company only): a price mismatch, a re-keyed
  duplicate of it, a same-amount possible duplicate, an invoice before goods receipt, a large
  invoice without PO, a vendor that differs from its PO, and an HVAC repair received but
  not invoiced (accrual of Repairs & Maintenance 50,000).
- Services FZ-LLC: office lease whose October depreciation and interest are not recorded;
  salaries without end-of-service accrual.
- Logistics LLC: October rent not recorded; the October intercompany management fee booked
  at 24,000 against 25,000 charged by Services.

Rebuilding deletes only the demo companies' own rows (ledger, bank, invoices, leases, close
runs, and their AP rows in Supabase).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoFinding, AiCfoInvestigation
from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.models.client_data import ApCompany
from app.models.company_setup import UaeCompanyProfile
from app.models.fpa_master import FpaMasterRow
from app.models.ifrs16_lease import IFRS16Lease
from app.models.uae_accounting_full import (
    UAEAccount, UAEBankAccount, UAEBankStatement, UAEBankStatementLine, UAECustomer, UAESalesInvoice,
)
from app.services.ai_cfo import demo as parent_demo
from app.services.ai_cfo.demo import _entry
from app.services.ai_close.context import period_bounds
from app.services.uae_coa_service import seed_uae_chart_of_accounts

logger = logging.getLogger(__name__)

EXTRA_ACCOUNTS = [("7180", "Repairs & Maintenance", "Expense", "Admin"),
                  ("7190", "Impairment Loss on Trade Receivables", "Expense", "Other")]
BANK = ("1002", "Cash at Bank - ENBD")
AR = ("1100", "Trade Receivables")
SERVICE_REVENUE = ("6010", "Service Revenue")
IC_RECEIVABLE = ("1130", "Other Receivables")
ACCRUED = ("3020", "Accrued Expenses")
IC_FEE = 25000.0

SUBSIDIARIES = [
    {
        "key": "services", "name": "Gnanova Demo Services FZ-LLC (synthetic data)", "trade": "Gnanova Services",
        "slug": "gnanova-close-demo-services", "account_number": "1015-DEMO-0002",
        "customers": [("Harbour Hotels Group (demo)", 0), ("Skyline Developments PJSC (demo)", 0)],
        "revenue": 180000.0, "split": (0.6, 0.4),
        "expenses": [("7101", "Salaries & Wages", 60000), ("7140", "Professional Fees", 4000),
                     ("7120", "Utilities", 2500), ("7130", "Marketing & Advertising", 3000)],
        "lease": {"name": "Office lease - Dubai Internet City (demo)", "payment": 15000.0, "term": 36, "ibr": 0.06},
    },
    {
        "key": "logistics", "name": "Gnanova Demo Logistics LLC (synthetic data)", "trade": "Gnanova Logistics",
        "slug": "gnanova-close-demo-logistics", "account_number": "1015-DEMO-0003",
        "customers": [("Coastal Freight Brokers (demo)", 0), ("Oasis Retail Distribution (demo)", 45)],
        "revenue": 140000.0, "split": (0.55, 0.45),
        "expenses": [("7101", "Salaries & Wages", 45000), ("7102", "End of Service Benefits", 2625),
                     ("7110", "Office Rent", 18000), ("7150", "Travel & Entertainment", 6000), ("7120", "Utilities", 1800)],
    },
]


def _profile(db: Session, workspace_id: str, name: str, trade: str, slug: str) -> UaeCompanyProfile:
    profile = db.query(UaeCompanyProfile).filter(UaeCompanyProfile.workspace_id == workspace_id,
                                                 UaeCompanyProfile.company_name == name).first()
    if profile is None:
        profile = UaeCompanyProfile(
            workspace_id=workspace_id, company_name=name, trade_name=trade, base_currency="AED", reporting_standard="IFRS",
            financial_year_start=1, industry="Professional services", status="active", setup_step=5, coa_option="default",
        )
        db.add(profile)
        db.flush()
    if db.get(ApCompany, profile.id) is None:
        db.add(ApCompany(id=profile.id, tenant_id=workspace_id, name=name, slug=slug, market="uae"))
        db.flush()
    return profile


def _extra_accounts(db: Session, workspace_id: str, company_id: str) -> None:
    for code, name, acct_type, sub in EXTRA_ACCOUNTS:
        exists = db.query(UAEAccount).filter(UAEAccount.tenant_id == workspace_id, UAEAccount.company_id == company_id,
                                             UAEAccount.code == code).first()
        if exists is None:
            db.add(UAEAccount(tenant_id=workspace_id, company_id=company_id, code=code, name=name,
                              account_type=acct_type, sub_type=sub))


def _clear_subsidiary(db: Session, workspace_id: str, company_id: str) -> None:
    parent_demo._clear(db, workspace_id, company_id)
    db.query(IFRS16Lease).filter(IFRS16Lease.workspace_id == workspace_id, IFRS16Lease.company_id == company_id).delete(
        synchronize_session=False)


def _lease_schedule(principal: float, rate: float, payment: float, months: list[str]) -> list[dict[str, Any]]:
    rows, balance = [], principal
    for period in months:
        interest = round(balance * rate, 2)
        closing = round(balance + interest - payment, 2)
        rows.append({"Date": f"{period}-28", "Opening_Balance": round(balance, 2), "Interest": interest,
                     "Principal": round(payment - interest, 2), "Payment": payment, "Closing_Balance": closing})
        balance = closing
    return rows


def _seed_subsidiary(db: Session, workspace_id: str, spec: dict[str, Any], months: list[str], ic_counterparty: str) -> dict[str, Any]:
    profile = _profile(db, workspace_id, spec["name"], spec["trade"], spec["slug"])
    cid = profile.id
    _clear_subsidiary(db, workspace_id, cid)
    db.flush()
    seed_uae_chart_of_accounts(workspace_id, db, company_id=cid)
    _extra_accounts(db, workspace_id, cid)
    last = months[-1]
    last_end = period_bounds(last)[1]
    entries, bank_events, invoices = [], [], []
    tag = spec["key"][:3].upper()

    def post(number, day, desc, debit, credit, amount, reference, bank_amount=None):
        entries.append(_entry(workspace_id, cid, number, day, desc, debit, credit, amount, reference))
        if bank_amount is not None:
            bank_events.append((day, desc, reference, round(bank_amount, 2)))

    customers = [UAECustomer(tenant_id=workspace_id, name=name, currency="AED", payment_terms_days=30) for name, _ in spec["customers"]]
    db.add_all(customers)
    db.flush()

    lease, schedule = None, []
    if spec.get("lease"):
        ls = spec["lease"]
        rate = ls["ibr"] / 12
        principal = round(ls["payment"] * (1 - (1 + rate) ** -ls["term"]) / rate, 2)
        commencement = period_bounds(months[0])[0]
        schedule = _lease_schedule(principal, rate, ls["payment"], months)
        lease = IFRS16Lease(
            workspace_id=workspace_id, company_id=cid, lease_name=ls["name"], asset_description="Office premises",
            asset_class="property", commencement_date=commencement, lease_term_months=ls["term"],
            lease_payments_aed=ls["payment"], payment_frequency="monthly", incremental_borrowing_rate=ls["ibr"],
            rou_asset_initial=principal, lease_liability_initial=principal, status="active",
            calculation_json=json.dumps({"amortization_schedule": schedule}),
        )
        db.add(lease)
        db.flush()
        post(f"{tag}-LEASE-INIT", commencement, f"Initial recognition: {ls['name']}",
             ("2010", "Right-of-Use Asset (IFRS 16)"), ("3030", "Lease Liability - Current (IFRS 16)"), principal,
             f"IFRS16-{lease.id[:8]}-INIT")

    for idx, period in enumerate(months):
        start, end = period_bounds(period)
        for n, (code, name, amount) in enumerate(spec["expenses"], start=2):
            if spec["key"] == "logistics" and code == "7110" and period == last:
                continue  # rent not recorded for the last month
            day = start + timedelta(days=8 + n)
            post(f"{tag}-JE-{period}-{n:02d}", day, f"{name} {period}", (code, name), BANK, amount,
                 f"{tag}-{period}-{n:02d}", -amount)
        for k, share in enumerate(spec["split"]):
            amount = round(spec["revenue"] * share, 2)
            inv_date = start + timedelta(days=3)
            due = inv_date + timedelta(days=30)
            number = f"{tag}-INV-{period}-{k + 1}"
            paid_on = due + timedelta(days=spec["customers"][k][1])
            paid = paid_on <= last_end
            post(f"{tag}-SI-{period}-{k + 1}", inv_date, f"Invoice {number}", AR, SERVICE_REVENUE, amount, number)
            invoices.append(UAESalesInvoice(
                tenant_id=workspace_id, company_id=cid, invoice_number=number, customer_id=customers[k].id,
                invoice_date=inv_date, due_date=due, period=period, subtotal=amount, vat_amount=0, total_amount=amount,
                paid_amount=amount if paid else 0, outstanding=0 if paid else amount, status="paid" if paid else "sent",
                paid_date=paid_on if paid else None, notes="Synthetic demo invoice",
            ))
            if paid:
                post(f"{tag}-RC-{period}-{k + 1}", paid_on, f"Receipt {number}", BANK, AR, amount, number, amount)

        ic_ref = f"IC-{period}-01"
        ic_day = start + timedelta(days=24)
        if spec["key"] == "services":
            desc = f"Management fee to {ic_counterparty} {period}"
            if period == last:
                post(f"{tag}-IC-{period}", ic_day, desc, IC_RECEIVABLE, SERVICE_REVENUE, IC_FEE, ic_ref)
            else:
                post(f"{tag}-IC-{period}", ic_day, desc, BANK, SERVICE_REVENUE, IC_FEE, ic_ref, IC_FEE)
        else:
            desc = f"Management fee from {ic_counterparty} {period}"
            if period == last:
                post(f"{tag}-IC-{period}", ic_day, desc, ("7140", "Professional Fees"), ACCRUED, 24000.0, ic_ref)
            else:
                post(f"{tag}-IC-{period}", ic_day, desc, ("7140", "Professional Fees"), BANK, IC_FEE, ic_ref, -IC_FEE)

        if lease is not None:
            row = schedule[idx]
            dep = round(lease.rou_asset_initial / lease.lease_term_months, 2)
            base = f"IFRS16-{lease.id[:8]}"
            if period != last:
                post(f"{tag}-L-DEP-{period}", end, f"IFRS 16 Depreciation: {lease.lease_name}",
                     ("7112", "Depreciation - ROU Asset"), ("2011", "Accumulated Depreciation - ROU"), dep, f"{base}-DEP-{period}")
                post(f"{tag}-L-INT-{period}", end, f"IFRS 16 Interest: {lease.lease_name}",
                     ("7170", "Interest Expense (IFRS 16)"), ("3030", "Lease Liability - Current (IFRS 16)"), row["Interest"],
                     f"{base}-INT-{period}")
            post(f"{tag}-L-PAY-{period}", start + timedelta(days=27), f"IFRS 16 Payment: {lease.lease_name}",
                 ("3030", "Lease Liability - Current (IFRS 16)"), BANK, row["Payment"], f"{base}-PAY-{period}", -row["Payment"])

    db.add_all(entries)
    db.add_all(invoices)
    if lease is not None:
        done = len(months) - 1
        dep = round(lease.rou_asset_initial / lease.lease_term_months, 2)
        lease.rou_asset_current = round(lease.rou_asset_initial - dep * done, 2)
        lease.accumulated_depreciation = round(dep * done, 2)
        lease.lease_liability_current = round(schedule[-2]["Closing_Balance"] - schedule[-1]["Payment"], 2)
        lease.je_posted = True
        lease.last_je_date = period_bounds(months[-2])[1]

    bank_gl = db.query(UAEAccount).filter(UAEAccount.tenant_id == workspace_id, UAEAccount.company_id == cid,
                                          UAEAccount.code == BANK[0]).first()
    account = UAEBankAccount(tenant_id=workspace_id, company_id=cid, bank_name="Emirates NBD", account_number=spec["account_number"],
                             currency="AED", gl_account_id=bank_gl.id if bank_gl else None)
    db.add(account)
    db.flush()
    balance, lines = 0.0, 0
    for period in months:
        start, end = period_bounds(period)
        stmt = UAEBankStatement(tenant_id=workspace_id, bank_account_id=account.id, statement_date=end,
                                opening_balance=round(balance, 2), status="pending")
        db.add(stmt)
        db.flush()
        for day, desc, ref, amount in sorted((e for e in bank_events if start <= e[0] <= end), key=lambda e: (e[0], e[2])):
            balance = round(balance + amount, 2)
            db.add(UAEBankStatementLine(statement_id=stmt.id, transaction_date=day, value_date=day, description=desc,
                                        reference=ref, debit=max(-amount, 0), credit=max(amount, 0), balance=balance,
                                        match_status="unmatched"))
            lines += 1
        stmt.closing_balance = round(balance, 2)

    for year in sorted({p[:4] for p in months}):
        for code, name, amount in spec["expenses"]:
            db.add(FpaMasterRow(upload_id=parent_demo.DEMO_UPLOAD_ID, section="PL", currency="AED", fiscal_year=f"FY{year}",
                                account_code=code, account_name=name, account_type="expense",
                                monthly_actuals=json.dumps([0.0] * 12),
                                monthly_budgets=json.dumps([round(amount * parent_demo.BUDGET_MULTIPLIER, 2)] * 12),
                                company_id=cid, notes="Synthetic demo budget"))
    return {"company_id": cid, "company_name": spec["name"], "journal_entries": len(entries), "bank_statement_lines": lines}


# ── AP InvoiceFlow data (Supabase) ───────────────────────────────────────────

AP_VENDORS = [
    ("Emirates Office Supplies (demo)", "Office supplies and stationery", 2400.0, ("7140", "Professional Fees")),
    ("Gulf IT Solutions FZE (demo)", "IT support retainer", 15000.0, ("7140", "Professional Fees")),
    ("Al Futtaim Facilities LLC (demo)", "Building maintenance", 6800.0, ("7180", "Repairs & Maintenance")),
    ("Desert Courier Services (demo)", "Courier and logistics", 1900.0, ("7150", "Travel & Entertainment")),
    ("Prime Print & Signage (demo)", "Marketing collateral", 3300.0, ("7130", "Marketing & Advertising")),
    ("CleanPro Services LLC (demo)", "Office cleaning", 4200.0, ("7120", "Utilities")),
]


def _ensure_supabase_company(sb: Any, company_id: str, name: str, slug: str, workspace_id: str) -> None:
    if sb.table("companies").select("id").eq("id", company_id).limit(1).execute().data:
        return
    sb.table("companies").insert({
        "id": company_id, "name": name, "slug": f"{slug}-{company_id[:8]}", "industry": "general",
        "accounting_standard": "IFRS", "market": "uae", "subscription_tier": "starter", "subscription_status": "trial",
        "max_invoices_per_month": 10000, "max_users": 5, "workspace_id": workspace_id,
    }).execute()


_OPTIONAL_INVOICE_KEYS = ("vat_amount", "payment_status", "tax_type", "tax_rate", "subtotal_amount",
                          "ifrs_category", "ifrs_confidence", "ifrs_explanation", "file_type")


def _insert(sb: Any, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i in range(0, len(rows), 100):
        chunk = rows[i:i + 100]
        try:
            out += sb.table(table).insert(chunk).execute().data or []
        except Exception:
            if table != "invoices":
                raise
            trimmed = [{k: v for k, v in r.items() if k not in _OPTIONAL_INVOICE_KEYS} for r in chunk]
            out += sb.table(table).insert(trimmed).execute().data or []
    return out


def _invoice(cid: str, number: str, vendor: str, net: float, inv_date: date, po_number: str | None, paid: bool) -> dict[str, Any]:
    vat = round(net * 0.05, 2)
    return {
        "company_id": cid, "invoice_number": number, "invoice_date": inv_date.isoformat(),
        "due_date": (inv_date + timedelta(days=30)).isoformat(), "vendor_name": vendor,
        "total_amount": round(net + vat, 2), "subtotal_amount": net, "tax_type": "VAT", "tax_rate": 5,
        "tax_amount": vat, "vat_amount": vat, "currency": "AED", "status": "Paid" if paid else "Approved",
        "payment_status": "paid" if paid else "unpaid", "po_number": po_number, "file_url": f"demo://{number}",
        "file_type": "application/pdf", "ifrs_category": "Operating expense", "ifrs_confidence": 0.9,
        "ifrs_explanation": "Synthetic demo invoice",
    }


def seed_demo_ap(sb: Any, company_id: str, name: str, slug: str, workspace_id: str, months: list[str], *, plants: bool,
                 per_month: int) -> dict[str, int]:
    """Replace the company's AP rows in Supabase with a deterministic register for the last three months."""
    _ensure_supabase_company(sb, company_id, name, slug, workspace_id)
    for table in ("invoices", "goods_receipts", "purchase_orders"):
        sb.table(table).delete().eq("company_id", company_id).execute()
    prefix = f"D{company_id.replace('-', '')[:6].upper()}"
    pos, grns, invoices = [], [], []
    seq = 0
    recent = months[-3:]
    last = recent[-1]
    for period in recent:
        start, end = period_bounds(period)
        for k in range(per_month):
            vendor, desc, base, account = AP_VENDORS[k % len(AP_VENDORS)]
            seq += 1
            net = round(base * (1 + ((seq * 7) % 11) / 100), 2)
            day = start + timedelta(days=(k * 3) % 26)
            po_no = f"{prefix}-PO-{seq:04d}"
            pos.append({"company_id": company_id, "po_number": po_no, "vendor_name": vendor, "po_amount": net, "currency": "AED",
                        "po_date": (day - timedelta(days=10)).isoformat(), "description": desc, "status": "Fully Received",
                        "line_items": [{"description": desc, "account_code": account[0], "account_name": account[1], "amount": net}]})
            grns.append({"po_number": po_no, "company_id": company_id, "grn_number": f"{prefix}-GRN-{seq:04d}", "vendor_name": vendor,
                         "received_amount": net, "received_date": (day - timedelta(days=2)).isoformat(), "status": "confirmed"})
            paid = period != last and not (plants and period == recent[-2] and k == 0)
            invoices.append(_invoice(company_id, f"{prefix}-INV-{seq:04d}", vendor, net, day, po_no, paid))
    if plants:
        start, end = period_bounds(last)
        it_vendor, facilities = AP_VENDORS[1][0], AP_VENDORS[2][0]
        pos += [
            {"company_id": company_id, "po_number": f"{prefix}-PO-9001", "vendor_name": it_vendor, "po_amount": 15000.0,
             "currency": "AED", "po_date": start.isoformat(), "description": "Network upgrade", "status": "Fully Received",
             "line_items": [{"description": "Network upgrade", "account_code": "7140", "amount": 15000.0}]},
            {"company_id": company_id, "po_number": f"{prefix}-PO-9002", "vendor_name": it_vendor, "po_amount": 8000.0,
             "currency": "AED", "po_date": start.isoformat(), "description": "Laptop batch", "status": "Open",
             "line_items": [{"description": "Laptops", "account_code": "7140", "amount": 8000.0}]},
            {"company_id": company_id, "po_number": f"{prefix}-PO-9003", "vendor_name": it_vendor, "po_amount": 6000.0,
             "currency": "AED", "po_date": start.isoformat(), "description": "Software licences", "status": "Fully Received",
             "line_items": [{"description": "Licences", "account_code": "7140", "amount": 6000.0}]},
            {"company_id": company_id, "po_number": f"{prefix}-PO-9004", "vendor_name": facilities, "po_amount": 50000.0,
             "currency": "AED", "po_date": (start + timedelta(days=5)).isoformat(),
             "description": "HVAC overhaul - head office", "status": "Fully Received",
             "line_items": [{"description": "HVAC overhaul", "account_code": "7180", "account_name": "Repairs & Maintenance",
                             "amount": 50000.0}]},
        ]
        grns += [
            {"po_number": f"{prefix}-PO-9001", "company_id": company_id, "grn_number": f"{prefix}-GRN-9001", "vendor_name": it_vendor,
             "received_amount": 15000.0, "received_date": (start + timedelta(days=6)).isoformat(), "status": "confirmed"},
            {"po_number": f"{prefix}-PO-9003", "company_id": company_id, "grn_number": f"{prefix}-GRN-9003", "vendor_name": it_vendor,
             "received_amount": 6000.0, "received_date": (start + timedelta(days=7)).isoformat(), "status": "confirmed"},
            {"po_number": f"{prefix}-PO-9004", "company_id": company_id, "grn_number": f"{prefix}-GRN-9004", "vendor_name": facilities,
             "received_amount": 50000.0, "received_date": (start + timedelta(days=24)).isoformat(), "status": "confirmed"},
        ]
        invoices += [
            _invoice(company_id, f"{prefix}-GIT-4471", it_vendor, 18000.0, start + timedelta(days=9), f"{prefix}-PO-9001", False),
            _invoice(company_id, f"{prefix}-GIT 4471", it_vendor, 18000.0, start + timedelta(days=16), f"{prefix}-PO-9001", False),
            _invoice(company_id, f"{prefix}-DW-7710", "DEWA (demo)", 3450.0, start + timedelta(days=11), None, False),
            _invoice(company_id, f"{prefix}-DW-7714", "DEWA (demo)", 3450.0, start + timedelta(days=13), None, False),
            _invoice(company_id, f"{prefix}-GIT-4480", it_vendor, 8000.0, start + timedelta(days=12), f"{prefix}-PO-9002", False),
            _invoice(company_id, f"{prefix}-PEM-0310", "Prime Events Management (demo)", 12600.0, start + timedelta(days=14), None, False),
            _invoice(company_id, f"{prefix}-GTT-0091", "Gulf Tech Trading (demo)", 6000.0, start + timedelta(days=15), f"{prefix}-PO-9003", False),
        ]
    saved_pos = _insert(sb, "purchase_orders", pos)
    po_ids = {p["po_number"]: p["id"] for p in saved_pos}
    for g in grns:
        g["po_id"] = po_ids.get(g.pop("po_number"))
    _insert(sb, "goods_receipts", grns)
    _insert(sb, "invoices", invoices)
    return {"invoices": len(invoices), "purchase_orders": len(pos), "goods_receipts": len(grns)}


def seed_demo_group(db: Session, workspace_id: str, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    parent = parent_demo.seed_demo_company(db, workspace_id, today=today)
    months = parent["periods"]
    _extra_accounts(db, workspace_id, parent["company_id"])
    services, logistics = SUBSIDIARIES
    subs = [_seed_subsidiary(db, workspace_id, services, months, logistics["name"]),
            _seed_subsidiary(db, workspace_id, logistics, months, services["name"])]
    db.commit()
    companies = [(parent["company_id"], parent_demo.DEMO_NAME, parent_demo.DEMO_SLUG, True, 40)] + [
        (s["company_id"], spec["name"], spec["slug"], False, 6) for s, spec in zip(subs, SUBSIDIARIES)]
    ap: dict[str, Any] = {}
    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        for cid, name, slug, plants, per_month in companies:
            ap[cid] = seed_demo_ap(sb, cid, name, slug, workspace_id, months, plants=plants, per_month=per_month)
        ap_note = None
    except Exception as exc:  # noqa: BLE001 - AP demo data is optional
        logger.warning("demo AP seeding skipped: %s", exc)
        ap_note = f"AP demo data not loaded ({type(exc).__name__}); the AP agent will report the source as unavailable."
    return {
        "company_id": parent["company_id"], "company_name": parent_demo.DEMO_NAME, "periods": months,
        "entities": [{"id": cid, "name": name} for cid, name, *_ in companies],
        "journal_entries": parent["journal_entries"] + sum(s["journal_entries"] for s in subs),
        "ap": ap, "ap_note": ap_note,
        "planted": parent["planted_anomalies"] + [
            "AP: price mismatch, re-keyed duplicate, possible duplicate, invoice before receipt, no-PO invoice, vendor mismatch",
            "AP: HVAC overhaul received but not invoiced (accrue Repairs & Maintenance 50,000)",
            "Services: October lease depreciation and interest not recorded; no end-of-service accrual",
            "Logistics: October rent not recorded; intercompany fee booked at 24,000 vs 25,000",
        ],
    }
