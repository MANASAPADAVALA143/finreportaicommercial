"""Approval controls: segregation of duties and approval limits by amount."""

from __future__ import annotations

import pytest

from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, PHASE_A, WS_A, _start, client, demo, env, q, sb, session_factory,
)


def _decide(client, cid, pid, decision="approved", note=None):
    return client.post(f"{BASE}/journals/{pid}/decision" + q(cid), json={"decision": decision, "note": note})


def test_controls_api_owner_only(client, env, demo):
    url = BASE + "/controls" + q(demo.a)
    assert client.get(url).json() == {"require_segregation": False, "manager_limit": None, "ecl_rates": None, "updated_by": None}
    env.roles[WS_A] = "finance_manager"
    assert client.put(url, json={"require_segregation": True}).status_code == 403
    env.roles[WS_A] = "owner"
    saved = client.put(url, json={"require_segregation": True, "manager_limit": 1000}).json()
    assert saved == {"require_segregation": True, "manager_limit": 1000, "ecl_rates": None, "updated_by": "controller@example.com"}
    assert client.put(url, json={"manager_limit": -5}).status_code == 422
    env.roles[WS_A] = "viewer"
    assert client.get(url).json()["manager_limit"] == 1000


RATES = {"current": 0.02, "1_30": 0.05, "31_60": 0.10, "61_90": 0.25, "90_plus": 0.60}


def test_company_ecl_rates_drive_the_provision_matrix(client, env, demo):
    env.roles[WS_A] = "owner"
    url = BASE + "/controls" + q(demo.a)
    assert client.put(url, json={"ecl_rates": {**RATES, "61_90": 0.05}}).status_code == 422
    assert client.put(url, json={"ecl_rates": {**RATES, "90_plus": 1.5}}).status_code == 422
    assert client.put(url, json={"ecl_rates": RATES}).json()["ecl_rates"] == RATES

    run = _start(client, demo.a, agents=["ar_intelligence", "ifrs"])
    out = client.get(f"{BASE}/runs/{run['id']}/tasks/ifrs" + q(demo.a)).json()["output_json"]
    assert [m["rate_pct"] for m in out["ecl_matrix"]] == [2.0, 5.0, 10.0, 25.0, 60.0]
    assert out["ecl_rates"]["source"] == "company policy" and "company's provision-matrix" in out["limitations"][0]
    required = round(sum(m["ecl"] for m in out["ecl_matrix"]), 2)
    ecl = next(p for p in run["proposals"] if p["fingerprint"].startswith("ifrs:ecl:"))
    assert ecl["amount"] == pytest.approx(required, abs=0.01) and "approved provision-matrix policy" in ecl["rationale"]

    default = _start(client, demo.services, agents=["ar_intelligence", "ifrs"])
    services = client.get(f"{BASE}/runs/{default['id']}/tasks/ifrs" + q(demo.services)).json()["output_json"]
    assert services["ecl_rates"]["source"] == "default" and services["ecl_matrix"][0]["rate_pct"] == 1.0


def test_segregation_of_duties_blocks_the_preparer(client, env, demo):
    env.roles[WS_A] = "owner"
    client.put(BASE + "/controls" + q(demo.a), json={"require_segregation": True})
    run = _start(client, demo.a, agents=PHASE_A)
    assert run["controls"]["require_segregation"] is True
    pid = run["proposals"][0]["id"]
    res = _decide(client, demo.a, pid)
    assert res.status_code == 403 and "Segregation of duties" in res.json()["detail"]
    assert client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "x"}).status_code == 403

    env.email = "cfo@example.com"
    for p in run["proposals"]:
        assert _decide(client, demo.a, p["id"]).status_code == 200
    closed = client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "Reviewed AP and IFRS manually"})
    assert closed.status_code == 200 and closed.json()["close_approved_by"] == "cfo@example.com"


def test_manager_limit_routes_large_journals_to_an_owner(client, env, demo):
    env.roles[WS_A] = "owner"
    client.put(BASE + "/controls" + q(demo.a), json={"manager_limit": 1000})
    run = _start(client, demo.a, agents=PHASE_A)
    small = next(p for p in run["proposals"] if p["amount"] == 450)
    large = next(p for p in run["proposals"] if p["amount"] == 1250)
    env.roles[WS_A] = "finance_manager"
    assert _decide(client, demo.a, small["id"]).status_code == 200
    blocked = _decide(client, demo.a, large["id"])
    assert blocked.status_code == 403 and "approval limit of 1,000.00" in blocked.json()["detail"]
    assert _decide(client, demo.a, large["id"], "rejected").status_code == 200

    rerun = _start(client, demo.a, agents=PHASE_A)
    again = next(p for p in rerun["proposals"] if p["amount"] == 1250)
    env.roles[WS_A] = "owner"
    assert _decide(client, demo.a, again["id"]).status_code == 200
