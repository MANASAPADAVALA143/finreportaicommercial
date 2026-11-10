"""The full-volume demo group seeds and closes in reasonable time, with the planted issues intact."""

from __future__ import annotations

import time

from app.services.ai_close.demo_group import SCALES, seed_demo_group
from tests.test_ai_close import (  # noqa: F401 - pytest fixtures
    BASE, TODAY, WS_A, client, env, q, sb, session_factory,
)


def test_full_scale_demo_close(client, env, session_factory, sb):
    started = time.monotonic()
    db = session_factory()
    seed = seed_demo_group(db, WS_A, today=TODAY, scale="full")
    db.close()
    seeded = time.monotonic() - started
    ids = [e["id"] for e in seed["entities"]]
    cards, parent_ap, sub_ap = SCALES["full"]

    started = time.monotonic()
    res = client.post(BASE + "/runs" + q(ids[0]), json={"scope": "group", "entity_ids": ids[1:]})
    run = client.get(f"{BASE}/runs/{res.json()['id']}" + q(ids[0])).json()
    closed = time.monotonic() - started
    kpis = {k["key"]: k["value"] for k in run["kpis"]}
    print("\nFULL DEMO", {"seed_s": round(seeded, 1), "close_s": round(closed, 1), **kpis,
                         "proposals": len(run["proposals"]), "revenue": run["cfo_summary"]["performance"]["revenue"],
                         "consolidated_revenue": run["cfo_summary"]["group"]["consolidated_revenue"]})

    assert run["status"] == "awaiting_approval"
    assert kpis["bank_transactions_processed"] > cards and kpis["unmatched_transactions"] == 5
    assert kpis["ap_invoices_processed"] == parent_ap + 7 + 2 * sub_ap
    assert kpis["ap_exceptions"] == 7
    assert closed < 120
