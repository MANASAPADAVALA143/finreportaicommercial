"""Create sample AR bulk import file and run import test."""
from __future__ import annotations

import io
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from unittest.mock import patch

# Ensure backend is on path
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.core.database import SessionLocal
from app.services.ar_bulk_import_service import run_ar_bulk_import

TODAY = date.today().isoformat()
DUE = (date.today() + timedelta(days=30)).isoformat()

ROWS = [
    {
        "Customer Name": "Acme Trading LLC",
        "Buyer TRN": "100000000000003",
        "Invoice Date": TODAY,
        "Due Date": DUE,
        "Description": "Consulting services",
        "Amount AED": 5000,
    },
    {
        "Customer Name": "Beta Supplies FZE",
        "Buyer TRN": "100000000000003",
        "Invoice Date": TODAY,
        "Due Date": DUE,
        "Description": "Equipment rental",
        "Amount AED": 3200,
    },
    {
        "Customer Name": "Gamma Retail",
        "Buyer TRN": "",
        "Invoice Date": TODAY,
        "Due Date": DUE,
        "Description": "POS software license",
        "Amount AED": 1800,
    },
    {
        "Customer Name": "Delta Corp",
        "Buyer TRN": "12345",
        "Invoice Date": TODAY,
        "Due Date": DUE,
        "Description": "Should HARD_BLOCK — bad TRN",
        "Amount AED": 2500,
    },
    {
        "Customer Name": "",
        "Buyer TRN": "",
        "Invoice Date": TODAY,
        "Due Date": DUE,
        "Description": "Missing customer name",
        "Amount AED": 1000,
    },
]


def build_xlsx() -> bytes:
    df = pd.DataFrame(ROWS)
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


def main() -> None:
    content = build_xlsx()
    out_path = BACKEND / "test_ar_bulk_sample.xlsx"
    out_path.write_bytes(content)
    print(f"Sample file written: {out_path}")

    db = SessionLocal()
    try:
        with patch(
            "app.services.ar_sales_invoice_service.post_sales_invoice_to_gl_and_tax",
            return_value={"ok": True, "je_id": "TEST-JE", "je_reference": "JE-TEST", "gulftax": None},
        ):
            result = run_ar_bulk_import(
                db,
                content=content,
                filename="test_ar_bulk_sample.xlsx",
                tenant_id="demo",
                company_id="d32b6510-08c8-4c5b-b3c3-5994ce96bc7e",
            )
        print("\n=== BULK IMPORT RESULT ===")
        for k, v in result.items():
            if k != "column_map":
                print(f"{k}: {v}")
        print(f"column_map: {result.get('column_map')}")

        expected_imported = 3
        expected_hard_block = 1
        expected_errors = 1

        ok = True
        if result["imported"] != expected_imported:
            print(f"FAIL: expected imported={expected_imported}, got {result['imported']}")
            ok = False
        if len(result["skipped_hard_block"]) != expected_hard_block:
            print(f"FAIL: expected skipped_hard_block={expected_hard_block}, got {len(result['skipped_hard_block'])}")
            ok = False
        if len(result["skipped_errors"]) != expected_errors:
            print(f"FAIL: expected skipped_errors={expected_errors}, got {len(result['skipped_errors'])}")
            ok = False

        if ok:
            print("\nPASS: All summary counts match expected (3 imported, 1 HARD_BLOCK skip, 1 validation skip)")
        else:
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
