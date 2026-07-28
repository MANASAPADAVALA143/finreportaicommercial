"""Create AR invoice from extraction (auto-approve) and verify GL / GulfTax / classifier."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from sqlalchemy import text

from app.core.database import SessionLocal, engine
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine, UAESalesInvoice
from app.services.ar_sales_invoice_service import ARLineItemInput, create_ar_invoice_with_classify

WS = "b5e18ef9-e81b-4312-b895-20eef28a3bb3"
CID = "77905042-bc16-48d0-93f9-50190ad1f9e1"

EXTRACTED = {
    "document_type": "invoice",
    "invoice_number": "INV-2026-0042",
    "invoice_date": "2026-07-15",
    "due_date": "2026-08-14",
    "customer_name": "ABC Trading LLC",
    "customer_trn": "100987654300003",
    "seller_name": "Gnanova UAE Test FZE",
    "seller_trn": "100123456700003",
    "line_items": [
        {
            "description": "Professional consulting services",
            "quantity": 10.0,
            "unit_price": 1000.0,
            "vat_rate": 5.0,
            "line_total": 10500.0,
        }
    ],
    "subtotal": 10000.0,
    "vat_amount": 500.0,
    "total_amount": 10500.0,
    "currency": "AED",
    "payment_terms": "Net 30",
    "notes": "UAE VAT Tax Invoice issued under Federal Decree-Law No. 8 of 2017.",
}


def main() -> None:
    print("db_driver", engine.url.drivername)
    print("db_host", engine.url.host)
    print("db_name", engine.url.database)

    db = SessionLocal()
    try:
        # Prefer Gnanova if present; else first company with 1200/4100/2200
        has = db.execute(
            text("SELECT count(*) FROM ap_companies WHERE id = :c"),
            {"c": CID},
        ).scalar()
        ws, cid = WS, CID
        if not has:
            row = db.execute(
                text(
                    """
                    SELECT company_id FROM uae_accounts
                    WHERE code IN ('1200','4100','2200')
                    GROUP BY company_id HAVING count(DISTINCT code) >= 3
                    LIMIT 1
                    """
                )
            ).fetchone()
            if not row:
                # any tenant from sales invoices
                row2 = db.execute(
                    text(
                        "SELECT tenant_id, company_id FROM uae_sales_invoices "
                        "WHERE company_id IS NOT NULL LIMIT 1"
                    )
                ).fetchone()
                if not row2:
                    raise SystemExit("No company found for AR post test")
                ws, cid = row2[0], row2[1]
            else:
                cid = row[0]
                ws_row = db.execute(
                    text(
                        "SELECT tenant_id FROM uae_accounts WHERE company_id=:c LIMIT 1"
                    ),
                    {"c": cid},
                ).fetchone()
                ws = ws_row[0] if ws_row else "demo"
        print("using workspace", ws, "company", cid)

        line_items = [
            ARLineItemInput(
                description=li["description"],
                qty=float(li["quantity"]),
                unit_price=float(li["unit_price"]),
                vat_rate=float(li["vat_rate"]),
            )
            for li in EXTRACTED["line_items"]
        ]

        result = create_ar_invoice_with_classify(
            db,
            tenant_id=ws,
            company_id=cid,
            customer_name=EXTRACTED["customer_name"],
            customer_trn=EXTRACTED["customer_trn"],
            invoice_date=date.fromisoformat(EXTRACTED["invoice_date"]),
            due_date=date.fromisoformat(EXTRACTED["due_date"]),
            line_items=line_items,
            skip_on_hard_block=False,
            commit=True,
            auto_post=True,
        )
        print("=== CREATE RESULT ===")
        print(
            json.dumps(
                {
                    "success": result.success,
                    "error": result.error,
                    "invoice_id": result.invoice_id,
                    "invoice_number": result.invoice_number,
                    "status": result.status,
                    "posted": result.posted,
                    "je_id": result.je_id,
                    "je_reference": result.je_reference,
                    "gulftax": result.gulftax,
                    "vat_treatment": result.vat_treatment,
                    "gulftax_decision": result.gulftax_decision,
                    "message": result.message,
                },
                indent=2,
                default=str,
            )
        )
        if not result.success or not result.invoice_id:
            raise SystemExit("create/post failed")

        # Prefer extracted invoice number for audit trail (same as create-from-extraction)
        inv = db.query(UAESalesInvoice).filter_by(id=result.invoice_id).first()
        if inv:
            inv.invoice_number = EXTRACTED["invoice_number"]
            inv.vat_treatment = "standard_rated"
            db.add(inv)
            db.commit()
            db.refresh(inv)

        inv = db.query(UAESalesInvoice).filter_by(id=result.invoice_id).first()
        print("=== UAE_SALES_INVOICES ===")
        print(
            json.dumps(
                {
                    "id": inv.id,
                    "invoice_number": inv.invoice_number,
                    "status": inv.status,
                    "journal_entry_id": inv.journal_entry_id,
                    "subtotal": float(inv.subtotal or 0),
                    "vat_amount": float(inv.vat_amount or 0),
                    "total_amount": float(inv.total_amount or 0),
                    "vat_treatment": inv.vat_treatment,
                },
                indent=2,
            )
        )

        je_id = inv.journal_entry_id
        lines = []
        if je_id:
            je = db.query(UAEJournalEntry).filter_by(id=je_id).first()
            jlines = (
                db.query(UAEJournalLine)
                .filter(UAEJournalLine.journal_entry_id == je_id)
                .all()
            )
            for ln in jlines:
                lines.append(
                    {
                        "account_code": ln.account_code,
                        "account_name": ln.account_name,
                        "debit": float(ln.debit or 0),
                        "credit": float(ln.credit or 0),
                    }
                )
            print("=== UAE_JOURNAL_ENTRIES ===")
            print(
                json.dumps(
                    {
                        "je_id": je_id,
                        "entry_number": getattr(je, "entry_number", None),
                        "status": getattr(je, "status", None),
                        "lines": lines,
                    },
                    indent=2,
                )
            )

        gt = db.execute(
            text(
                """
                SELECT id, direction, source, status, invoice_number,
                       gross_amount, vat_amount,
                       (gross_amount - vat_amount) AS net_amount,
                       vendor_name, transaction_date
                FROM gulftax_transactions
                WHERE company_id = :c
                  AND (invoice_number = :inv OR id::text = :gtxid)
                ORDER BY created_at DESC NULLS LAST
                LIMIT 5
                """
            ),
            {
                "c": cid,
                "inv": EXTRACTED["invoice_number"],
                "gtxid": str((result.gulftax or {}).get("gulftax_transaction_id") or ""),
            },
        ).mappings().fetchall()
        # Fallback: latest for company matching amounts
        if not gt:
            gt = db.execute(
                text(
                    """
                    SELECT id, direction, source, status, invoice_number,
                           gross_amount, vat_amount,
                           (gross_amount - vat_amount) AS net_amount,
                           vendor_name, transaction_date, created_at
                    FROM gulftax_transactions
                    WHERE company_id = :c
                      AND ABS(COALESCE(gross_amount,0) - 10500) < 0.05
                    ORDER BY created_at DESC NULLS LAST
                    LIMIT 5
                    """
                ),
                {"c": cid},
            ).mappings().fetchall()
        print("=== GULFTAX_TRANSACTIONS ===")
        print(json.dumps([dict(r) for r in gt], indent=2, default=str))

        # Classifier table may be ported DB — try both
        classifier_rows = []
        try:
            classifier_rows = db.execute(
                text(
                    """
                    SELECT id, company_id, invoice_number, direction, transaction_type,
                           gross_amount, vat_amount, net_amount, source
                    FROM transactions
                    WHERE invoice_number = :inv
                       OR (ABS(COALESCE(gross_amount,0) - 10500) < 0.05)
                    ORDER BY created_at DESC NULLS LAST
                    LIMIT 5
                    """
                ),
                {"inv": EXTRACTED["invoice_number"]},
            ).mappings().fetchall()
        except Exception as exc:
            db.rollback()
            print("classifier_main_db_err", str(exc)[:120])

        if not classifier_rows:
            try:
                from app.modules.gulftax.ported.database import SessionLocal as PortedSessionLocal

                pdb = PortedSessionLocal()
                try:
                    classifier_rows = pdb.execute(
                        text(
                            """
                            SELECT id, company_id, invoice_number, direction,
                                   COALESCE(transaction_type, transaction_kind) AS transaction_type,
                                   gross_amount, vat_amount,
                                   COALESCE(net_amount, gross_amount - vat_amount) AS net_amount,
                                   source
                            FROM transactions
                            WHERE invoice_number = :inv
                               OR ABS(COALESCE(gross_amount,0) - 10500) < 0.05
                            ORDER BY created_at DESC NULLS LAST
                            LIMIT 5
                            """
                        ),
                        {"inv": EXTRACTED["invoice_number"]},
                    ).mappings().fetchall()
                finally:
                    pdb.close()
            except Exception as exc:
                print("classifier_ported_err", str(exc)[:200])

        print("=== VAT_CLASSIFIER / transactions ===")
        print(json.dumps([dict(r) for r in classifier_rows], indent=2, default=str))

        # Checks
        codes = {ln["account_code"]: ln for ln in lines}
        checks = {
            "dr_1200_10500": abs(codes.get("1200", {}).get("debit", 0) - 10500) < 0.05,
            "cr_4100_10000": abs(codes.get("4100", {}).get("credit", 0) - 10000) < 0.05,
            "cr_2200_500": abs(codes.get("2200", {}).get("credit", 0) - 500) < 0.05,
            "invoice_posted": (inv.status or "") == "posted",
            "journal_entry_id_set": bool(inv.journal_entry_id),
            "gulftax_output": any(str(r.get("direction") or "").lower() == "output" for r in gt),
            "gulftax_amounts": any(
                abs(float(r.get("gross_amount") or 0) - 10500) < 0.05
                and abs(float(r.get("vat_amount") or 0) - 500) < 0.05
                for r in gt
            ),
            "gulftax_source_ar": any(
                "ar" in str(r.get("source") or "").lower() for r in gt
            ),
            "classifier_present": len(classifier_rows) > 0,
        }
        print("=== CHECKS ===")
        print(json.dumps(checks, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()
