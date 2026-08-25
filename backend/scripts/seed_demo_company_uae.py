"""Option B — seed a clean demo company (QA data untouched).

Creates / refreshes company slug ``al-noor-commercial-demo`` with 18 realistic
UAE AP invoices whose due dates are relative to *today* so CFO briefing
overdue / due-this-week numbers look believable.

QA company ``my-company`` (0deaa402-…) is never modified.

Usage:
  cd backend
  python scripts/seed_demo_company_uae.py
  python scripts/seed_demo_company_uae.py --verify-only
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from app.core.supabase import get_supabase  # noqa: E402
from app.services.ap_cfo_daily_summary_service import build_cfo_daily_summary  # noqa: E402

QA_COMPANY_ID = "0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
DEMO_SLUG = "al-noor-commercial-demo"
DEMO_NAME = "Al Noor Commercial LLC"
INVOICE_PREFIX = "DEMO-INV-"


def _vat(net: float) -> float:
    return round(net * 0.05, 2)


def _total(net: float) -> float:
    return round(net + _vat(net), 2)


def build_demo_invoices(today: date, company_id: str) -> list[dict[str, Any]]:
    """18 invoices: ~3 overdue, ~3 due this week, rest current/future, 3 paid."""
    # (suffix, vendor, trn, net_aed, invoice_offset_days, due_offset_days, status, payment_status, desc)
    specs: list[tuple[Any, ...]] = [
        # Overdue (due before today)
        ("001", "Etisalat (e&)", "100112233400003", 8200.00, -45, -12, "Approved", "unpaid", "Mobile & fixed line — Jun"),
        ("002", "DEWA", "100223344500003", 4100.00, -40, -8, "Approved", "unpaid", "Electricity & water — Jun"),
        ("003", "Aramex", "100334455600003", 12500.00, -35, -5, "Processing", "unpaid", "International courier — Q2"),
        # Due this week (today .. today+7)
        ("004", "du Telecom", "100445566700003", 5600.00, -20, 2, "Approved", "unpaid", "Business broadband"),
        ("005", "Careem Networks FZ", "100556677800003", 9800.00, -18, 4, "Processing", "unpaid", "Corporate transport"),
        ("006", "Emirates NBD", "100667788900003", 3200.00, -15, 6, "Approved", "unpaid", "Trade finance fees"),
        # Current / upcoming
        ("007", "PwC UAE", "100778899000003", 28500.00, -10, 20, "Processing", "unpaid", "Advisory retainer — Jul"),
        ("008", "Al Futtaim Group", "100889900100003", 15200.00, -8, 22, "Processing", "unpaid", "Fleet maintenance"),
        ("009", "ADNOC Distribution", "100990011200003", 6700.00, -5, 25, "Approved", "unpaid", "Fuel cards — Jul"),
        ("010", "FAB", "100101112200003", 4400.00, -3, 28, "Processing", "unpaid", "Corporate card fees"),
        ("011", "Office Solutions LLC", "100121314400003", 8900.00, -2, 30, "Processing", "unpaid", "Stationery & supplies"),
        ("012", "Gulf Insurance Co", "100131415500003", 18700.00, -1, 35, "Approved", "unpaid", "Property insurance premium"),
        ("013", "Emirates Post", "100141516600003", 2100.00, 0, 40, "Processing", "unpaid", "Registered mail — Jul"),
        ("014", "Majid Al Futtaim", "100151617700003", 22300.00, -12, 45, "On Hold", "unpaid", "Mall fit-out materials"),
        ("015", "Transguard Group", "100161718800003", 11400.00, -7, 50, "Processing", "unpaid", "Security services — Jul"),
        # Paid (excluded from open outstanding)
        ("016", "Etisalat (e&)", "100112233400003", 7900.00, -60, -30, "Paid", "paid", "Mobile & fixed line — May"),
        ("017", "DEWA", "100223344500003", 3900.00, -55, -25, "Paid", "paid", "Electricity & water — May"),
        ("018", "Aramex", "100334455600003", 10200.00, -50, -20, "Paid", "paid", "Courier — May"),
    ]

    rows: list[dict[str, Any]] = []
    for spec in specs:
        suffix, vendor, trn, net, inv_off, due_off, status, pay_st, desc = spec
        inv_date = today + timedelta(days=int(inv_off))
        due_date = today + timedelta(days=int(due_off))
        tax = _vat(float(net))
        total = _total(float(net))
        rows.append(
            {
                "company_id": company_id,
                "invoice_number": f"{INVOICE_PREFIX}{suffix}",
                "invoice_date": inv_date.isoformat(),
                "due_date": due_date.isoformat(),
                "vendor_name": vendor,
                "vendor_trn": trn,
                "gstin": trn,
                "total_amount": total,
                "tax_amount": tax,
                "currency": "AED",
                "status": status,
                "payment_status": pay_st,
                "description": desc,
                "po_number": f"PO-DEMO-{suffix}",
                "risk_score": 0,
                "risk_level": "Low",
                "risk_flags": [],
            }
        )
    return rows


def build_demo_vendors(company_id: str) -> list[dict[str, Any]]:
    names_trns = [
        ("Etisalat (e&)", "100112233400003"),
        ("DEWA", "100223344500003"),
        ("Aramex", "100334455600003"),
        ("du Telecom", "100445566700003"),
        ("Careem Networks FZ", "100556677800003"),
        ("Emirates NBD", "100667788900003"),
        ("PwC UAE", "100778899000003"),
        ("Al Futtaim Group", "100889900100003"),
        ("ADNOC Distribution", "100990011200003"),
        ("FAB", "100101112200003"),
        ("Office Solutions LLC", "100121314400003"),
        ("Gulf Insurance Co", "100131415500003"),
        ("Emirates Post", "100141516600003"),
        ("Majid Al Futtaim", "100151617700003"),
        ("Transguard Group", "100161718800003"),
    ]
    return [
        {
            "company_id": company_id,
            "name": name,
            "gstin": trn,
            "status": "active",
            "trn_verified": True,
        }
        for name, trn in names_trns
    ]


def ensure_demo_company(sb: Any) -> dict[str, Any]:
    existing = (
        sb.table("companies").select("*").eq("slug", DEMO_SLUG).limit(1).execute().data or []
    )
    if existing:
        company = existing[0]
        print(f"Reusing demo company {company['id']} ({company['name']})")
        return company

    res = (
        sb.table("companies")
        .insert(
            {
                "name": DEMO_NAME,
                "slug": DEMO_SLUG,
                "industry": "trading",
                "accounting_standard": "IFRS",
                "market": "uae",
                "subscription_tier": "growth",
                "subscription_status": "active",
                "max_invoices_per_month": 500,
                "max_users": 10,
            }
        )
        .execute()
    )
    inserted = list(res.data or [])
    if not inserted:
        # Some clients omit returning rows — re-fetch by slug
        inserted = (
            sb.table("companies").select("*").eq("slug", DEMO_SLUG).limit(1).execute().data or []
        )
    if not inserted:
        raise RuntimeError("Failed to create demo company")
    company = inserted[0]
    print(f"Created demo company {company['id']} ({company['name']})")

    try:
        sb.table("company_config").insert({"company_id": company["id"]}).execute()
    except Exception as e:
        print(f"  company_config note: {e}")

    try:
        sb.table("company_settings").insert(
            {
                "company_id": company["id"],
                "company_name": DEMO_NAME,
                "country": "AE",
                "base_currency": "AED",
                "accounting_standard": "IFRS",
                "timezone": "Asia/Dubai",
                "date_format": "DD/MM/YYYY",
                "fy_start": "01-01",
            }
        ).execute()
    except Exception as e:
        print(f"  company_settings note: {e}")

    return company


def refresh_demo_invoices(sb: Any, company_id: str, today: date) -> int:
    # Remove prior DEMO-INV-* for this company only (idempotent refresh)
    prior = (
        sb.table("invoices")
        .select("id,invoice_number")
        .eq("company_id", company_id)
        .like("invoice_number", f"{INVOICE_PREFIX}%")
        .execute()
        .data
        or []
    )
    if prior:
        ids = [r["id"] for r in prior]
        # Clear anomalies first (FK / orphan hygiene)
        for iid in ids:
            try:
                sb.table("invoice_anomalies").delete().eq("invoice_id", iid).execute()
            except Exception:
                pass
        sb.table("invoices").delete().eq("company_id", company_id).like(
            "invoice_number", f"{INVOICE_PREFIX}%"
        ).execute()
        print(f"Removed {len(prior)} prior demo invoices")

    rows = build_demo_invoices(today, company_id)
    inserted = sb.table("invoices").insert(rows).execute().data or []
    print(f"Inserted {len(inserted)} demo invoices")
    return len(inserted)


def refresh_demo_vendors(sb: Any, company_id: str) -> None:
    vendors = build_demo_vendors(company_id)
    for v in vendors:
        try:
            existing = (
                sb.table("vendors")
                .select("id")
                .eq("company_id", company_id)
                .ilike("name", v["name"])
                .limit(1)
                .execute()
                .data
                or []
            )
            if existing:
                continue
            sb.table("vendors").insert(v).execute()
        except Exception as e:
            print(f"  vendor {v['name']}: {e}")


def verify_isolation(demo_id: str) -> None:
    qa = build_cfo_daily_summary(company_id=QA_COMPANY_ID, days=7)
    demo = build_cfo_daily_summary(company_id=demo_id, days=7)

    print("\n=== Isolation check ===")
    print(
        f"QA  ({QA_COMPANY_ID[:8]}…): overdue={qa['overdue_count']}  "
        f"due_week={qa['due_this_week_count']}  outstanding={qa['currency']} {qa['total_outstanding']:,.0f}  "
        f"high_risk={qa['high_risk_flags']}"
    )
    print(
        f"DEMO ({demo_id[:8]}…): overdue={demo['overdue_count']}  "
        f"due_week={demo['due_this_week_count']}  outstanding={demo['currency']} {demo['total_outstanding']:,.0f}  "
        f"high_risk={demo['high_risk_flags']}"
    )

    # Demo must look plausible — not 100/100 overdue
    assert demo["overdue_count"] < 10, f"Demo overdue too high: {demo['overdue_count']}"
    assert demo["due_this_week_count"] >= 1, "Demo should have due-this-week invoices"
    assert demo["total_outstanding"] < 500_000, "Demo outstanding unexpectedly large"

    # QA must still look like the heavy test set (isolation)
    assert qa["overdue_count"] >= 50, "QA dataset looks wiped — abort"
    assert abs(qa["total_outstanding"] - demo["total_outstanding"]) > 100_000, (
        "QA and demo outstanding too similar — possible mix"
    )

    # Cross-check: demo invoice numbers never appear in QA briefing vendors list context
    sb = get_supabase()
    leaked = (
        sb.table("invoices")
        .select("id,invoice_number,company_id")
        .like("invoice_number", f"{INVOICE_PREFIX}%")
        .eq("company_id", QA_COMPANY_ID)
        .execute()
        .data
        or []
    )
    assert not leaked, f"DEMO invoices leaked into QA company: {leaked}"

    qa_inv = (
        sb.table("invoices")
        .select("id", count="exact")
        .eq("company_id", QA_COMPANY_ID)
        .like("invoice_number", "UAE-INV-2025-%")
        .execute()
    )
    qa_count = qa_inv.count if qa_inv.count is not None else len(qa_inv.data or [])
    print(f"QA UAE-INV-2025-* still present: count~{qa_count}")
    assert (qa_count or 0) >= 50, "QA UAE invoices missing"

    print("\nDemo briefing preview:")
    print(f"  HIGH RISK FLAGS: {demo['high_risk_flags']}")
    for b in demo.get("high_risk_flag_breakdown") or []:
        print(f"    - {b['label']}: {b['count']}")
    print(f"  Top vendors: {[v['vendor_name'] for v in (demo.get('top_vendors') or [])]}")
    print("Isolation OK - QA untouched, demo scoped correctly.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    sb = get_supabase()
    today = date.today()

    if args.verify_only:
        existing = (
            sb.table("companies").select("id,name,slug").eq("slug", DEMO_SLUG).limit(1).execute().data
            or []
        )
        if not existing:
            print("Demo company not found — run without --verify-only first")
            return 1
        verify_isolation(existing[0]["id"])
        print(json.dumps({"demo_company_id": existing[0]["id"], "slug": DEMO_SLUG}, indent=2))
        return 0

    # Safety: never touch QA
    company = ensure_demo_company(sb)
    assert company["id"] != QA_COMPANY_ID
    refresh_demo_vendors(sb, company["id"])
    n = refresh_demo_invoices(sb, company["id"], today)
    verify_isolation(company["id"])

    out = {
        "ok": True,
        "demo_company_id": company["id"],
        "demo_slug": DEMO_SLUG,
        "demo_name": DEMO_NAME,
        "invoices_seeded": n,
        "qa_company_id": QA_COMPANY_ID,
        "qa_slug": "my-company",
        "how_to_brief": (
            f"GET/POST /api/ap/cfo-daily-summary with company_id={company['id']} "
            "(or: python scripts/cfo_email_uae.py --company-id {id} --test)"
        ),
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
