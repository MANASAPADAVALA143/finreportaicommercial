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
