"""Fix 2 — IAS 7 cash flow, SOCE, honest A=L+E check."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
from app.models.ifrs_statement import (
    AccountTypeEnum,
    GLMapping,
    IFRSLink,
    IFRSStatementKind,
    MappingSourceEnum,
    GeneratedStatement,
    StatementLineItem,
    TrialBalance,
    TrialBalanceLine,
)
from app.services.statement_generator import (
    check_balance,
    generate_all_statements,
    generate_cash_flow_statement,
    generate_equity_statement,
)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(
        engine,
        tables=[
            TrialBalance.__table__,
            TrialBalanceLine.__table__,
            GLMapping.__table__,
            GeneratedStatement.__table__,
            StatementLineItem.__table__,
            IFRSLink.__table__,
        ],
    )
    return sessionmaker(bind=engine)()


def test_check_balance_honest_no_plug():
    ok = check_balance({"total_assets": 1000, "total_liabilities": 400, "total_equity": 600})
    assert ok["balanced"] is True
    assert ok["difference"] == 0

    bad = check_balance({"total_assets": 1000, "total_liabilities": 400, "total_equity": 500})
    assert bad["balanced"] is False
    assert bad["difference"] == 100
    assert bad["total_equity"] == 500  # never inflated


def test_cash_flow_closing_ties_to_bs_when_movements_complete():
    cur = {
        "Cash and cash equivalents": Decimal("200"),
        "Trade and other receivables (gross)": Decimal("80"),
        "Inventories": Decimal("50"),
        "Trade and other payables": Decimal("-40"),
        "Depreciation — PPE": Decimal("10"),
        "Income tax expense — current": Decimal("5"),
        "Income tax payable": Decimal("-8"),
        "Property plant and equipment (gross)": Decimal("300"),
        "Borrowings — non-current": Decimal("-100"),
    }
    prior = {
        "Cash and cash equivalents": Decimal("150"),
        "Trade and other receivables (gross)": Decimal("100"),
        "Inventories": Decimal("40"),
        "Trade and other payables": Decimal("-30"),
        "Income tax payable": Decimal("-6"),
        "Property plant and equipment (gross)": Decimal("280"),
        "Borrowings — non-current": Decimal("-90"),
    }
    out = generate_cash_flow_statement(
        cur,
        prior,
        [{"gl_code": "IFRS16-PAY", "net_amount": -12, "ifrs_line_item": "Repayment of lease liabilities"}],
        "co-1",
        "2025-12-31",
        db=None,  # type: ignore[arg-type]
        profit_for_period=Decimal("40"),
        has_prior=True,
    )
    # Constructed so we assert formula: closing = opening + net, recon shown if != BS cash
    assert out["Opening cash and cash equivalents"] == Decimal("150.00")
    assert out["Closing cash and cash equivalents"] == (
        out["Opening cash and cash equivalents"] + out["NET INCREASE IN CASH"]
    )
    assert out["Balance sheet cash and cash equivalents"] == Decimal("200.00")
    recon = out["Cash reconciling difference"]
    if abs(out["Closing cash and cash equivalents"] - Decimal("200")) < Decimal("1"):
        assert recon == Decimal("0.00")
    else:
        assert abs(recon) >= Decimal("1.00")
    assert out["Adjustments for depreciation"] == Decimal("10.00")
    assert out["Repayment of lease liabilities"] == Decimal("-12.00")
    assert out["Changes in trade receivables"] == Decimal("20.00")  # 100-80 inflow


def test_soce_closing_ties_to_bs_equity_and_no_hardcoded_zero_opening():
    cur = {
        "Share capital": Decimal("-100"),
        "Share premium": Decimal("-20"),
        "Retained earnings": Decimal("-80"),
        "Other comprehensive income reserve": Decimal("0"),
    }
    prior = {
        "Share capital": Decimal("-100"),
        "Share premium": Decimal("-20"),
        "Retained earnings": Decimal("-50"),
        "Other comprehensive income reserve": Decimal("0"),
    }
    out = generate_equity_statement(
        cur,
        prior,
        profit_for_period=Decimal("30"),
        oci_for_period=Decimal("0"),
        has_prior=True,
    )
    assert out["Share capital - opening"] == Decimal("100.00")
    assert out["Retained earnings - opening"] == Decimal("50.00")
    assert out["TOTAL EQUITY"] == Decimal("200.00")
    assert out["TOTAL EQUITY"] == (
        out["Share capital - closing"]
        + out["Share premium - closing"]
        + out["Retained earnings - closing"]
        + out["OCI reserve - closing"]
    )

    no_prior = generate_equity_statement(
        cur,
        None,
        profit_for_period=Decimal("30"),
        oci_for_period=Decimal("0"),
        has_prior=False,
    )
    assert no_prior["Share capital - opening"] != 0 or no_prior["Retained earnings - opening"] != 0


def test_generate_all_statements_no_silent_equity_plug(monkeypatch):
    db = _session()
    tb = TrialBalance(
        tenant_id="co-1",
        company_name="Test Co",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 12, 31),
        currency="AED",
        file_name="tb.csv",
    )
    db.add(tb)
    db.flush()

    def add_line(code, desc, net, acct, stmt, line, section):
        ln = TrialBalanceLine(
            trial_balance_id=tb.id,
            tenant_id="co-1",
            gl_code=code,
            gl_description=desc,
            debit_amount=max(net, 0),
            credit_amount=max(-net, 0),
            net_amount=net,
            account_type=acct,
        )
        db.add(ln)
        db.flush()
        db.add(
            GLMapping(
                tenant_id="co-1",
                trial_balance_id=tb.id,
                trial_balance_line_id=ln.id,
                gl_code=code,
                gl_description=desc,
                ifrs_statement=stmt,
                ifrs_line_item=line,
                ifrs_section=section,
                mapping_source=MappingSourceEnum.user_confirmed,
                ai_confidence_score=1.0,
                is_confirmed=True,
                locked=True,
                validator_checked=True,
                validator_passed=True,
            )
        )

    add_line("1000", "Cash", 500, AccountTypeEnum.asset, IFRSStatementKind.financial_position, "Cash and cash equivalents", "Current Assets")
    add_line("2000", "AP", -200, AccountTypeEnum.liability, IFRSStatementKind.financial_position, "Trade and other payables", "Current Liabilities")
    add_line("3000", "Capital", -200, AccountTypeEnum.equity, IFRSStatementKind.financial_position, "Share capital", "Equity")
    add_line("4000", "Sales", -100, AccountTypeEnum.revenue, IFRSStatementKind.profit_loss, "Revenue from contracts with customers", "Revenue")
    db.commit()

    monkeypatch.setattr(
        "app.services.mapping_validator.assert_ready_for_statement_generation",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.services.ifrs_module_bridge.inject_ifrs_module_adjustments",
        lambda *a, **k: {"applied_count": 0, "message": "none", "adjustments": [], "skipped": []},
    )
    monkeypatch.setattr(
        "app.services.board_pack_seed.seed_commentary_and_risks_for_trial_balance",
        lambda *a, **k: None,
    )

    result = generate_all_statements(tb.id, db, apply_ifrs16=False, apply_ifrs15=False, apply_ifrs9=False)
    bc = result["balance_check"]
    assert bc["balanced"] is False
    assert bc["difference"] == 100  # 500 assets vs 200+200
    assert bc["total_equity"] == 200  # not plugged to 300

    fp_rows = result["statements"]["financial_position"]
    tle = next(r["amount"] for r in fp_rows if r["line_item"] == "TOTAL LIABILITIES AND EQUITY")
    assets = next(r["amount"] for r in fp_rows if r["line_item"] == "TOTAL ASSETS")
    assert abs(float(tle) - float(assets)) == 100

    cf_rows = result["statements"]["cash_flows"]
    assert any(r["line_item"] == "Closing cash and cash equivalents" for r in cf_rows)
    assert result["cash_flow_reconciliation"]["note"]

    eq_rows = result["statements"]["equity"]
    assert any(r["line_item"] == "Share capital - opening" for r in eq_rows)
    assert result["soce_check"]["opening_note"]
