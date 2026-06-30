"""
Verify onboarding fixes: 30/30 dot-path translator, otherNonCurrent mapping,
template pre-fill per tenant (including non-default).

Run: cd backend && python scripts/verify_onboarding_template_prefill.py
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Canonical 30 dot-paths from frontend mappingService IFRS_LINE_ITEMS
IFRS_LINE_ITEM_DOT_PATHS = [
    "financialPosition.assets.current.cashAndEquivalents",
    "financialPosition.assets.current.tradeReceivables",
    "financialPosition.assets.current.inventories",
    "financialPosition.assets.current.prepayments",
    "financialPosition.assets.current.otherCurrent",
    "financialPosition.assets.nonCurrent.propertyPlantEquipment",
    "financialPosition.assets.nonCurrent.intangibleAssets",
    "financialPosition.assets.nonCurrent.investments",
    "financialPosition.assets.nonCurrent.otherNonCurrent",
    "financialPosition.liabilities.current.tradePayables",
    "financialPosition.liabilities.current.shortTermBorrowings",
    "financialPosition.liabilities.current.accruedExpenses",
    "financialPosition.liabilities.current.otherCurrent",
    "financialPosition.liabilities.nonCurrent.borrowings",
    "financialPosition.liabilities.nonCurrent.deferredTax",
    "financialPosition.liabilities.nonCurrent.provisions",
    "financialPosition.liabilities.nonCurrent.otherNonCurrent",
    "financialPosition.equity.shareCapital",
    "financialPosition.equity.retainedEarnings",
    "financialPosition.equity.otherReserves",
    "profitLoss.revenue",
    "profitLoss.costOfSales",
    "profitLoss.operatingExpenses.employeeBenefits",
    "profitLoss.operatingExpenses.administrative",
    "profitLoss.operatingExpenses.distribution",
    "profitLoss.operatingExpenses.depreciation",
    "profitLoss.operatingExpenses.other",
    "profitLoss.financeIncome",
    "profitLoss.financeCosts",
    "profitLoss.incomeTax",
]

SAMPLE_CSV = """Account Code,Account Name,Debit,Credit
1001,Cash in Bank,50000,0
6001,Sales Revenue,0,120000
7001,Cost of Goods Sold,45000,0
"""


def main() -> int:
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
    from app.services.ifrs_dot_path_translate import translate_dot_path
    from app.services.seed_ifrs_master import upsert_missing_master_lines
    from app.services.tb_column_mapper import (
        load_trial_balance_dataframe,
        resolve_trial_balance_dataframe,
        trial_balance_dataframe_to_rows,
    )

    print("=== IFRS onboarding verification ===\n")

    # 1) 30/30 dot-path translator
    failed_paths = []
    for path in IFRS_LINE_ITEM_DOT_PATHS:
        tr = translate_dot_path(path)
        if not tr["ok"]:
            failed_paths.append(path)
    assert len(IFRS_LINE_ITEM_DOT_PATHS) == 30, "expected 30 canonical dot-paths"
    if failed_paths:
        print(f"FAIL: {len(failed_paths)} dot-paths unmapped: {failed_paths}")
        return 1
    print("OK 30/30 dot-paths resolve to master triples")

    # 2) otherNonCurrent liability explicit check
    tr = translate_dot_path("financialPosition.liabilities.nonCurrent.otherNonCurrent")
    assert tr["ok"]
    assert tr["ifrs_statement"] == "financial_position"
    assert tr["ifrs_section"] == "Non-current Liabilities"
    assert tr["ifrs_line_item"] == "Other non-current liabilities"
    print("OK otherNonCurrent -> financial_position / Non-current Liabilities / Other non-current liabilities")

    db = SessionLocal()
    try:
        upsert_missing_master_lines(db)

        def run_tenant_scenario(tenant_id: str) -> None:
            db.query(MappingTemplate).filter(MappingTemplate.tenant_id == tenant_id).delete()
            for tb in db.query(TrialBalance).filter(TrialBalance.tenant_id == tenant_id).all():
                db.delete(tb)
            db.commit()

            entries = [
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
            ]
            tmpl = MappingTemplate(
                tenant_id=tenant_id,
                template_name=f"CoA {tenant_id}",
                is_default=True,
                entries=entries,
            )
            db.add(tmpl)
            db.commit()

            df = load_trial_balance_dataframe("verify_tb.csv", SAMPLE_CSV.encode())
            df, cmap = resolve_trial_balance_dataframe(df)
            rows, missing = trial_balance_dataframe_to_rows(df, cmap)
            assert not missing and rows

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

            mappings = db.query(GLMapping).filter(GLMapping.trial_balance_id == tb.id).all()
            by_code = {m.gl_code: m for m in mappings}
            assert by_code["1001"].mapping_source == MappingSourceEnum.template_suggested
            assert by_code["6001"].mapping_source == MappingSourceEnum.template_suggested
            assert "7001" not in by_code
            print(f"OK tenant={tenant_id!r}: template pre-fill (2 template_suggested, 7001 left for AI)")

        run_tenant_scenario("default")
        run_tenant_scenario("demo-client-acme")

        print("\nAll verification checks passed.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
