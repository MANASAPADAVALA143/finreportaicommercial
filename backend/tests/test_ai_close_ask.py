"""'Ask this agent': preview runs of one agent, answered from its results."""

from __future__ import annotations

import json

from app.models.uae_accounting_full import UAEJournalEntry
from app.services import llm_service
from app.services.ai_close import ask, orchestrator
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, LAST, PHASE_A, WS_A, _start, client, demo, env, q, sb, session_factory,
)

RECON_PROMPT = ("Perform October bank reconciliation. Match bank transactions with GL entries, identify unmatched "
                "transactions, investigate potential duplicates and prepare a reconciliation summary.")


def _ask(client, cid, agent, prompt, **body):
    res = client.post(f"{BASE}/agents/{agent}/ask" + q(cid), json={"prompt": prompt, **body})
    assert res.status_code == 202, res.text
    return client.get(f"{BASE}/agents/runs/{res.json()['id']}" + q(cid)).json()


def test_period_from_prompt_and_plan():
    assert ask.period_from_prompt(RECON_PROMPT, "2026-10") == "2026-10"
    assert ask.period_from_prompt("Close October", "2026-09") == "2025-10"
    assert ask.period_from_prompt("Review Oct 2026 receivables", None) == "2026-10"
    assert ask.period_from_prompt("Run for 2026-08 please", "2026-10") == "2026-08"
    assert ask.period_from_prompt("Analyse receivables", "2026-10") is None
    assert orchestrator.with_dependencies(["ifrs"]) == ["ar_intelligence", "ifrs"]
    assert orchestrator.with_dependencies(["fpa"]) == ["ap_processing", "ar_intelligence", "fpa"]
    assert ask.plan("consolidation", "group") == ([], ["consolidation"])
    assert ask.plan("bank_reconciliation", "entity") == (["bank_reconciliation"], [])


def test_ask_recon_runs_the_agent_as_a_preview(client, env, demo, session_factory):
    res = _ask(client, demo.a, "bank_reconciliation", RECON_PROMPT)
    assert res["trigger"] == "ask" and res["period"] == LAST and res["status"] == "awaiting_approval"
    assert [t["agent"] for t in res["tasks"]] == ["bank_reconciliation"]
    answer = res["ask"]["answer"]
    assert answer["source"] == "computed" and answer["text"].startswith("Bank Reconciliation Agent — 2026-10")
    assert "would be proposed" in answer["text"] and res["proposals"] == []
    task = client.get(f"{BASE}/runs/{res['id']}/tasks/bank_reconciliation" + q(demo.a)).json()
    assert [j["amount"] for j in task["output_json"]["proposed_journals"]] == [450, 1250]
    assert res["exceptions_total"] == 5

    db = session_factory()
    assert db.query(UAEJournalEntry).filter_by(company_id=demo.a, status="pending_approval").count() == 0
    db.close()
    assert client.get(BASE + "/runs/latest" + q(demo.a)).json() is None
    assert client.get(BASE + "/runs" + q(demo.a)).json() == []
    view = client.get(f"{BASE}/runs/{res['id']}/reports/bank_reconciliation.json" + q(demo.a)).json()
    assert view["sections"][0]["title"] == "Proposed journals (preview - not created)"
    assert "Agent preview" in dict(view["meta"])["Approval status"]
    env.roles[WS_A] = "owner"
    assert client.post(f"{BASE}/runs/{res['id']}/approve-close" + q(demo.a), json={"note": "x"}).status_code == 409
    assert client.post(f"{BASE}/runs/{res['id']}/notify" + q(demo.a), json={}).status_code == 409

    close = _start(client, demo.a, agents=PHASE_A)
    assert sorted(p["amount"] for p in close["proposals"] if p["agent"] == "bank_reconciliation") == [450, 1250]


def test_ask_ifrs_runs_its_dependency_and_verifies_ai_answer(client, env, demo, monkeypatch):
    monkeypatch.setattr(llm_service, "is_configured", lambda: True)
    monkeypatch.setattr(llm_service, "chat", lambda *a, **k: "The lease liability is 1,234,567.89.")
    res = _ask(client, demo.services, "ifrs", "Review October lease accounting under IFRS 16")
    assert [t["agent"] for t in res["tasks"]] == ["ar_intelligence", "ifrs"]
    assert res["ask"]["answer"]["source"] == "computed" and "1,234,567.89" in res["ask"]["answer"]["note"]
    assert "Depreciation" in res["ask"]["answer"]["text"]

    def honest(messages, **_k):
        facts = json.loads(messages[0]["content"].split("RESULTS:\n", 1)[1])
        return f"{facts['results']['checks_evaluated']} checks were evaluated for {facts['period']}."

    monkeypatch.setattr(llm_service, "chat", honest)
    res = _ask(client, demo.services, "ifrs", "Review October lease accounting under IFRS 16")
    assert res["ask"]["answer"] == {"text": "8 checks were evaluated for 2026-10.", "source": "ai", "note": None}


def test_ask_consolidation_needs_a_group_and_roles(client, env, demo):
    res = client.post(f"{BASE}/agents/consolidation/ask" + q(demo.a), json={"prompt": "Consolidate October"})
    assert res.status_code == 422
    group = _ask(client, demo.a, "consolidation", "Consolidate October", scope="group", entity_ids=demo.group[1:])
    assert [t["agent"] for t in group["tasks"]] == ["consolidation"] and group["tasks"][0]["status"] == "completed_with_exceptions"
    assert client.post(f"{BASE}/agents/payroll/ask" + q(demo.a), json={"prompt": "Run payroll"}).status_code == 404
    env.roles[WS_A] = "viewer"
    assert client.post(f"{BASE}/agents/ar_intelligence/ask" + q(demo.a), json={"prompt": "Age receivables"}).status_code == 403
    assert client.get(f"{BASE}/agents/runs/{group['id']}" + q(demo.a)).status_code == 200
