"""
One-shot DB verify: connect → alembic upgrade → table audit → replace IFRS master (78 rows).

Matches local runbook Fixes 2–4. Run from backend/:  python fix_and_verify.py
PostgreSQL must be up unless DATABASE_URL is SQLite (see env.example).
"""
import os
import subprocess
import sys

_BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND_ROOT)

from sqlalchemy import inspect, text

from app.core.config import settings
from app.db import SessionLocal, engine

# Canonical IFRS master for dropdowns (Fix 4) — 78 rows; fifth tuple field = contra → is_calculated
MASTER_ITEMS = [
    ("financial_position", "Non-current Assets", "Property plant and equipment", 1, False),
    ("financial_position", "Non-current Assets", "Accumulated depreciation — PPE", 2, True),
    ("financial_position", "Non-current Assets", "Right-of-use assets", 3, False),
    ("financial_position", "Non-current Assets", "Accumulated depreciation — ROU", 4, True),
    ("financial_position", "Non-current Assets", "Goodwill", 5, False),
    ("financial_position", "Non-current Assets", "Other intangible assets", 6, False),
    ("financial_position", "Non-current Assets", "Accumulated amortisation — intangibles", 7, True),
    ("financial_position", "Non-current Assets", "Investments in associates", 8, False),
    ("financial_position", "Non-current Assets", "Other financial assets", 9, False),
    ("financial_position", "Non-current Assets", "Deferred tax assets", 10, False),
    ("financial_position", "Current Assets", "Inventories", 11, False),
    ("financial_position", "Current Assets", "Trade and other receivables", 12, False),
    ("financial_position", "Current Assets", "Loss allowance on receivables", 13, True),
    ("financial_position", "Current Assets", "Contract assets", 14, False),
    ("financial_position", "Current Assets", "Prepayments and other current assets", 15, False),
    ("financial_position", "Current Assets", "Cash and cash equivalents", 16, False),
    ("financial_position", "Equity", "Share capital", 17, False),
    ("financial_position", "Equity", "Share premium", 18, False),
    ("financial_position", "Equity", "Retained earnings", 19, False),
    ("financial_position", "Equity", "Other comprehensive income reserve", 20, False),
    ("financial_position", "Equity", "Foreign currency translation reserve", 21, False),
    ("financial_position", "Equity", "Revaluation reserve", 22, False),
    ("financial_position", "Non-current Liabilities", "Borrowings — non-current", 23, False),
    ("financial_position", "Non-current Liabilities", "Lease liabilities — non-current", 24, False),
    ("financial_position", "Non-current Liabilities", "Deferred tax liabilities", 25, False),
    ("financial_position", "Non-current Liabilities", "Employee benefit obligations", 26, False),
    ("financial_position", "Non-current Liabilities", "Provisions", 27, False),
    ("financial_position", "Current Liabilities", "Trade and other payables", 28, False),
    ("financial_position", "Current Liabilities", "Borrowings — current", 29, False),
    ("financial_position", "Current Liabilities", "Lease liabilities — current", 30, False),
    ("financial_position", "Current Liabilities", "Contract liabilities", 31, False),
    ("financial_position", "Current Liabilities", "Income tax payable", 32, False),
    ("financial_position", "Current Liabilities", "Accruals and other payables", 33, False),
    ("profit_loss", "Revenue", "Revenue from contracts with customers", 34, False),
    ("profit_loss", "Revenue", "Other income", 35, False),
    ("profit_loss", "Revenue", "Gain on disposal of PPE", 36, False),
    ("profit_loss", "Cost of Sales", "Cost of goods sold", 37, False),
    ("profit_loss", "Cost of Sales", "Changes in inventories", 38, False),
    ("profit_loss", "Operating Expenses", "Employee benefits expense", 39, False),
    ("profit_loss", "Operating Expenses", "Depreciation — PPE", 40, False),
    ("profit_loss", "Operating Expenses", "Depreciation — right-of-use assets", 41, False),
    ("profit_loss", "Operating Expenses", "Amortisation of intangibles", 42, False),
    ("profit_loss", "Operating Expenses", "Impairment of goodwill", 43, False),
    ("profit_loss", "Operating Expenses", "Expected credit loss charge", 44, False),
    ("profit_loss", "Operating Expenses", "Research and development expense", 45, False),
    ("profit_loss", "Operating Expenses", "Selling and distribution expense", 46, False),
    ("profit_loss", "Operating Expenses", "General and administrative expense", 47, False),
    ("profit_loss", "Operating Expenses", "Other operating expenses", 48, False),
    ("profit_loss", "Finance Items", "Finance income", 49, False),
    ("profit_loss", "Finance Items", "Finance costs — interest on loans", 50, False),
    ("profit_loss", "Finance Items", "Finance costs — interest on leases", 51, False),
    ("profit_loss", "Finance Items", "Foreign exchange loss", 52, False),
    ("profit_loss", "Finance Items", "Share of profit of associates", 53, False),
    ("profit_loss", "Tax", "Income tax expense — current", 54, False),
    ("profit_loss", "Tax", "Income tax expense — deferred", 55, False),
    (
        "other_comprehensive_income",
        "OCI — will not be reclassified",
        "Remeasurement of defined benefit plans",
        56,
        False,
    ),
    (
        "other_comprehensive_income",
        "OCI — will not be reclassified",
        "Fair value changes — equity instruments",
        57,
        False,
    ),
    (
        "other_comprehensive_income",
        "OCI — may be reclassified",
        "Foreign currency translation differences",
        58,
        False,
    ),
    ("cash_flows", "Operating Activities", "Profit for the period", 59, False),
    ("cash_flows", "Operating Activities", "Adjustments for depreciation", 60, False),
    ("cash_flows", "Operating Activities", "Adjustments for amortisation", 61, False),
    ("cash_flows", "Operating Activities", "Changes in trade receivables", 62, False),
    ("cash_flows", "Operating Activities", "Changes in inventories", 63, False),
    ("cash_flows", "Operating Activities", "Changes in trade payables", 64, False),
    ("cash_flows", "Operating Activities", "Income tax paid", 65, False),
    ("cash_flows", "Investing Activities", "Purchase of property plant equipment", 66, False),
    ("cash_flows", "Investing Activities", "Purchase of intangible assets", 67, False),
    ("cash_flows", "Financing Activities", "Proceeds from borrowings", 68, False),
    ("cash_flows", "Financing Activities", "Repayment of borrowings", 69, False),
    ("cash_flows", "Financing Activities", "Repayment of lease liabilities", 70, False),
    ("cash_flows", "Financing Activities", "Dividends paid", 71, False),
    ("equity", "Equity Components", "Share capital — opening", 72, False),
    ("equity", "Equity Components", "Share capital — closing", 73, False),
    ("equity", "Equity Components", "Retained earnings — opening", 74, False),
    ("equity", "Equity Components", "Profit for the period", 75, False),
    ("equity", "Equity Components", "Other comprehensive income", 76, False),
    ("equity", "Equity Components", "Dividends paid", 77, False),
    ("equity", "Equity Components", "Retained earnings — closing", 78, False),
]

# Must exist for IFRS + bank recon (current SQLAlchemy / alembic chain)
CORE_TABLES = [
    "trial_balances",
    "trial_balance_lines",
    "gl_mappings",
    "ifrs_line_item_master",
    "ifrs_links",
    "generated_statements",
    "statement_line_items",
    "disclosure_notes",
    "compliance_checks",
    "recon_workspaces",
    "book_transactions",
    "bank_transactions",
    "match_groups",
]

# Listed in runbook Fix 2 — not yet in ORM/migrations
PLANNED_TABLES = ["statement_commentary", "risk_flags", "gl_audit_reports"]

# Helpful extras (ORM)
EXTRA_TABLES = ["mapping_templates", "disclosure_sections"]


print("=" * 50)
print("STEP 1: DB CONNECTION")
print("=" * 50)
try:
    with engine.connect() as conn:
        if "sqlite" in settings.DATABASE_URL:
            result = conn.execute(text("SELECT sqlite_version()"))
            print("CONNECTED: SQLite", result.fetchone()[0])
        else:
            result = conn.execute(text("SELECT version()"))
            print("CONNECTED:", result.fetchone()[0][:40])
except Exception as e:
    print("FAILED:", e)
    print()
    if "sqlite" in settings.DATABASE_URL:
        print("SQLite file could not be opened. Check DATABASE_URL path and permissions.")
    else:
        print("PostgreSQL is not reachable. On this machine:")
        print("  1) Admin PowerShell: Get-Service *postgres* | Start-Service")
        print("  2) Or:  .\\scripts\\Start-Postgres.ps1")
        print("  3) Or install Docker Desktop, then from repo root:")
        print("       docker compose -f infrastructure/docker-compose.yml up -d postgres")
        print("  4) Or from backend: docker compose -f docker-compose.postgres.yml up -d")
        print("  5) Or set DATABASE_URL=sqlite:///./finreportai.db in .env (see env.example)")
    sys.exit(1)

print()
print("=" * 50)
print("STEP 2: RUN MIGRATIONS (alembic upgrade head)")
print("=" * 50)
if "sqlite" in settings.DATABASE_URL:
    print(
        "Skipping Alembic: revision chain targets PostgreSQL (JSONB, now(), etc.). "
        "Using init_db() -> create_all from ORM metadata."
    )
    from app.db import init_db

    init_db()
    print("Done.")
else:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
        cwd=_BACKEND_ROOT,
    )
    print(result.stdout)
    if result.returncode != 0:
        print("Migration error:", result.stderr)
        err = (result.stderr or "") + (result.stdout or "")
        if "trial_balances" in err.lower() or "does not exist" in err.lower():
            print()
            print(
                "Hint: migration 003 expects IFRS tables. Create them once, then re-run:\n"
                "  python -c \"from app.db import init_db; init_db()\"\n"
                "If tables already overlap alembic, align stamps: alembic current"
            )
        sys.exit(1)

print()
print("=" * 50)
print("STEP 3: TABLES CHECK (Fix 2)")
print("=" * 50)
inspector = inspect(engine)
tables = set(inspector.get_table_names())
print(f"Total tables: {len(tables)}")

missing_core = []
for t in CORE_TABLES:
    if t in tables:
        print(f"  OK  {t}")
    else:
        print(f"  MISSING  {t}")
        missing_core.append(t)

print()
print("  Planned (schema TBD - OK if missing):")
for t in PLANNED_TABLES:
    print(f"  {'OK ' if t in tables else 'TBD'} {t}")

print()
print("  Extra ORM tables:")
for t in EXTRA_TABLES:
    print(f"  {'OK ' if t in tables else 'MISSING'} {t}")

if missing_core:
    print()
    print(f"Critical missing tables: {len(missing_core)} - run migrations or init_db as needed.")
    sys.exit(1)

print()
print("=" * 50)
print("STEP 4: SEED IFRS MASTER (Fix 4 - full replace, 78 items)")
print("=" * 50)
from app.models.ifrs_statement import IFRSLineItemMaster

db = SessionLocal()
db.query(IFRSLineItemMaster).delete()
db.commit()

for stmt, section, name, order, is_contra in MASTER_ITEMS:
    db.add(
        IFRSLineItemMaster(
            statement=stmt,
            section=section,
            name=name,
            display_order=order,
            is_calculated=is_contra,
            standard="IAS 1",
        )
    )
db.commit()
count = db.query(IFRSLineItemMaster).count()
print(f"Seeded {count} IFRS line items (expected 78)")

print()
print("=" * 50)
print("STEP 5: CHECK EXISTING TB DATA")
print("=" * 50)
from app.models.ifrs_statement import DisclosureNote, GLMapping, TrialBalance

tbs = db.query(TrialBalance).all()
print(f"Trial balances: {len(tbs)}")
for tb in tbs:
    mappings = db.query(GLMapping).filter(GLMapping.trial_balance_id == tb.id).count()
    notes = 0
    try:
        notes = db.query(DisclosureNote).filter(DisclosureNote.trial_balance_id == tb.id).count()
    except Exception:
        pass
    print(
        f"  TB {tb.id}: {tb.company_name} | "
        f"mappings={mappings} | notes={notes} | "
        f"status={tb.status}"
    )

db.close()

print()
print("=" * 50)
print("SUMMARY - optional services")
print("=" * 50)
services = [
    "app/services/commentary_generator.py",
    "app/services/risk_engine.py",
    "app/services/gl_audit_engine.py",
    "app/services/ifrs_pdf_exporter.py",
    "app/services/ifrs_excel_exporter.py",
    "app/models/entity_profile.py",
]
for s in services:
    p = os.path.join(_BACKEND_ROOT, s)
    print(f"  {'OK' if os.path.exists(p) else 'MISSING'} {s}")

print()
print("=" * 50)
print("REPORT BACK (manual - Fix 5 / E2E)")
print("=" * 50)
print("  Database connection OK                 -> you verified in Step 1")
print(f"  All core DB tables present             -> OK ({len(CORE_TABLES)} checked)")
print(f"  IFRS master seeded                     -> {count} items (target 78)")
print("  Prism TB uploaded / lines_count        -> run API + UI")
print("  AI mapping quality                     -> curl / map-with-ai")
print("  Dropdown shows 50+ options             -> refresh UI after Step 4")
