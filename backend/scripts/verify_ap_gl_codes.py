"""Verify AP GL post uses canonical UAE CoA codes after Fix 3."""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv

load_dotenv(_BACKEND / ".env", override=True)

from app.core.database import SessionLocal
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine
from app.services.ap_invoice_post_service import (
    AP_EXPENSE_DEFAULT,
    AP_PAYABLE_CODE,
    AP_VAT_INPUT_CODE,
)


def main() -> None:
    db = SessionLocal()
    try:
        jes = (
            db.query(UAEJournalEntry)
            .filter(UAEJournalEntry.source == "AP_INVOICE")
            .order_by(UAEJournalEntry.created_at.desc())
            .limit(5)
            .all()
        )
        if not jes:
            print("No AP_INVOICE journal entries found.")
            return

        print(f"Latest {len(jes)} AP_INVOICE journal entry(ies):\n")
        for je in jes:
            lines = (
                db.query(UAEJournalLine)
                .filter(UAEJournalLine.journal_entry_id == je.id)
                .all()
            )
            codes = [ln.account_code for ln in lines]
            print(f"  {je.entry_number} | ref={je.reference} | codes={codes}")
            legacy = {"6100", "2100", "1810"} & set(codes)
            canonical = {AP_EXPENSE_DEFAULT, AP_PAYABLE_CODE, AP_VAT_INPUT_CODE} & set(codes)
            if legacy:
                print(f"    WARNING: legacy codes still present: {legacy}")
            if canonical:
                print(f"    OK: canonical UAE CoA codes: {canonical}")

        latest = jes[0]
        line_count = db.query(UAEJournalLine).filter(UAEJournalLine.journal_entry_id == latest.id).count()
        print(f"\nLatest JE line count: {line_count} (expected 2 or 3 for single combined JE)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
