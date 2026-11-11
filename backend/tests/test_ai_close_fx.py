"""IAS 21 translation of a foreign-currency subsidiary in the group consolidation."""

from __future__ import annotations

from datetime import date

import pytest

from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.uae_accounting_full import UAEJournalEntry, UAEJournalLine
from app.services.uae_coa_service import seed_uae_chart_of_accounts
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, LAST, WS_A, _start, _task, client, demo, env, q, sb, session_factory,
)


def _usd_subsidiary(session_factory) -> str:
    db = session_factory()
    sub = UaeCompanyProfile(workspace_id=WS_A, company_name="Gnanova US Inc (test)", base_currency="USD", status="active")
    db.add(sub)
    db.flush()
    seed_uae_chart_of_accounts(WS_A, db, company_id=sub.id)
    for day, desc, debit, credit, amount in ((date(2026, 4, 2), "Capital", "1002", "5001", 100000),
                                             (date(2026, 9, 10), "Sales", "1002", "6010", 5000),
                                             (date(2026, 10, 10), "Sales", "1002", "6010", 10000)):
        e = UAEJournalEntry(tenant_id=WS_A, company_id=sub.id, entry_date=day, period=day.strftime("%Y-%m"),
                            description=desc, status="posted")
        e.lines = [UAEJournalLine(account_code=debit, debit=amount, credit=0), UAEJournalLine(account_code=credit, debit=0, credit=amount)]
        db.add(e)
    db.commit()
    sid = sub.id
    db.close()
    return sid


def test_foreign_subsidiary_excluded_until_rates_then_translated(client, env, demo, session_factory):
    usd = _usd_subsidiary(session_factory)
    group = demo.group[1:] + [usd]
    run = _start(client, demo.a, scope="group", entity_ids=group, agents=["ar_intelligence"])
    consol = _task(client, run, "consolidation", demo.a)["output_json"]
    assert consol["excluded_entities"] == ["Gnanova US Inc (test)"]
    assert any("no 2026-10 USD/AED rates" in e["title"] for e in run["exceptions"])
    base_revenue = consol["consolidated_revenue"]

    env.roles[WS_A] = "owner"
    url = BASE + "/fx-rates" + q(demo.a)
    assert client.put(url, json={"period": LAST, "currency": "AED", "closing_rate": 1, "average_rate": 1}).status_code == 422
    assert client.put(url, json={"period": LAST, "currency": "USD", "closing_rate": 0, "average_rate": 3.67}).status_code == 422
    assert client.put(url, json={"period": LAST, "currency": "usd", "closing_rate": 3.68, "average_rate": 3.67}).json()["currency"] == "USD"
    client.put(url, json={"period": "2026-09", "currency": "USD", "closing_rate": 3.6725, "average_rate": 3.6725, "source": "CBUAE"})
    assert [r["period"] for r in client.get(BASE + "/fx-rates" + q(demo.a)).json()] == ["2026-10", "2026-09"]

    run = _start(client, demo.a, scope="group", entity_ids=group, agents=["ar_intelligence"])
    consol = _task(client, run, "consolidation", demo.a)["output_json"]
    assert consol["excluded_entities"] == []
    usd_entity = next(e for e in consol["entities"] if e["entity_id"] == usd)
    assert usd_entity["pl"]["revenue"] == pytest.approx(36700) and usd_entity["pl_local"]["revenue"] == 10000
    assert usd_entity["bs"]["total_assets"] == pytest.approx(115000 * 3.68)
    t = consol["translation"][0]
    assert t["translation_difference"] == pytest.approx(115000 * 3.68 - (105000 * 3.6725 + 10000 * 3.67), abs=0.01)
    assert consol["translation_difference"] == pytest.approx(887.5, abs=0.01)
    assert consol["consolidated_revenue"] == pytest.approx(base_revenue + 36700, abs=0.01)
    assert consol["group_bs_balanced"]

    cfo = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()["cfo_summary"]
    assert cfo["group"]["consolidated_revenue"] == pytest.approx(consol["consolidated_revenue"], abs=0.01)
    assert cfo["performance"]["revenue"] == pytest.approx(consol["consolidated_revenue"] + consol["eliminated_revenue"], abs=0.05)
    pack = client.get(f"{BASE}/runs/{run['id']}/reports/close_pack.json" + q(demo.a)).json()
    assert any(s["title"] == "Currency translation into AED (IAS 21)" for s in pack["sections"])

    env.roles[WS_A] = "viewer"
    assert client.put(url, json={"period": LAST, "currency": "USD", "closing_rate": 3.7, "average_rate": 3.7}).status_code == 403


def test_equity_is_translated_at_historical_rates(client, env, demo, session_factory):
    usd = _usd_subsidiary(session_factory)
    db = session_factory()
    e = UAEJournalEntry(tenant_id=WS_A, company_id=usd, entry_date=date(2026, 10, 15), period="2026-10",
                        description="Further capital", status="posted")
    e.lines = [UAEJournalLine(account_code="1002", debit=20000, credit=0), UAEJournalLine(account_code="5001", debit=0, credit=20000)]
    db.add(e)
    db.commit()
    db.close()
    env.roles[WS_A] = "owner"
    url = BASE + "/fx-rates" + q(demo.a)
    client.put(url, json={"period": LAST, "currency": "USD", "closing_rate": 3.68, "average_rate": 3.67})
    client.put(url, json={"period": "2026-09", "currency": "USD", "closing_rate": 3.6725, "average_rate": 3.6725})

    run = _start(client, demo.a, scope="group", entity_ids=demo.group[1:] + [usd], agents=["ar_intelligence"])
    consol = _task(client, run, "consolidation", demo.a)["output_json"]
    t = consol["translation"][0]
    capital = 100000 * 3.6725 + 20000 * 3.67
    retained = 5000 * 3.6725 + 10000 * 3.67
    assert t["share_capital_historical"] == pytest.approx(capital) and t["retained_earnings_historical"] == pytest.approx(retained)
    assert t["translation_reserve"] == pytest.approx(135000 * 3.68 - capital - retained, abs=0.01)
    assert t["opening_translation_reserve"] == pytest.approx(0, abs=0.01)
    assert t["translation_difference"] == pytest.approx(1087.5, abs=0.01)
    assert t["estimated_rate_months"] == ["2026-04"]
    assert any("no USD rate entered for 2026-04" in n for n in consol["limitations"])

    bs = next(x for x in consol["entities"] if x["entity_id"] == usd)["bs"]
    assert bs["share_capital"] == pytest.approx(capital) and bs["translation_reserve"] == pytest.approx(1087.5, abs=0.01)
    assert bs["total_liabilities_equity"] == pytest.approx(bs["total_assets"], abs=0.01) and consol["group_bs_balanced"]
    reserve_row = next(r for r in consol["group_bs"] if r["key"] == "translation_reserve")
    assert reserve_row["consolidated"] == pytest.approx(1087.5, abs=0.01)
    pack = client.get(f"{BASE}/runs/{run['id']}/reports/close_pack.json" + q(demo.a)).json()
    section = next(s for s in pack["sections"] if s["title"].startswith("Currency translation"))
    assert "Translation reserve" in section["columns"] and section["rows"][0][-2] == "1,087.50"


def _parts(out, ids):
    return [e for e in out["entities"] if e["entity_id"] in ids]


def test_group_fpa_and_ar_totals_are_in_the_reporting_currency(client, env, demo, session_factory):
    usd = _usd_subsidiary(session_factory)
    group = demo.group[1:] + [usd]
    aed = set(demo.group)

    run = _start(client, demo.a, scope="group", entity_ids=group, agents=["ar_intelligence", "fpa"])
    fpa = _task(client, run, "fpa", demo.a)["output_json"]
    aed_revenue = round(sum(e["revenue"] for e in _parts(fpa, aed)), 2)
    aed_cash = round(sum(e["opening_cash"] for e in _parts(fpa, aed)), 2)
    assert fpa["excluded_entities"] == ["Gnanova US Inc (test)"] and fpa["reporting_currency"] == "AED"
    assert fpa["revenue"] == pytest.approx(aed_revenue)
    assert any("missing 2026-10 exchange rates" in n for n in fpa["limitations"])
    ar = _task(client, run, "ar_intelligence", demo.a)["output_json"]
    assert ar["excluded_entities"] == ["Gnanova US Inc (test)"]

    env.roles[WS_A] = "owner"
    client.put(BASE + "/fx-rates" + q(demo.a), json={"period": LAST, "currency": "USD", "closing_rate": 3.68, "average_rate": 3.67})
    run = _start(client, demo.a, scope="group", entity_ids=group, agents=["ar_intelligence", "fpa"])
    fpa = _task(client, run, "fpa", demo.a)["output_json"]
    own = next(e for e in fpa["entities"] if e["entity_id"] == usd)
    assert own["currency"] == "USD" and own["revenue"] == 10000 and own["opening_cash"] == 115000
    assert fpa["excluded_entities"] == [] and fpa["translation"][0]["closing_rate"] == 3.68
    assert fpa["revenue"] == pytest.approx(aed_revenue + 10000 * 3.67, abs=0.01)
    assert fpa["opening_cash"] == pytest.approx(aed_cash + 115000 * 3.68, abs=0.01)
    base = fpa["rolling_forecast"]["totals"]["base_case"]
    aed_base = sum(e["rolling_forecast"]["totals"]["base_case"]["revenue"] for e in _parts(fpa, aed))
    assert base["revenue"] == pytest.approx(aed_base + own["rolling_forecast"]["totals"]["base_case"]["revenue"] * 3.68, abs=0.05)
    assert [m["day"] for m in fpa["cash_forecast"]["base"]] == [30, 60, 90]
    assert fpa["rolling_forecast"]["history_months"] == 12
    assert any("translated from USD at the closing rate 3.68" in n for n in fpa["limitations"])
    consol = _task(client, run, "consolidation", demo.a)["output_json"]
    assert consol["consolidated_revenue"] + consol["eliminated_revenue"] == pytest.approx(fpa["revenue"], abs=0.05)


def test_translate_output_scales_amounts_only():
    from app.services.ai_close.fx import translate_output

    ar = {"total_outstanding": 1000.0, "open_invoices": 3, "overdue_invoice_count": 2, "match_rate_pct": 50.0,
          "buckets": [{"bucket": "1_30", "amount": 400.0, "invoice_count": 2, "pct": 40.0}],
          "invoices": [{"invoice_id": 7, "amount_due": 400.0, "days_overdue": 12}],
          "customers": [{"total_outstanding": 1000.0, "avg_days_to_pay": 41, "open_invoice_count": 3}]}
    t = translate_output("ar_intelligence", ar, average=3.6, closing=3.7)
    assert t["total_outstanding"] == 3700 and t["buckets"][0] == {"bucket": "1_30", "amount": 1480, "invoice_count": 2, "pct": 40.0}
    assert t["invoices"][0] == {"invoice_id": 7, "amount_due": 1480, "days_overdue": 12}
    assert t["customers"][0]["avg_days_to_pay"] == 41 and t["open_invoices"] == 3 and t["match_rate_pct"] == 50.0
    inv = {"portfolio_value": 100.0, "month_income": 10.0, "limits": {"issuer_pct": 25}, "holdings_count": 4,
           "holdings": [{"market_value": 100.0, "income": 10.0, "return_pct": 1.0}]}
    t = translate_output("investment", inv, average=2.0, closing=3.0)
    assert t == {"portfolio_value": 300, "month_income": 20, "limits": {"issuer_pct": 25}, "holdings_count": 4,
                 "holdings": [{"market_value": 300, "income": 20, "return_pct": 1.0}]}


def test_exchange_rates_need_an_owner_or_designated_treasury_admin(client, env, demo, session_factory):
    url = BASE + "/fx-rates" + q(demo.a)
    body = {"period": LAST, "currency": "USD", "closing_rate": 3.68, "average_rate": 3.67, "source": "CBUAE"}
    env.roles[WS_A] = "finance_manager"
    res = client.put(url, json=body)
    assert res.status_code == 403 and "treasury" in res.json()["detail"]
    settings = client.get(BASE + "/fx-rates/settings" + q(demo.a)).json()
    assert settings["can_edit"] is False and settings["maintainers"] == []
    assert client.put(BASE + "/fx-rates/settings" + q(demo.a), json={"maintainers": [env.email]}).status_code == 403

    env.roles[WS_A] = "owner"
    assert client.put(BASE + "/fx-rates/settings" + q(demo.a), json={"maintainers": ["not-an-email"]}).status_code == 422
    out = client.put(BASE + "/fx-rates/settings" + q(demo.a), json={"maintainers": [" Controller@Example.com "]}).json()
    assert out["maintainers"] == ["controller@example.com"]

    env.roles[WS_A] = "finance_manager"
    assert client.get(BASE + "/fx-rates/settings" + q(demo.a)).json()["can_edit"] is True
    assert client.put(url, json=body).status_code == 200
    row = client.put(url, json={**body, "closing_rate": 3.6725}).json()
    assert row["closing_rate"] == 3.6725 and row["history"][0]["closing_rate"] == 3.68
    assert row["history"][0]["replaced_by"] == env.email
    assert client.put(url, json={**body, "closing_rate": 3.6725}).json()["history"] == row["history"]

    db = session_factory()
    db.add(AccountingPeriod(workspace_id=WS_A, company_id=demo.a, period_number=202609, period_name="Sep 2026",
                            start_date=date(2026, 9, 1), end_date=date(2026, 9, 30), status="locked"))
    db.commit()
    db.close()
    res = client.put(url, json={**body, "period": "2026-09"})
    assert res.status_code == 409 and "locked" in res.json()["detail"]
    env.roles[WS_A] = "accountant"
    assert client.put(url, json=body).status_code == 403
