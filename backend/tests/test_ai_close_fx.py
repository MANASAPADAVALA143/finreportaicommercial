"""IAS 21 translation of a foreign-currency subsidiary in the group consolidation."""

from __future__ import annotations

from datetime import date

import pytest

from app.models.company_setup import UaeCompanyProfile
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
