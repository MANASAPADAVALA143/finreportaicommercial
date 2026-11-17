"""Group intelligence reads posted journals and existing FX. Missing inputs stay unavailable."""

from __future__ import annotations

import os
from datetime import date
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.core.tenant_scope import workspace_member
from app.middleware.workspace import WorkspaceContext
from app.models.ai_close import AiCloseFxRate
from app.models.company_setup import AccountingPeriod, ConsolidationElimination, UaeCompanyProfile
from app.models.group_finance import GroupEntityOwnership, GroupFinancialSnapshot, GroupIntercompanyMatch
from app.models.uae_accounting_full import UAEAccount, UAEBankAccount, UAEJournalEntry, UAEJournalLine
from app.models.workspace import WorkspaceRole
from app.models.workspace_audit import WorkspaceAuditLog
from app.routers import group_intelligence
from app.services import consolidation_service, group_intelligence_service as gis

WS = "aaaaaaaa-0000-4000-8000-000000000001"
OTHER = "bbbbbbbb-0000-4000-8000-000000000002"
TABLES = (
    UaeCompanyProfile, AccountingPeriod, ConsolidationElimination, UAEAccount, UAEJournalEntry, UAEJournalLine,
    UAEBankAccount, AiCloseFxRate,
    GroupEntityOwnership, GroupFinancialSnapshot, GroupIntercompanyMatch, WorkspaceAuditLog,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in TABLES:
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _company(db, company_id, name, currency="AED", workspace=WS):
    row = UaeCompanyProfile(
        id=company_id, workspace_id=workspace, company_name=name, base_currency=currency, status="active",
    )
    db.add(row)
    db.commit()
    return row


def _post(db, company, period, lines, reference=None):
    year, month = period.split("-")
    entry = UAEJournalEntry(
        tenant_id=WS, company_id=company, entry_date=date(int(year), int(month), 15),
        period=period, description="posted", status="posted", reference=reference,
    )
    entry.lines = [UAEJournalLine(account_code=code, debit=debit, credit=credit) for code, debit, credit in lines]
    db.add(entry)
    db.commit()
    return entry


def test_two_entities_sum_posted_revenue_and_keep_gl_cash_apart_from_bank(db):
    _company(db, "c-mfg", "Manufacturing")
    _company(db, "c-trade", "Trading")
    _post(db, "c-mfg", "2026-10", [("1002", 1000, 0), ("6010", 0, 1000)])
    _post(db, "c-trade", "2026-10", [("1002", 500, 0), ("6010", 0, 500)])
    db.add(UAEBankAccount(
        tenant_id=WS, company_id="c-mfg", currency="AED", is_active=True, last_reconciled_balance=250,
        last_reconciled_date=date(2026, 10, 31),
    ))
    db.commit()

    position = gis.build_position(db, WS, "2026-10")

    assert position["status"] == "complete"
    assert position["reporting_currency"] == "AED"
    assert position["kpis"]["group_revenue"]["available"] is True
    assert position["kpis"]["group_revenue"]["value"] == 1500
    assert position["kpis"]["gl_cash"]["value"] == 1500
    assert position["kpis"]["bank_cash"]["value"] == 250
    assert position["kpis"]["gl_cash"]["value"] != position["kpis"]["bank_cash"]["value"]
    assert position["kpis"]["nci_net_profit"]["available"] is False
    assert position["kpis"]["nci_net_profit"]["value"] is None
    assert position["kpis"]["cash_runway"]["available"] is False
    assert "consolidation_agent" in position["kpis"]["group_revenue"]["method"]


def test_missing_fx_rate_makes_group_totals_unavailable(db):
    _company(db, "c-india", "India Manufacturing", currency="INR")
    _post(db, "c-india", "2026-10", [("1002", 10000, 0), ("6010", 0, 10000)])

    position = gis.build_position(db, WS, "2026-10", reporting_currency="AED")
    entity = position["entities"][0]

    assert position["status"] == "partial"
    assert position["kpis"]["group_revenue"]["available"] is False
    assert position["kpis"]["group_revenue"]["value"] is None
    assert entity["local"]["revenue"]["value"] == 10000
    assert entity["reporting"]["revenue"]["available"] is False
    assert entity["reporting"]["revenue"]["value"] is None
    assert position["kpis"]["bank_cash"]["available"] is False


def test_fx_translation_uses_average_rate_and_ownership_for_nci_only(db):
    _company(db, "c-india", "India Manufacturing", currency="INR")
    _post(db, "c-india", "2026-10", [("1002", 10000, 0), ("6010", 0, 10000)])
    db.add(AiCloseFxRate(
        workspace_id=WS, period="2026-10", currency="INR", reporting_currency="AED",
        closing_rate=0.044, average_rate=0.04, source="test",
    ))
    db.commit()
    gis.record_ownership(db, WS, "c-india", 60, date(2026, 1, 1), None, None, "cfo@example.com")

    position = gis.build_position(db, WS, "2026-10", reporting_currency="AED")

    assert position["kpis"]["group_revenue"]["value"] == 400
    assert position["kpis"]["nci_net_profit"]["available"] is True
    assert position["kpis"]["nci_net_profit"]["value"] == 160
    assert position["entities"][0]["ownership"]["source"] == "group_entity_ownership"
    saved = gis.persist_snapshot(db, position, "cfo@example.com")
    assert saved["snapshot_id"]
    audit = db.query(WorkspaceAuditLog).filter_by(action="group_snapshot_created").one()
    assert audit.workspace_id == WS
    assert audit.details["status"] == "complete"


def test_missing_reconciled_balance_does_not_become_zero(db):
    _company(db, "c-mfg", "Manufacturing")
    _post(db, "c-mfg", "2026-10", [("1002", 800, 0), ("6010", 0, 800)])
    db.add(UAEBankAccount(tenant_id=WS, company_id="c-mfg", currency="AED", is_active=True, last_reconciled_balance=None))
    db.commit()

    position = gis.build_position(db, WS, "2026-10")

    assert position["kpis"]["gl_cash"]["value"] == 800
    assert position["kpis"]["bank_cash"]["available"] is False
    assert position["kpis"]["bank_cash"]["value"] is None
    assert position["kpis"]["net_debt"]["available"] is False


def test_intercompany_match_links_posted_journals(db):
    _company(db, "c-seller", "Seller")
    _company(db, "c-buyer", "Buyer")
    _post(db, "c-seller", "2026-10", [("1002", 200, 0), ("6010", 0, 200)], reference="IC-100")
    _post(db, "c-buyer", "2026-10", [("7100", 200, 0), ("1002", 0, 200)], reference="IC-100")

    position = gis.build_position(db, WS, "2026-10")
    match = position["intercompany"][0]

    assert match["status"] == "matched"
    assert match["eliminated_amount"] == 200
    assert {ref["company_id"] for ref in match["source_refs"]} == {"c-seller", "c-buyer"}
    assert position["kpis"]["group_revenue"]["value"] == 0
    assert position["kpis"]["group_revenue"]["available"] is True


def test_other_workspace_company_is_rejected(db):
    _company(db, "c-mfg", "Manufacturing")
    _company(db, "c-other", "Outside", workspace=OTHER)
    with pytest.raises(gis.GroupIntelligenceError):
        gis.build_position(db, WS, "2026-10", company_ids=["c-other"])
    with pytest.raises(gis.GroupIntelligenceError):
        gis.record_ownership(db, WS, "c-other", 80, date(2026, 1, 1), None, None, None)


def test_parent_cycle_is_rejected_and_consolidation_engine_is_unchanged(db):
    _company(db, "c-hold", "Holdings")
    _company(db, "c-sub", "Subsidiary")
    gis.set_parent(db, WS, "c-sub", "c-hold", "cfo@example.com")
    with pytest.raises(gis.GroupIntelligenceError):
        gis.set_parent(db, WS, "c-hold", "c-sub", "cfo@example.com")
    assert consolidation_service.PL_ROWS[0]["key"] == "revenue"


def test_position_api_scopes_to_the_workspace(db):
    _company(db, "c-mfg", "Manufacturing")
    _post(db, "c-mfg", "2026-10", [("1002", 75, 0), ("6010", 0, 75)])
    app = FastAPI()
    app.include_router(group_intelligence.router)

    def _member():
        return WorkspaceContext(
            workspace_id=WS,
            workspace=SimpleNamespace(id=WS),
            user=SimpleNamespace(id="u1", email="cfo@example.com"),
            role=WorkspaceRole.owner,
        )

    def _session():
        yield db

    app.dependency_overrides[workspace_member] = _member
    app.dependency_overrides[get_db] = _session
    client = TestClient(app)

    response = client.get("/api/group-intelligence/position", params={"period": "2026-10"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["workspace_id"] == WS
    assert body["kpis"]["group_revenue"]["value"] == 75
    assert body["snapshot_id"] is None

    saved = client.post("/api/group-intelligence/snapshots", params={"period": "2026-10"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["snapshot_id"]
    listed = client.get("/api/group-intelligence/snapshots", params={"period": "2026-10"})
    assert listed.status_code == 200
    assert listed.json()[0]["snapshot_id"] == saved.json()["snapshot_id"]


def test_snapshot_stays_unchanged_after_later_journals_and_a_second_snapshot(db):
    _company(db, "c-mfg", "Manufacturing")
    _post(db, "c-mfg", "2026-10", [("1002", 100, 0), ("6010", 0, 100)])
    first = gis.persist_snapshot(db, gis.build_position(db, WS, "2026-10"), "cfo@example.com")
    _post(db, "c-mfg", "2026-10", [("1002", 50, 0), ("6010", 0, 50)])
    second = gis.persist_snapshot(db, gis.build_position(db, WS, "2026-10"), "cfo@example.com")

    stored = gis.get_snapshot(db, WS, first["snapshot_id"])
    assert stored["kpis"]["group_revenue"]["value"] == 100
    assert second["kpis"]["group_revenue"]["value"] == 150
    assert stored["snapshot_id"] != second["snapshot_id"]
    assert len(gis.list_snapshots(db, WS, "2026-10")) == 2


def test_snapshot_keeps_the_fx_rates_used_after_the_rate_row_changes(db):
    _company(db, "c-india", "India Manufacturing", currency="INR")
    _post(db, "c-india", "2026-10", [("1002", 10000, 0), ("6010", 0, 10000)])
    db.add(AiCloseFxRate(
        workspace_id=WS, period="2026-10", currency="INR", reporting_currency="AED",
        closing_rate=0.044, average_rate=0.04, source="test-rate",
    ))
    db.commit()
    saved = gis.persist_snapshot(db, gis.build_position(db, WS, "2026-10", reporting_currency="AED"), "cfo@example.com")
    rate = db.query(AiCloseFxRate).one()
    rate.average_rate = 0.9
    rate.closing_rate = 0.8
    db.commit()

    stored = gis.get_snapshot(db, WS, saved["snapshot_id"])
    kept = stored["methodology"]["rates"][0]
    assert kept["average_rate"] == 0.04
    assert kept["closing_rate"] == 0.044
    assert kept["fx_rate_id"] == rate.id
    assert kept["source"] == "test-rate"
    assert stored["kpis"]["group_revenue"]["value"] == 400


def test_entity_revenue_less_eliminations_equals_group_revenue(db):
    _company(db, "c-seller", "Seller")
    _company(db, "c-buyer", "Buyer")
    _post(db, "c-seller", "2026-10", [("1002", 200, 0), ("6010", 0, 200)], reference="IC-100")
    _post(db, "c-buyer", "2026-10", [("7100", 200, 0), ("1002", 0, 200)], reference="IC-100")
    _company(db, "c-ext", "External")
    _post(db, "c-ext", "2026-10", [("1002", 500, 0), ("6010", 0, 500)])

    position = gis.build_position(db, WS, "2026-10")
    bridge = position["bridge"]["revenue"]
    assert bridge["entity_reporting_sum"] == 700
    assert bridge["eliminations"] == 200
    assert bridge["group_consolidated"] == 500
    assert bridge["difference"] == 0
    assert position["bridge"]["reconciled"] is True
    assert position["methodology"]["rates"][0]["average_rate"] == 1.0


def test_ownership_uses_the_percent_effective_in_the_reporting_month(db):
    _company(db, "c-india", "India Manufacturing", currency="INR")
    gis.record_ownership(db, WS, "c-india", 60, date(2026, 1, 1), date(2026, 10, 31), None, "cfo@example.com")
    gis.record_ownership(db, WS, "c-india", 40, date(2026, 11, 1), None, None, "cfo@example.com")

    october = gis.build_position(db, WS, "2026-10", reporting_currency="AED")
    november = gis.build_position(db, WS, "2026-11", reporting_currency="AED")
    assert october["entities"][0]["ownership"]["ownership_percent"] == 60
    assert november["entities"][0]["ownership"]["ownership_percent"] == 40


def test_series_reports_actuals_and_leaves_budget_unavailable(db):
    _company(db, "c-mfg", "Manufacturing")
    _post(db, "c-mfg", "2026-09", [("1002", 40, 0), ("6010", 0, 40)])
    _post(db, "c-mfg", "2026-10", [("1002", 60, 0), ("6010", 0, 60)])
    series = gis.build_series(db, WS, "2026-09", "2026-10")
    assert [point["revenue"]["value"] for point in series["points"]] == [40, 60]
    assert series["points"][0]["budget"]["available"] is False
    assert series["actuals_only"] is True
