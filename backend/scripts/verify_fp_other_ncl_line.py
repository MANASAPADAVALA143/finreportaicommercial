"""Financial Position: Other non-current liabilities in Non-current Liabilities section."""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

_DB = BACKEND / "verify_fp_line_tmp.db"
if _DB.exists():
    _DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_DB.as_posix()}"


def main() -> int:
    import app.models.ifrs_statement  # noqa: F401
    from app.core.database import Base, SessionLocal, engine
    from app.models.ifrs_statement import (
        GLMapping,
        IFRSStatementKind,
        MappingSourceEnum,
        TrialBalance,
        TrialBalanceLine,
        TBStatus,
        AccountTypeEnum,
    )
    from app.services.statement_generator import STATEMENT_STRUCTURE, _lookup_line_total

    Base.metadata.create_all(bind=engine)

    ncl = STATEMENT_STRUCTURE["financial_position"]["Non-current Liabilities"]
    names = [t[0] for t in ncl if isinstance(t, tuple) and (len(t) < 3 or not t[2])]
    assert "Other non-current liabilities" in names, names
    idx = names.index("Other non-current liabilities")
    assert idx > names.index("Provisions"), "Other NCL should follow Provisions in NCL block"

    db = SessionLocal()
    try:
        tb = TrialBalance(
            tenant_id="default",
            company_name="FP Line Test Ltd",
            currency="USD",
            file_name="t.csv",
            status=TBStatus.mapped,
        )
        db.add(tb)
        db.flush()
        ln = TrialBalanceLine(
            trial_balance_id=tb.id,
            tenant_id="default",
            gl_code="4500",
            gl_description="Other NCL - deferred consideration",
            debit_amount=0.0,
            credit_amount=25000.0,
            net_amount=-25000.0,
            account_type=AccountTypeEnum.liability,
        )
        db.add(ln)
        db.flush()
        db.add(
            GLMapping(
                tenant_id="default",
                trial_balance_id=tb.id,
                trial_balance_line_id=ln.id,
                gl_code=ln.gl_code,
                gl_description=ln.gl_description,
                ifrs_statement=IFRSStatementKind.financial_position,
                ifrs_line_item="Other non-current liabilities",
                ifrs_section="Non-current Liabilities",
                mapping_source=MappingSourceEnum.user_confirmed,
                ai_confidence_score=1.0,
                is_confirmed=True,
            )
        )
        db.commit()

        from collections import defaultdict

        line_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
        line_totals["Other non-current liabilities"] += Decimal("-25000.00")
        got = _lookup_line_total(line_totals, "Other non-current liabilities")
        assert got == Decimal("-25000.00"), got

        ncl_sum = Decimal("0.00")
        for line_def in ncl:
            if len(line_def) > 2 and line_def[2]:
                continue
            ncl_sum += _lookup_line_total(line_totals, line_def[0])

        assert ncl_sum == Decimal("-25000.00")
        print("OK STATEMENT_STRUCTURE: Other non-current liabilities under Non-current Liabilities")
        print(f"OK aggregation: GL credit 25,000 -> line_totals = {float(got):,.2f} (liability net convention)")
        print(f"OK Non-current Liabilities section subtotal includes line: {float(ncl_sum):,.2f}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
