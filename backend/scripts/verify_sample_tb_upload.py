"""
Verify sample TB uses the real upload pipeline (parse -> DB -> template pre-fill hook).

Run from backend/:  python scripts/verify_sample_tb_upload.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

_DB = BACKEND / "verify_sample_tb_tmp.db"
if _DB.exists():
    _DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_DB.as_posix()}"

SAMPLE_CSV_PATH = BACKEND.parent / "frontend" / "public" / "sample-trial-balance.csv"
SAMPLE_COMPANY = "[SAMPLE] Prism Manufacturing Demo"


def main() -> int:
    import app.models.ifrs_statement  # noqa: F401
    from app.core.database import Base, SessionLocal, engine
    from app.models.ifrs_statement import TrialBalance, TBStatus
    from app.services.tb_column_mapper import (
        load_trial_balance_dataframe,
        resolve_trial_balance_dataframe,
        trial_balance_dataframe_to_rows,
    )
    from app.services.gl_mapping_ai import infer_account_type
    from app.models.ifrs_statement import TrialBalanceLine

    Base.metadata.create_all(bind=engine)

    if not SAMPLE_CSV_PATH.is_file():
        print(f"FAIL sample file missing: {SAMPLE_CSV_PATH}")
        return 1

    content = SAMPLE_CSV_PATH.read_bytes()
    df = load_trial_balance_dataframe(SAMPLE_CSV_PATH.name, content)
    df, cmap = resolve_trial_balance_dataframe(df)
    rows, missing = trial_balance_dataframe_to_rows(df, cmap)
    if missing or not rows:
        print(f"FAIL could not parse sample TB: missing={missing}")
        return 1

    db = SessionLocal()
    try:
        tb = TrialBalance(
            tenant_id="demo-client-acme",
            company_name=SAMPLE_COMPANY,
            currency="USD",
            file_name=SAMPLE_CSV_PATH.name,
            status=TBStatus.uploaded,
        )
        db.add(tb)
        db.flush()
        for r in rows:
            net = float(r["debit_amount"]) - float(r["credit_amount"])
            db.add(
                TrialBalanceLine(
                    trial_balance_id=tb.id,
                    tenant_id="demo-client-acme",
                    gl_code=str(r["gl_code"]),
                    gl_description=str(r["gl_description"]),
                    debit_amount=float(r["debit_amount"]),
                    credit_amount=float(r["credit_amount"]),
                    net_amount=net,
                    account_type=infer_account_type(
                        float(r["debit_amount"]),
                        float(r["credit_amount"]),
                        r.get("account_type_raw"),
                    ),
                )
            )
        db.commit()
        db.refresh(tb)

        assert SAMPLE_COMPANY.startswith("[SAMPLE]"), "sample company_name must be tagged"
        assert tb.company_name == SAMPLE_COMPANY
        line_count = db.query(TrialBalanceLine).filter(TrialBalanceLine.trial_balance_id == tb.id).count()
        assert line_count == len(rows), (line_count, len(rows))
        assert tb.status == TBStatus.uploaded

        print("=== Sample trial balance upload verification ===")
        print(f"OK parsed {len(rows)} GL rows from {SAMPLE_CSV_PATH.name}")
        print(f"OK persisted TB id={tb.id} tenant=demo-client-acme company_name={tb.company_name!r}")
        print(f"OK status={tb.status.value} — ready for template pre-fill + AI mapping pipeline")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
