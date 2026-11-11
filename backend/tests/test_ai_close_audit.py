"""Regression tests for the code audit: group merges, investment edge cases, AP paging, forecast
scope, and tenant isolation across workspaces and group entities."""

from __future__ import annotations

from datetime import date

from app.core import company_access
from app.models.investments import InvestmentHolding, InvestmentValuation
from app.services.ai_close import ap_agent
from app.services.ai_close.context import Entity
from app.services.ai_close.entities import merge_outputs
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, LAST, PHASE_A, WS_A, WS_B, _group, _start, _task, client, demo, env, q, sb, session_factory,
)


def test_merge_keeps_agreed_limits_and_any_flags():
    a, b = Entity("a", "A"), Entity("b", "B")
    merged = merge_outputs([(a, {"applicable": True, "limits": {"issuer_pct": 25.0}, "x_pct": 10.0, "total": 5}),
                            (b, {"applicable": False, "limits": {"issuer_pct": 25.0}, "x_pct": 20.0, "total": 7})])
    assert merged["applicable"] is True and merged["limits"] == {"issuer_pct": 25.0}
    assert merged["x_pct"] is None and merged["total"] == 12


def test_group_cfo_summary_includes_investment_risk(client, env, demo):
    run = _group(client, demo, agents=["investment"])
    risks = {r["area"]: r for r in run["cfo_summary"]["risks"]}
    assert "Investments" in risks and "1 issuer limit breach" in risks["Investments"]["detail"]


def test_first_valuation_after_purchase_month_is_a_fair_value_movement(client, env, demo, session_factory):
    db = session_factory()
    h = InvestmentHolding(workspace_id=WS_A, company_id=demo.services, code="NEW", name="New Fund", asset_class="fund",
                          ifrs9_category="fvtpl", currency="AED", cost=100000, acquired_on=date(2026, 9, 15))
    matured = InvestmentHolding(workspace_id=WS_A, company_id=demo.services, code="OLD", name="Matured deposit",
                                asset_class="deposit", ifrs9_category="amortised_cost", currency="AED", cost=50000,
                                acquired_on=date(2026, 4, 1), maturity_date=date(2026, 10, 10))
    db.add_all([h, matured])
    db.flush()
    db.add(InvestmentValuation(holding_id=h.id, as_of=date(2026, 10, 31), market_value=103000))
    db.commit()
    db.close()
    run = _start(client, demo.services, agents=["investment"])
    out = _task(client, run, "investment", demo.services)["output_json"]
    assert [r["code"] for r in out["holdings"]] == ["NEW"]
    assert out["fair_value_by_category"]["fvtpl"] == 3000
    assert not any(e["category"] == "stale_price" for e in run["exceptions"])


def test_ap_reads_every_page(client, env, demo, sb, monkeypatch):
    monkeypatch.setattr(ap_agent, "PAGE_SIZE", 50)
    run = _start(client, demo.a, agents=["ap_processing"])
    ap = _task(client, run, "ap_processing", demo.a)["output_json"]
    assert ap["invoices_processed"] == 47 and not any("Only the first" in l for l in ap["limitations"])
    monkeypatch.setattr(ap_agent, "MAX_ROWS", 100)
    capped = _task(client, _start(client, demo.a, agents=["ap_processing"]), "ap_processing", demo.a)["output_json"]
    assert any("Only the first 100 invoices were read." == l for l in capped["limitations"])


def test_rolling_forecast_excludes_non_run_rate_accounts(client, env, demo):
    run = _start(client, demo.a, agents=["ar_intelligence", "ap_processing", "fpa"])
    rolling = _task(client, run, "fpa", demo.a)["output_json"]["rolling_forecast"]
    assert "6030" not in {a["account_code"] for a in rolling["accounts"]}
    assert "fair value gains/losses" in rolling["method"]


def test_group_run_needs_read_access_to_every_entity(client, env, demo, monkeypatch):
    run = _group(client, demo, agents=PHASE_A)
    original = company_access.require_company_access

    def deny_logistics(db, ctx, company_id, level="read"):
        if company_id == demo.logistics:
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="No access to this company")
        return original(db, ctx, company_id, level)

    from app.routers import ai_close as router
    monkeypatch.setattr(router, "require_company_access", deny_logistics)
    for path in (f"/runs/{run['id']}", f"/runs/{run['id']}/tasks/fpa", f"/runs/{run['id']}/reports/close_pack.json", "/runs/latest"):
        assert client.get(BASE + path + q(demo.a)).status_code == 403, path
    journals = client.get(BASE + "/journals" + q(demo.a)).json()
    assert journals and demo.logistics not in {j["company_id"] for j in journals}


def test_other_workspace_cannot_see_close_data(client, env, demo):
    run = _start(client, demo.a, agents=PHASE_A)
    env.roles[WS_A] = "owner"
    client.put(BASE + "/fx-rates" + q(demo.a), json={"period": LAST, "currency": "USD", "closing_rate": 3.67, "average_rate": 3.67})
    for path in ("/investments", "/fx-rates", "/schedule", "/controls", "/journals", "/runs", f"/runs/{run['id']}",
                 f"/agents/runs/{run['id']}"):
        assert client.get(BASE + path + q(demo.b)).status_code == 403, path
    pid = run["proposals"][0]["id"]
    assert client.post(f"{BASE}/journals/{pid}/decision" + q(demo.b), json={"decision": "approved"}).status_code == 403
    assert client.get(f"{BASE}/runs/{run['id']}" + q(demo.services)).status_code == 404
    assert client.get(BASE + "/investments" + q(demo.services)).json() == []
