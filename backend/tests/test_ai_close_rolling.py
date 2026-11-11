"""FP&A rolling 12-month forecast with best and worst case."""

from __future__ import annotations

from statistics import linear_regression, median

import pytest

from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_close.agents import ROLLING_MONTHS, TREND_DAMPING
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, LAST, WS_A, _group, _start, _task, client, demo, env, q, sb, session_factory,
)


def _expected_account_total(db, company_id, code):
    start = ledger.period_add(LAST, -(ROLLING_MONTHS - 1))
    series = {p: 0.0 for p in ledger.periods_between(start, LAST)}
    for m in ledger.monthly_movements(db, LedgerScope(WS_A, company_id), start, LAST, account_codes=[code]):
        series[m["period"]] += m["net"]
    values = list(series.values())
    active = values[next(i for i, v in enumerate(values) if abs(v) > 0.005):]
    run_rate = median(active[-3:])
    slope = linear_regression(range(len(active)), active).slope * TREND_DAMPING
    return run_rate, sum(max(run_rate + slope * (h + 1), 0.0) for h in range(ROLLING_MONTHS))


def test_rolling_forecast_per_account_and_scenarios(client, env, demo, session_factory):
    run = _start(client, demo.a, agents=["ar_intelligence", "ap_processing", "fpa"])
    rolling = _task(client, run, "fpa", demo.a)["output_json"]["rolling_forecast"]
    assert rolling["months"][0] == "2026-11" and rolling["months"][-1] == "2027-10" and len(rolling["months"]) == 12
    db = session_factory()
    run_rate, total = _expected_account_total(db, demo.a, "7101")
    db.close()
    salaries = next(a for a in rolling["accounts"] if a["account_code"] == "7101")
    assert salaries["run_rate"] == pytest.approx(run_rate, abs=0.01)
    assert salaries["next_12_months"] == pytest.approx(total, abs=0.5)

    t = rolling["totals"]
    for name in ("base_case", "best_case", "worst_case"):
        assert t[name]["profit"] == pytest.approx(sum(p["profit"] for p in rolling[name]), abs=0.05)
    assert t["best_case"]["profit"] > t["base_case"]["profit"] > t["worst_case"]["profit"]
    assert t["best_case"]["revenue"] == pytest.approx(t["base_case"]["revenue"] * 1.05, abs=1)
    assert t["worst_case"]["expenses"] == pytest.approx(t["base_case"]["expenses"] * 1.05, abs=1)
    base_revenue = sum(a["next_12_months"] for a in rolling["accounts"] if a["type"] == "Income")
    assert t["base_case"]["revenue"] == pytest.approx(base_revenue, abs=1)

    cfo = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()["cfo_summary"]
    assert cfo["outlook_next_12_months"]["base"]["profit"] == t["base_case"]["profit"]
    assert "Over the next 12 months profit is forecast" in cfo["narrative"]["text"]
    view = client.get(f"{BASE}/runs/{run['id']}/reports/fpa_intelligence.json" + q(demo.a)).json()
    titles = [s["title"] for s in view["sections"]]
    assert "Rolling 12-month forecast" in titles and "Rolling forecast by account (base case)" in titles
    assert len(next(s for s in view["sections"] if s["title"] == "Rolling 12-month forecast")["rows"]) == 12


def test_seasonality_index_deseasonalises_history_and_shapes_the_forecast(client, env, demo, session_factory):
    url = BASE + "/forecast-settings" + q(demo.a)
    assert client.get(url).json()["applied"] is False
    revenue_index = [0.8, 0.8, 0.9, 1.0, 1.0, 0.9, 0.8, 0.8, 1.0, 1.2, 1.4, 1.4]
    env.roles[WS_A] = "accountant"
    assert client.put(url, json={"revenue": revenue_index}).status_code == 403
    env.roles[WS_A] = "finance_manager"
    assert client.put(url, json={"revenue": [1.0] * 11}).status_code == 422
    assert client.put(url, json={"revenue": [0.0] + [1.0] * 11}).status_code == 422
    saved = client.put(url, json={"revenue": [v * 2 for v in revenue_index]}).json()
    assert saved["applied"] and saved["revenue"] == pytest.approx([v / (sum(revenue_index) / 12) for v in revenue_index], abs=1e-4)
    assert saved["expenses"] == [1.0] * 12
    idx = saved["revenue"]

    run = _start(client, demo.a, agents=["ar_intelligence", "ap_processing", "fpa"])
    fpa = _task(client, run, "fpa", demo.a)["output_json"]
    rolling = fpa["rolling_forecast"]
    assert rolling["seasonality"]["applied"] and rolling["seasonality"]["index"][10]["revenue_index"] == idx[10]
    assert "deseasonalised" in rolling["method"]
    assert not any("no seasonality" in n for n in fpa["limitations"])

    db = session_factory()
    start = ledger.period_add(LAST, -(ROLLING_MONTHS - 1))
    series = {p: 0.0 for p in ledger.periods_between(start, LAST)}
    for m in ledger.monthly_movements(db, LedgerScope(WS_A, demo.a), start, LAST, account_codes=["6010"]):
        series[m["period"]] += m["net"]
    db.close()
    adjusted = [v / idx[int(p[5:7]) - 1] for p, v in series.items()]
    active = adjusted[next(i for i, v in enumerate(adjusted) if abs(v) > 0.005):]
    run_rate = median(active[-3:])
    slope = linear_regression(range(len(active)), active).slope * TREND_DAMPING
    expected = sum(max(run_rate + slope * (h + 1), 0.0) * idx[int(p[5:7]) - 1] for h, p in enumerate(rolling["months"]))
    sales = next(a for a in rolling["accounts"] if a["account_code"] == "6010")
    assert sales["run_rate"] == pytest.approx(run_rate, abs=0.01)
    assert sales["next_12_months"] == pytest.approx(expected, abs=1)
    nov, feb = rolling["base_case"][0], rolling["base_case"][3]
    assert nov["period"] == "2026-11" and feb["period"] == "2027-02" and nov["revenue"] > feb["revenue"]

    assert client.put(url, json={}).json()["applied"] is False
    fpa = _task(client, _start(client, demo.a, agents=["fpa"]), "fpa", demo.a)["output_json"]
    assert fpa["rolling_forecast"]["seasonality"] == {"applied": False, "index": []}


def test_group_rolling_forecast_combines_entities_by_month(client, env, demo):
    run = _group(client, demo, agents=["ar_intelligence", "ap_processing", "fpa"])
    fpa = _task(client, run, "fpa", demo.a)["output_json"]
    group = fpa["rolling_forecast"]
    assert len(group["base_case"]) == 12
    first = group["base_case"][0]
    per_entity = sum(e["rolling_forecast"]["base_case"][0]["revenue"] for e in fpa["entities"])
    assert first["period"] == "2026-11" and first["revenue"] == pytest.approx(per_entity, abs=0.05)
    assert group["totals"]["base_case"]["profit"] == pytest.approx(
        sum(e["rolling_forecast"]["totals"]["base_case"]["profit"] for e in fpa["entities"]), abs=0.05)
