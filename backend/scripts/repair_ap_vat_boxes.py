"""One-shot repair: AP gulftax_transactions wrongly on Box 1 → Box 9 (treatment-aware).

Usage (on EC2 / local with DATABASE_URL):
  cd backend
  python -m scripts.repair_ap_vat_boxes
  python -m scripts.repair_ap_vat_boxes --company-id <uuid>
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("repair_ap_vat_boxes")


def repair(*, company_id: str | None = None) -> dict:
    from app.core.database import SessionLocal
    from app.models.client_data import GulftaxTransaction
    from app.services.vat_box_mapping import assign_fta_box, normalize_transaction_side

    db = SessionLocal()
    fixed = 0
    scanned = 0
    try:
        q = db.query(GulftaxTransaction)
        if company_id:
            q = q.filter(GulftaxTransaction.company_id == company_id)
        rows = q.all()
        for row in rows:
            scanned += 1
            src = (row.source or "").lower()
            side = normalize_transaction_side(
                None,
                direction=row.direction,
                source=src,
            )
            # AP / purchase rows must not sit on sales boxes
            is_ap = side == "purchase" or src in (
                "ap_invoiceflow",
                "ap_invoice",
                "ap",
            )
            if not is_ap:
                continue
            expected = (
                assign_fta_box(
                    "purchase",
                    row.vat_category,
                    source="ap_invoiceflow",
                    direction="input",
                )
                or "box9"
            )
            cur = (row.fta_box or "").lower()
            wrong_sales_box = cur in ("box1", "box2", "box3", "box4", "box5", "1", "2", "3", "4", "5")
            direction_wrong = (row.direction or "").lower() == "output"
            if wrong_sales_box or direction_wrong or (cur and cur != expected.lower()):
                if wrong_sales_box or cur != expected.lower():
                    row.fta_box = expected
                if direction_wrong or (row.direction or "").lower() != "input":
                    row.direction = "input"
                db.add(row)
                fixed += 1
        db.commit()
        logger.info("scanned=%s fixed=%s company_id=%s", scanned, fixed, company_id or "ALL")
        return {"scanned": scanned, "fixed": fixed, "company_id": company_id}
    except Exception:
        db.rollback()
        logger.exception("repair failed")
        raise
    finally:
        db.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--company-id", default=None)
    args = p.parse_args()
    print(repair(company_id=args.company_id))


if __name__ == "__main__":
    main()
