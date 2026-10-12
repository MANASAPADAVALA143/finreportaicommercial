"""Scheduled monthly board pack: one pack per workspace, built only from that workspace's runs."""

from __future__ import annotations

import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import scheduler

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"


@pytest.fixture()
def calls(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE agent_runs (id INTEGER PRIMARY KEY, agent_name VARCHAR(128), insight TEXT, "
            "urgency VARCHAR(10), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, tenant_id VARCHAR(64))"
        ))
        for name, insight, tenant, created in [
            (f"r2r_pattern:{WS_A}", '{"what_happened": "A pattern"}', WS_A, "datetime('now')"),
            (f"fpa_variance:{WS_A}", '{"what_happened": "A variance"}', WS_A, "datetime('now')"),
            (f"r2r_pattern:{WS_B}", '{"what_happened": "B pattern"}', WS_B, "datetime('now')"),
            ("fpa_variance", '{"what_happened": "untagged global"}', None, "datetime('now')"),
            (f"bank_recon:{WS_B}", '{"what_happened": "B stale"}', WS_B, "datetime('now', '-40 day')"),
        ]:
            conn.execute(
                text(f"INSERT INTO agent_runs (agent_name, insight, tenant_id, created_at) VALUES (:n, :i, :t, {created})"),
                {"n": name, "i": insight, "t": tenant},
            )
    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=engine))

    recorded: dict = {"content": [], "pdf": []}

    async def content(results):
        recorded["content"].append(results)
        return {"results": results}

    async def pdf(c, filename):
        recorded["pdf"].append((filename, c["results"]))
        return f"/tmp/{filename}"

    async def no_email(*_a, **_kw):
        raise AssertionError("board packs must not be emailed to the shared CFO address")

    monkeypatch.setattr(scheduler, "generate_board_pack_content", content)
    monkeypatch.setattr(scheduler, "generate_pdf", pdf)
    monkeypatch.setattr(scheduler, "send_email_alert", no_email)
    return recorded


def _texts(results: dict) -> set[str]:
    return {v["what_happened"] for v in results.values()}


def test_each_workspace_gets_its_own_board_pack(calls):
    generated = asyncio.run(scheduler.run_board_pack_agent())

    assert len(generated) == 2
    packs = {filename.split("_")[2]: results for filename, results in calls["pdf"]}
    assert set(packs) == {WS_A, WS_B}
    assert _texts(packs[WS_A]) == {"A pattern", "A variance"}
    assert _texts(packs[WS_B]) == {"B pattern"}
    assert set(packs[WS_A]) == {"r2r_pattern", "fpa_variance"}
    for filename, _ in calls["pdf"]:
        assert filename.startswith("board_pack_") and filename.endswith(".pdf")


def test_no_tagged_runs_means_no_board_pack(calls, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE agent_runs (id INTEGER PRIMARY KEY, agent_name VARCHAR(128), insight TEXT, "
            "urgency VARCHAR(10), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, tenant_id VARCHAR(64))"
        ))
        conn.execute(text("INSERT INTO agent_runs (agent_name, insight) VALUES ('fpa_variance', '{}')"))
    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=engine))

    assert asyncio.run(scheduler.run_board_pack_agent()) == []
    assert calls["pdf"] == []
