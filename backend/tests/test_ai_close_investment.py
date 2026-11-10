"""Investment Agent: valuation, returns, concentration, ledger tie-out and fair value journals."""

from __future__ import annotations

from datetime import date
from io import BytesIO

import pytest

from app.models.investments import InvestmentHolding, InvestmentValuation
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, LAST, WS_A, _start, _task, client, demo, env, q, sb, session_factory,
)


def _run(client, cid):
    run = _start(client, cid, agents=["investment"])
    return run, _task(client, run, "investment", cid)["output_json"]


def test_investment_agent_values_portfolio_and_proposes_fair_value_journals(client, env, demo):
    run, out = _run(client, demo.a)
    assert out["holdings_count"] == 6 and out["portfolio_value"] == 1270500
    assert out["fair_value_by_category"] == {"fvtpl": 8000, "fvoci": 4000}
    # amortised-cost holdings are carried at cost: the sukuk at 250,000, not its 248,500 market value
    assert out["ledger"] == {"account": "2040", "balance": 1260000, "expected": 1272000, "difference": 12000}
    assert out["month_income"] == 1665
    assert out["month_return_pct"] == pytest.approx((1270500 - 1258700 + 1665) / 1258700 * 100, abs=0.01)
    assert {a["asset_class"]: a["pct"] for a in out["allocation"]}["equity"] == pytest.approx(57.6, abs=0.1)

    cats = {}
    for e in run["exceptions"]:
        cats.setdefault(e["category"], []).append(e["title"])
    assert len(cats["concentration_risk"]) == 1 and cats["concentration_risk"][0].startswith("Emirates NBD is 33.1%")
    assert len(cats["valuation_drop"]) == 1 and "Aldar" in cats["valuation_drop"][0] and "12.0%" in cats["valuation_drop"][0]
    assert len(cats["investment_maturity"]) == 1 and "Mashreq" in cats["investment_maturity"][0]
    assert len(cats["fair_value_unrecorded"]) == 1

    fv = {p["title"].split(" on ")[1].split(" ")[0]: p for p in run["proposals"]}
    assert set(fv) == {"FVTPL", "FVOCI"}
    assert {(l["account_code"], l["debit"], l["credit"]) for l in fv["FVTPL"]["lines"]} == {("2040", 8000, 0), ("6030", 0, 8000)}
    assert {(l["account_code"], l["debit"], l["credit"]) for l in fv["FVOCI"]["lines"]} == {("2040", 4000, 0), ("5030", 0, 4000)}
    assert "IFRS 9" in fv["FVTPL"]["rationale"] and fv["FVTPL"]["source_refs"]

    env.roles[WS_A] = "owner"
    for p in run["proposals"]:
        assert client.post(f"{BASE}/journals/{p['id']}/decision" + q(demo.a), json={"decision": "approved"}).status_code == 200
    after = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()
    assert next(e for e in after["exceptions"] if e["category"] == "fair_value_unrecorded")["status"] == "resolved"
    rerun, out2 = _run(client, demo.a)
    assert out2["ledger"]["difference"] == 0 and rerun["proposals"] == []
    assert "fair_value_unrecorded" not in {e["category"] for e in rerun["exceptions"]}


def test_stale_price_is_flagged_and_excluded_from_journals(client, env, demo, session_factory):
    db = session_factory()
    fab = db.query(InvestmentHolding).filter_by(company_id=demo.a, code="FAB").one()
    db.query(InvestmentValuation).filter_by(holding_id=fab.id, as_of=date(2026, 10, 31)).delete()
    db.commit()
    db.close()
    run, out = _run(client, demo.a)
    assert out["fair_value_by_category"] == {"fvtpl": 8000, "fvoci": 0}
    assert [p["amount"] for p in run["proposals"]] == [8000]
    assert any(e["category"] == "stale_price" and "First Abu Dhabi" in e["title"] for e in run["exceptions"])


def test_company_without_portfolio_completes(client, env, demo):
    run, out = _run(client, demo.services)
    assert out["applicable"] is False
    assert next(t for t in run["tasks"] if t["agent"] == "investment")["status"] == "completed"


def test_investment_report_and_import_api(client, env, demo):
    from openpyxl import load_workbook

    run, _ = _run(client, demo.a)
    view = client.get(f"{BASE}/runs/{run['id']}/reports/investment_review.json" + q(demo.a)).json()
    assert [s["title"] for s in view["sections"]][:5] == ["Holdings", "Asset allocation", "Issuer concentration",
                                                        "Currency exposure", "Maturity ladder"]
    xlsx = client.get(f"{BASE}/runs/{run['id']}/reports/investment_review.xlsx" + q(demo.a))
    assert xlsx.status_code == 200 and "Holdings" in load_workbook(BytesIO(xlsx.content)).sheetnames
    assert client.get(f"{BASE}/runs/{run['id']}/reports/investment_review.pdf" + q(demo.a)).content[:5] == b"%PDF-"

    body = {"holdings": [{"code": "XYZ", "name": "XYZ Bond", "asset_class": "bond", "ifrs9_category": "amortised_cost",
                          "cost": 100000, "currency": "aed", "maturity_date": "2027-03-31"}],
            "valuations": [{"code": "XYZ", "as_of": "2026-10-31", "market_value": 99500},
                           {"code": "NOPE", "as_of": "2026-10-31", "market_value": 1}]}
    res = client.post(BASE + "/investments/import" + q(demo.services), json=body).json()
    assert (res["holdings_created"], res["valuations_saved"], len(res["errors"])) == (1, 1, 1)
    again = client.post(BASE + "/investments/import" + q(demo.services), json={**body, "valuations": body["valuations"][:1]}).json()
    assert (again["holdings_created"], again["holdings_updated"], again["valuations_saved"]) == (0, 1, 1)
    listed = client.get(BASE + "/investments" + q(demo.services)).json()
    assert [(h["code"], h["currency"], h["latest_value"]) for h in listed] == [("XYZ", "AED", 99500)]
    assert client.post(BASE + "/investments/import" + q(demo.services),
                       json={"holdings": [{**body["holdings"][0], "asset_class": "crypto"}]}).status_code == 422
    assert client.delete(f"{BASE}/investments/{listed[0]['id']}" + q(demo.services)).status_code == 403
    env.roles[WS_A] = "owner"
    assert client.delete(f"{BASE}/investments/{listed[0]['id']}" + q(demo.services)).status_code == 204
    assert client.get(BASE + "/investments" + q(demo.a)).json()[0]["company_id"] == demo.a


def test_ask_investment_agent(client, env, demo):
    res = client.post(f"{BASE}/agents/investment/ask" + q(demo.a),
                      json={"prompt": "Analyse the company's investment portfolio for October"})
    assert res.status_code == 202
    ask = client.get(f"{BASE}/agents/runs/{res.json()['id']}" + q(demo.a)).json()
    assert ask["period"] == LAST and "Reviewed 6 holding(s) worth 1,270,500.00" in ask["ask"]["answer"]["text"]
