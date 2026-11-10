"""Accruals approved in one close are proposed for reversal on day one of the next month."""

from __future__ import annotations

from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, WS_A, _start, client, demo, env, q, sb, session_factory,
)


def _approve(client, cid, proposals):
    for p in proposals:
        assert client.post(f"{BASE}/journals/{p['id']}/decision" + q(cid), json={"decision": "approved"}).status_code == 200


def test_october_accruals_reverse_in_november(client, env, demo):
    env.roles[WS_A] = "owner"
    october = _start(client, demo.a, agents=["ap_processing", "ar_intelligence", "ifrs"])
    grni = next(p for p in october["proposals"] if p["fingerprint"].startswith("grni:"))
    eosb = next(p for p in october["proposals"] if p["fingerprint"].startswith("ifrs:eosb:"))
    _approve(client, demo.a, [grni, eosb])

    november = _start(client, demo.a, period="2026-11", agents=["ar_intelligence", "ifrs"])
    reversals = [p for p in november["proposals"] if p["fingerprint"].startswith("accrual_reversal:")]
    assert [p["fingerprint"] for p in reversals] == [f"accrual_reversal:{grni['id']}"]
    rev = reversals[0]
    assert rev["entry_date"] == "2026-11-01" and rev["title"].startswith("Reverse 2026-10 accrual: Accrue Repairs & Maintenance")
    assert {(l["account_code"], l["debit"], l["credit"]) for l in rev["lines"]} == {("3020", 50000, 0), ("7180", 0, 50000)}
    ifrs_checks = client.get(f"{BASE}/runs/{november['id']}/tasks/ifrs" + q(demo.a)).json()["output_json"]["checks"]
    assert next(c for c in ifrs_checks if c["id"] == "accrual_reversals")["status"] == "failed"

    _approve(client, demo.a, reversals)
    again = _start(client, demo.a, period="2026-11", agents=["ar_intelligence", "ifrs"])
    assert not [p for p in again["proposals"] if p["fingerprint"].startswith("accrual_reversal:")]


def test_recurring_cost_accrual_reverses(client, env, demo):
    env.roles[WS_A] = "owner"
    october = _start(client, demo.logistics, agents=["ar_intelligence", "ifrs"])
    rent = next(p for p in october["proposals"] if p["fingerprint"].startswith("ifrs:accrual:7110"))
    _approve(client, demo.logistics, [rent])
    november = _start(client, demo.logistics, period="2026-11", agents=["ar_intelligence", "ifrs"])
    rev = next(p for p in november["proposals"] if p["fingerprint"] == f"accrual_reversal:{rent['id']}")
    assert {(l["account_code"], l["debit"], l["credit"]) for l in rev["lines"]} == {("3022", 18000, 0), ("7110", 0, 18000)}
