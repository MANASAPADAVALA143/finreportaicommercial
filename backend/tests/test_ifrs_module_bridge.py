"""IFRS 16/15/9 → financial statement TB injection bridge."""
from __future__ import annotations

from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
from app.models.ifrs15_contract import IFRS15Contract
from app.models.ifrs16_lease import IFRS16Lease
from app.models.ifrs9_ecl import IFRS9Asset, IFRS9Portfolio
from app.models.ifrs_statement import (
    AccountTypeEnum,
    GLMapping,
    IFRSLink,
    IFRSStatementKind,
    MappingSourceEnum,
    StatementLineItem,
    TrialBalance,
    TrialBalanceLine,
    GeneratedStatement,
)
from app.services.ifrs_module_bridge import (
    enrich_tb_data_from_ifrs_modules,
    inject_ifrs_module_adjustments,
    preview_ifrs_module_adjustments,
)
from app.services.statement_generator import inject_ifrs_module_adjustments as sg_inject


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
            IFRS16Lease.__table__,
            IFRS15Contract.__table__,
            IFRS9Portfolio.__table__,
            IFRS9Asset.__table__,
        ],
    )
    return sessionmaker(bind=engine)()


def _tb(db: Session, tenant: str = "co-1") -> TrialBalance:
    tb = TrialBalance(
        tenant_id=tenant,
        company_name="UAE Prop Co",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 12, 31),
        currency="AED",
        file_name="tb.csv",
    )
    db.add(tb)
    db.flush()
    cash = TrialBalanceLine(
        trial_balance_id=tb.id,
        tenant_id=tenant,
        gl_code="1001",
        gl_description="Cash",
        debit_amount=1000,
        credit_amount=0,
        net_amount=1000,
        account_type=AccountTypeEnum.asset,
    )
    db.add(cash)
    db.flush()
    db.add(
        GLMapping(
            tenant_id=tenant,
            trial_balance_id=tb.id,
            trial_balance_line_id=cash.id,
            gl_code="1001",
            gl_description="Cash",
            ifrs_statement=IFRSStatementKind.financial_position,
            ifrs_line_item="Cash and cash equivalents",
            ifrs_section="Current Assets",
            mapping_source=MappingSourceEnum.user_confirmed,
            ai_confidence_score=1.0,
            is_confirmed=True,
        )
    )
    db.commit()
    return tb


def test_inject_ifrs16_creates_rou_and_lease_liability_lines():
    db = _session()
    tb = _tb(db)
    db.add(
        IFRS16Lease(
            workspace_id="co-1",
            company_id="co-1",
            lease_name="Office tower",
            commencement_date=date(2024, 1, 1),
            lease_term_months=60,
            lease_payments_aed=10000,
            payment_frequency="monthly",
            rou_asset_current=480000,
            lease_liability_current=500000,
            accumulated_depreciation=20000,
            depreciation_ytd=96000,
            interest_ytd=24000,
            status="active",
        )
    )
    db.commit()

    summary = sg_inject("co-1", "2025-12-31", str(tb.id), db)
    assert summary["applied_count"] >= 5
    assert "IFRS module adjustment" in summary["message"]

    codes = {ln.gl_code: ln for ln in db.query(TrialBalanceLine).filter_by(trial_balance_id=tb.id).all()}
    assert codes["IFRS16-ROU"].net_amount == 480000
    assert codes["IFRS16-LL-CUR"].net_amount > 0
    assert codes["IFRS16-LL-NCL"].net_amount >= 0
    assert codes["IFRS16-DEP"].net_amount == 96000
    assert codes["IFRS16-INT"].net_amount == 24000
    assert "[ifrs_module_adjustment:ifrs16]" in codes["IFRS16-ROU"].gl_description

    maps = {
        m.gl_code: m
        for m in db.query(GLMapping).filter_by(trial_balance_id=tb.id).all()
    }
    assert maps["IFRS16-ROU"].ifrs_line_item == "Right-of-use assets"
    assert maps["IFRS16-LL-CUR"].ifrs_line_item == "Lease liabilities — current"
    assert maps["IFRS16-DEP"].ifrs_line_item == "Depreciation — right-of-use assets"
    assert maps["IFRS16-INT"].ifrs_line_item == "Finance costs — interest on leases"
    assert maps["IFRS16-ROU"].is_confirmed is True
    assert maps["IFRS16-ROU"].locked is True


def test_skip_ifrs16_when_tb_already_has_rou_mapping():
    db = _session()
    tb = _tb(db)
    rou_line = TrialBalanceLine(
        trial_balance_id=tb.id,
        tenant_id=tb.tenant_id,
        gl_code="1800",
        gl_description="ROU Asset",
        debit_amount=100,
        credit_amount=0,
        net_amount=100,
        account_type=AccountTypeEnum.asset,
    )
    db.add(rou_line)
    db.flush()
    db.add(
        GLMapping(
            tenant_id=tb.tenant_id,
            trial_balance_id=tb.id,
            trial_balance_line_id=rou_line.id,
            gl_code="1800",
            gl_description="ROU Asset",
            ifrs_statement=IFRSStatementKind.financial_position,
            ifrs_line_item="Right-of-use assets",
            ifrs_section="Non-current Assets",
            mapping_source=MappingSourceEnum.user_confirmed,
            ai_confidence_score=1.0,
            is_confirmed=True,
        )
    )
    db.add(
        IFRS16Lease(
            workspace_id="co-1",
            company_id="co-1",
            lease_name="Warehouse",
            commencement_date=date(2024, 1, 1),
            lease_term_months=36,
            rou_asset_current=200000,
            lease_liability_current=210000,
            depreciation_ytd=10000,
            interest_ytd=5000,
            status="active",
        )
    )
    db.commit()

    summary = inject_ifrs_module_adjustments("co-1", "2025", tb.id, db)
    assert summary["applied_count"] == 0
    assert any("right-of-use" in s.lower() for s in summary["skipped"])
    assert not any(
        (ln.gl_code or "").startswith("IFRS16-")
        for ln in db.query(TrialBalanceLine).filter_by(trial_balance_id=tb.id).all()
    )


def test_ifrs15_and_ifrs9_injection_and_duplicate_skip():
    db = _session()
    tb = _tb(db)
    db.add(
        IFRS15Contract(
            workspace_id="co-1",
            company_id="co-1",
            contract_number="C-01",
            customer_name="Buyer LLC",
            contract_value_aed=1_000_000,
            total_recognised_aed=400_000,
            total_remaining_aed=600_000,
            contract_asset_aed=50_000,
            contract_liability_aed=80_000,
            status="active",
        )
    )
    db.add(
        IFRS9Portfolio(
            workspace_id="co-1",
            company_id="co-1",
            portfolio_name="Trade AR",
            total_exposure_aed=850_000,
            ecl_stage1_aed=5_000,
            ecl_stage2_aed=12_000,
            ecl_stage3_aed=8_000,
            total_ecl_aed=25_000,
        )
    )
    db.commit()

    summary = inject_ifrs_module_adjustments("co-1", "2025", tb.id, db)
    codes = {ln.gl_code: ln for ln in db.query(TrialBalanceLine).filter_by(trial_balance_id=tb.id).all()}
    assert codes["IFRS15-CA"].net_amount == 50000
    assert codes["IFRS15-DR"].net_amount == 80000
    assert codes["IFRS15-REV"].net_amount == 400000
    assert codes["IFRS9-ECL"].net_amount == -25000  # contra-asset deducts from receivables
    assert codes["IFRS9-IMP"].net_amount == 25000
    assert summary["applied_count"] >= 5

    preview = preview_ifrs_module_adjustments(db, tb.id, company_id="co-1", workspace_id="co-1")
    assert preview["ifrs15"]["count"] == 1
    assert preview["ifrs9"]["count"] == 1
    assert preview["already_injected_count"] >= 5


def test_notes_enrichment_uses_module_not_heuristic():
    db = _session()
    tb = _tb(db)
    db.add(
        IFRS16Lease(
            workspace_id="co-1",
            company_id="co-1",
            lease_name="Mall unit",
            commencement_date=date(2023, 6, 1),
            lease_term_months=84,
            lease_payments_aed=20000,
            rou_asset_current=900000,
            lease_liability_current=950000,
            depreciation_ytd=120000,
            interest_ytd=40000,
            status="active",
        )
    )
    db.add(
        IFRS9Portfolio(
            workspace_id="co-1",
            company_id="co-1",
            portfolio_name="AR",
            total_exposure_aed=500000,
            ecl_stage1_aed=2000,
            ecl_stage2_aed=3000,
            ecl_stage3_aed=5000,
            total_ecl_aed=10000,
        )
    )
    db.add(
        IFRS15Contract(
            workspace_id="co-1",
            company_id="co-1",
            contract_number="OFFPLAN-1",
            customer_name="Investor",
            total_recognised_aed=250000,
            contract_asset_aed=15000,
            contract_liability_aed=0,
            performance_obligations='[{"name":"Unit handover","recognised":250000,"remaining":0,"method":"over_time"}]',
            status="active",
        )
    )
    db.commit()

    tb_data = {"company_name": "UAE Prop Co", "currency": "AED", "trade_receivables": 0}
    out = enrich_tb_data_from_ifrs_modules(tb_data, db, tb.id, company_id="co-1", workspace_id="co-1")
    assert out["ifrs16_source"] == "module"
    assert out["rou_asset"] == 900000
    assert out["rou_depreciation"] == 120000
    assert out["lease_interest"] == 40000
    assert out["has_leases"] is True
    assert out["ifrs16_maturity"]["within_1y"] > 0
    assert out["ifrs9_source"] == "module"
    assert out["ecl_provision"] == 10000
    assert out["ifrs9_ecl_by_stage"]["stage3"] == 5000
    assert out["ifrs15_source"] == "module"
    assert out["ifrs15_pob"][0]["name"] == "Unit handover"
    assert out["revenue"] == 250000
