"""
Tenant template pre-fill check (isolated SQLite — no init_db / ensure_seed_data).

Run from backend/:
  python scripts/verify_tenant_prefill.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Must set before any app.core.database import
_DB_PATH = BACKEND / "verify_tenant_tmp.db"
if _DB_PATH.exists():
    _DB_PATH.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH.as_posix()}"

SAMPLE_CSV = b"""Account Code,Account Name,Debit,Credit
1001,Cash in Bank,50000,0
6001,Sales Revenue,0,120000
7001,Cost of Goods Sold,45000,0
"""


def _bootstrap_ifrs_tables() -> None:
    import app.models.ifrs_statement  # noqa: F401
    from app.core.database import Base, engine

    Base.metadata.create_all(bind=engine)


def run_tenant(tenant_id: str) -> None:
    from app.core.database import SessionLocal
    from app.models.ifrs_statement import (
        GLMapping,
        MappingSourceEnum,
        MappingTemplate,
        TrialBalance,
        TrialBalanceLine,
        TBStatus,
    )
    from app.services.gl_mapping_ai import (
        apply_template_mappings_first,
        clear_unlocked_gl_mappings,
        infer_account_type,
    )
    from app.services.tb_column_mapper import (
        load_trial_balance_dataframe,
        resolve_trial_balance_dataframe,
        trial_balance_dataframe_to_rows,
    )

    db = SessionLocal()
    try:
        db.query(MappingTemplate).filter(MappingTemplate.tenant_id == tenant_id).delete(
            synchronize_session=False
        )
        for tb in db.query(TrialBalance).filter(TrialBalance.tenant_id == tenant_id).all():
            db.delete(tb)
        db.commit()

        db.add(
            MappingTemplate(
                tenant_id=tenant_id,
                template_name=f"CoA {tenant_id}",
                is_default=True,
                entries=[
                    {
                        "gl_code": "1001",
                        "gl_description": "Cash in Bank",
                        "ifrs_statement": "financial_position",
                        "ifrs_section": "Current Assets",
                        "ifrs_line_item": "Cash and cash equivalents",
                    },
                    {
                        "gl_code": "6001",
                        "gl_description": "Sales Revenue",
                        "ifrs_statement": "profit_loss",
                        "ifrs_section": "Revenue",
                        "ifrs_line_item": "Revenue from contracts with customers",
                    },
                ],
            )
        )
        db.commit()

        df = load_trial_balance_dataframe("verify_tb.csv", SAMPLE_CSV)
        df, cmap = resolve_trial_balance_dataframe(df)
        rows, missing = trial_balance_dataframe_to_rows(df, cmap)
        assert not missing and rows, missing

        tb = TrialBalance(
            tenant_id=tenant_id,
            company_name="Verify Entity",
            currency="USD",
            file_name="verify_tb.csv",
            status=TBStatus.uploaded,
        )
        db.add(tb)
        db.flush()
        lines = []
        for r in rows:
            net = float(r["debit_amount"]) - float(r["credit_amount"])
            ln = TrialBalanceLine(
                trial_balance_id=tb.id,
                tenant_id=tenant_id,
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
            db.add(ln)
            lines.append(ln)
        db.commit()
        for ln in lines:
            db.refresh(ln)

        clear_unlocked_gl_mappings(db, tb.id)
        n = apply_template_mappings_first(db, tenant_id, tb, lines)
        assert n == 2, f"tenant {tenant_id}: expected 2 template rows, got {n}"

        by_code = {
            m.gl_code: m
            for m in db.query(GLMapping).filter(GLMapping.trial_balance_id == tb.id).all()
        }
        assert by_code["1001"].mapping_source == MappingSourceEnum.template_suggested
        assert by_code["6001"].mapping_source == MappingSourceEnum.template_suggested
        assert "7001" not in by_code
        print(f"OK tenant={tenant_id!r}: 2 template_suggested, 7001 left for AI")
    finally:
        db.close()


def main() -> int:
    print("=== Tenant template pre-fill verification ===")
    _bootstrap_ifrs_tables()
    run_tenant("default")
    run_tenant("demo-client-acme")
    print("All tenant pre-fill checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
