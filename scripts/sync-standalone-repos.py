#!/usr/bin/env python3
"""
Sync GulfTax (uaetax) and AP InvoiceFlow (apinvoice) standalone repos into FinReportAI.
Run after: git fetch apinvoice uaetax  OR  shallow clones in .sync-tmp/

Preserves CFO-only integration files (see PRESERVE_* lists).
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UAETAX = ROOT / ".sync-tmp" / "uaetax"
APINV = ROOT / ".sync-tmp" / "apinvoice"

# ── CFO-only files — never overwrite ──────────────────────────────────────────

PRESERVE_AP_PAGES = {
    "MyApprovals.tsx",      # approve-and-post GL integration
    "InvoiceUpload.tsx",    # GulfTax classify on OCR
    "Dashboard.tsx",        # APInsightsPanel + workspace
    "APInvoicesLayout.tsx",
    "APIntegrations.tsx",
}

PRESERVE_AP_LIB = {
    "glPostService.ts",
    "workspaceCompanySync.ts",
    "uaeVatService.ts",
    "bulkExcelParse.ts",
    "gulfTaxService.ts",
}

PRESERVE_GULFTAX_PAGES = {
    "GulfTaxLayout.tsx",    # FinReportAI shell
    "ESRFiling.tsx",        # CFO uses API; standalone is client-only demo
    "VATReturn.tsx",        # CFO auto-fill from AP via gulfTaxApi
}

GULFTAX_PAGE_MAP = {
    "app/dashboard/page.tsx": "frontend/src/pages/gulftax/GulfTaxDashboard.tsx",
    "app/dashboard/vat-classifier/page.tsx": "frontend/src/pages/gulftax/VATClassifier.tsx",
    "app/dashboard/vat-return/page.tsx": "frontend/src/pages/gulftax/VATReturn.tsx",
    "app/dashboard/recon/page.tsx": "frontend/src/pages/gulftax/Reconciliation.tsx",
    "app/dashboard/e-invoicing/page.tsx": "frontend/src/pages/gulftax/EInvoicing.tsx",
    "app/dashboard/corporate-tax/page.tsx": "frontend/src/pages/gulftax/CorporateTax.tsx",
    "app/dashboard/transfer-pricing/page.tsx": "frontend/src/pages/gulftax/TransferPricing.tsx",
    "app/dashboard/cbcr-report/page.tsx": "frontend/src/pages/gulftax/CbCR.tsx",
    "app/dashboard/tax-memo/page.tsx": "frontend/src/pages/gulftax/TaxMemo.tsx",
    "app/dashboard/fta-reports/page.tsx": "frontend/src/pages/gulftax/FTAReports.tsx",
    "app/dashboard/suppliers/page.tsx": "frontend/src/pages/gulftax/Suppliers.tsx",
    "app/dashboard/invoice-flow/page.tsx": "frontend/src/pages/gulftax/InvoiceFlow.tsx",
    "app/dashboard/invoice-flow/review/page.tsx": "frontend/src/pages/gulftax/InvoiceFlowReview.tsx",
    "app/dashboard/settings/page.tsx": "frontend/src/pages/gulftax/GulfTaxSettings.tsx",
}

GULFTAX_BACKEND_MAP = {
    "backend/routers/vat_classifier.py": "backend/app/modules/gulftax/ported/routers/vat_classifier.py",
    "backend/routers/vat_return.py": "backend/app/modules/gulftax/ported/routers/vat_return.py",
    "backend/routers/invoice_flow.py": "backend/app/modules/gulftax/ported/routers/invoice_flow.py",
    "backend/routers/corporate_tax.py": "backend/app/modules/gulftax/ported/routers/corporate_tax.py",
    "backend/routers/tax_memo.py": "backend/app/modules/gulftax/ported/routers/tax_memo.py",
    "backend/routers/fta_reports.py": "backend/app/modules/gulftax/ported/routers/fta_reports.py",
    "backend/routers/dashboard.py": "backend/app/modules/gulftax/ported/routers/dashboard.py",
    "backend/routers/auth_router.py": "backend/app/modules/gulftax/ported/routers/auth_router.py",
    "backend/routers/automations.py": "backend/app/modules/gulftax/ported/routers/automations.py",
    "backend/routers/trn_validator.py": "backend/app/modules/gulftax/ported/routers/trn_validator.py",
    "backend/routers/corporatetax_routes.py": "backend/app/modules/gulftax/ported/routers/corporatetax_routes.py",
    "backend/routers/einvoicing.py": "backend/app/modules/gulftax/ported/routers/einvoicing.py",
    "backend/services/vat_classifier.py": "backend/app/modules/gulftax/ported/services/vat_classifier.py",
    "backend/services/vat_decision_tree.py": "backend/app/modules/gulftax/ported/services/vat_decision_tree.py",
    "backend/services/vat_enrichment.py": "backend/app/modules/gulftax/ported/services/vat_enrichment.py",
    "backend/services/corporate_tax_service.py": "backend/app/modules/gulftax/ported/services/corporate_tax_service.py",
    "backend/services/einvoicing_service.py": "backend/app/modules/gulftax/ported/services/einvoicing_service.py",
    "backend/services/pdf_invoice_extractor.py": "backend/app/modules/gulftax/ported/services/pdf_invoice_extractor.py",
    "backend/services/uae_tax_rag_pg.py": "backend/app/modules/gulftax/ported/services/uae_tax_rag_pg.py",
    "backend/models.py": "backend/app/modules/gulftax/ported/models.py",
    "backend/database.py": "backend/app/modules/gulftax/ported/database.py",
    "backend/utils/audit.py": "backend/app/modules/gulftax/ported/utils/audit.py",
    "backend/middleware/auth.py": "backend/app/modules/gulftax/ported/middleware/auth.py",
    "backend/alembic/versions/011_transaction_pdf_source.py": (
        "backend/app/modules/gulftax/ported/alembic/versions/011_transaction_pdf_source.py"
    ),
}


def port_nextjs_to_react(content: str, dest_name: str) -> str:
    """Adapt uaetax Next.js page → FinReportAI React Router page."""
    lines: list[str] = []
    for line in content.splitlines():
        s = line.strip()
        if s in ('"use client";', "'use client';"):
            continue
        if s.startswith("export const dynamic"):
            continue
        lines.append(line)

    text = "\n".join(lines)

    replacements = [
        (r'from ["\']@/lib/api["\']', "from '../../services/gulfTaxClient'"),
        (r'from ["\']@/context/AuthContext["\']', "from '../../context/AuthContext'"),
        (r'from ["\']@/context/CompanyContext["\']', "from '../../context/CompanyContext'"),
        (r'from ["\']@/hooks/useAuth["\']', "from '../../context/CompanyContext'"),
        (r'import Link from ["\']react-router-dom["\']', "import { Link } from 'react-router-dom'"),
        (r'from ["\']next/link["\']', "from 'react-router-dom'"),
        (r'from ["\']next/navigation["\']', "from 'react-router-dom'"),
        (r'import Link from ["\']next/link["\']', "import { Link } from 'react-router-dom'"),
    ]
    for pat, repl in replacements:
        text = re.sub(pat, repl, text)

    if "useNavigate" in text and "useNavigate" not in text.split("from 'react-router-dom'")[0]:
        # Ensure useNavigate import if we substituted router calls
        if "from 'react-router-dom'" in text and "useNavigate" not in text:
            text = text.replace(
                "from 'react-router-dom'",
                "from 'react-router-dom'",
                1,
            )

    # Default export name for React lazy loading
    if dest_name == "GulfTaxDashboard.tsx" and "export default function" in text:
        text = re.sub(
            r"export default function \w+",
            "export default function GulfTaxDashboard",
            text,
            count=1,
        )

    if not text.endswith("\n"):
        text += "\n"
    return text


def copy_file(src: Path, dest: Path, label: str) -> bool:
    if not src.is_file():
        print(f"  SKIP (missing src): {src}")
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    print(f"  synced {label}")
    return True


def sync_gulftax_backend() -> int:
    print("\n=== GulfTax backend ===")
    n = 0
    for src_rel, dest_rel in GULFTAX_BACKEND_MAP.items():
        if copy_file(UAETAX / src_rel, ROOT / dest_rel, dest_rel):
            n += 1
    return n


def sync_gulftax_frontend() -> int:
    print("\n=== GulfTax frontend pages ===")
    n = 0
    for src_rel, dest_rel in GULFTAX_PAGE_MAP.items():
        dest_name = Path(dest_rel).name
        if dest_name in PRESERVE_GULFTAX_PAGES:
            print(f"  preserve {dest_name}")
            continue
        src = UAETAX / src_rel
        dest = ROOT / dest_rel
        if not src.is_file():
            print(f"  SKIP missing: {src_rel}")
            continue
        raw = src.read_text(encoding="utf-8", errors="replace")
        ported = port_nextjs_to_react(raw, dest_name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(ported, encoding="utf-8")
        print(f"  ported {dest_rel}")
        n += 1
    return n


def sync_ap_lib() -> int:
    print("\n=== AP lib (src/lib -> frontend/src/lib/ap-invoice) ===")
    n = 0
    src_lib = APINV / "src" / "lib"
    dest_lib = ROOT / "frontend" / "src" / "lib" / "ap-invoice"
    if not src_lib.is_dir():
        print("  SKIP — no src/lib in apinvoice")
        return 0
    for src in src_lib.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(src_lib)
        if rel.name in PRESERVE_AP_LIB:
            print(f"  preserve {rel.name}")
            continue
        dest = dest_lib / rel
        if copy_file(src, dest, str(rel)):
            n += 1
    return n


def sync_ap_pages() -> int:
    print("\n=== AP pages ===")
    n = 0
    src_pages = APINV / "src" / "pages"
    dest_pages = ROOT / "frontend" / "src" / "pages" / "ap-invoices"
    for src in src_pages.rglob("*.tsx"):
        rel = src.relative_to(src_pages)
        if rel.name in PRESERVE_AP_PAGES:
            print(f"  preserve {rel}")
            continue
        dest = dest_pages / rel
        # Only copy if standalone is newer (larger) or missing in CFO
        if dest.exists() and src.stat().st_size <= dest.stat().st_size + 50:
            continue
        if copy_file(src, dest, str(rel)):
            n += 1
    return n


def sync_ap_components() -> int:
    print("\n=== AP components ===")
    n = 0
    mappings = [
        (APINV / "src" / "components" / "invoices", ROOT / "frontend" / "src" / "components" / "invoices"),
        (APINV / "src" / "components" / "vendors", ROOT / "frontend" / "src" / "components" / "vendors"),
        (APINV / "src" / "components" / "anomaly", ROOT / "frontend" / "src" / "components" / "anomaly"),
        (APINV / "src" / "components" / "approvals", ROOT / "frontend" / "src" / "components" / "approvals"),
        (APINV / "src" / "components" / "dashboard", ROOT / "frontend" / "src" / "components" / "dashboard"),
        (APINV / "src" / "components" / "chat", ROOT / "frontend" / "src" / "components" / "chat"),
    ]
    ap_root_components = [
        "InvoiceDetailModal.tsx",
        "Layout.tsx",
        "AuthGuard.tsx",
        "CurrencyCombobox.tsx",
    ]
    for name in ap_root_components:
        src = APINV / "src" / "components" / name
        dest = ROOT / "frontend" / "src" / "components" / "ap-invoice" / name
        if src.is_file():
            if not dest.exists() or src.stat().st_size > dest.stat().st_size + 50:
                if copy_file(src, dest, f"ap-invoice/{name}"):
                    n += 1

    for src_dir, dest_dir in mappings:
        if not src_dir.is_dir():
            continue
        for src in src_dir.rglob("*"):
            if not src.is_file():
                continue
            rel = src.relative_to(src_dir)
            dest = dest_dir / rel
            if dest.exists() and src.stat().st_size <= dest.stat().st_size + 50:
                continue
            if copy_file(src, dest, str(dest_dir.name / rel)):
                n += 1
    return n


def main() -> int:
    if not UAETAX.is_dir() or not APINV.is_dir():
        print("Clone standalone repos first:")
        print("  git clone --depth 1 -b master https://github.com/MANASAPADAVALA143/uaetax.git .sync-tmp/uaetax")
        print("  git clone --depth 1 -b main https://github.com/MANASAPADAVALA143/apinvoice.git .sync-tmp/apinvoice")
        return 1

    total = 0
    total += sync_gulftax_backend()
    total += sync_gulftax_frontend()
    total += sync_ap_lib()
    total += sync_ap_pages()
    total += sync_ap_components()

    print("\n=== Fix AP import paths (@/lib → @/lib/ap-invoice) ===")
    import subprocess
    fix_script = ROOT / "scripts" / "fix-ap-import-paths.py"
    if fix_script.is_file():
        subprocess.run([sys.executable, str(fix_script)], check=False)

    print(f"\nDone — {total} files synced/ported.")
    print("Review: scripts/integration-checklist.md for preserved CFO integrations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
