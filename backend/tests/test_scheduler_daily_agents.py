"""Scheduled variance/forecast agents: one run per workspace, per-workspace memory, no shared alert channel."""

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


def _db(ddl: str, rows: list[tuple]):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text(ddl))
        for stmt in rows:
            conn.execute(text(stmt[0]), stmt[1])
    return sessionmaker(bind=engine)()


@pytest.fixture()
def calls(monkeypatch):
    recorded: dict = {"insight": [], "memory": [], "store": [], "read": []}

    async def read(key, _db):
        recorded["read"].append(key)
        return []

    async def insight(agent, data, _history):
        recorded["insight"].append((agent, data["label"]))
        return {"urgency": "red", "what_happened": data["label"]}

    async def update(key, _data, _db):
        recorded["memory"].append(key)

    async def store(key, _in, _out, _insight, _db, tenant_id=None):
        recorded["store"].append((key, tenant_id))

    async def no_alert(*_a, **_kw):
        raise AssertionError("scheduled agents must not use the shared CFO alert channel")

    monkeypatch.setattr(scheduler, "read_agent_memory", read)
    monkeypatch.setattr(scheduler, "generate_insight", insight)
    monkeypatch.setattr(scheduler, "update_agent_memory", update)
    monkeypatch.setattr(scheduler, "store_agent_run", store)
    monkeypatch.setattr("app.notifications.send_whatsapp_alert", no_alert)
    monkeypatch.setattr("app.notifications.send_email_alert", no_alert)
    return recorded


def _insert(table: str, ws_col: str, ws: str | None, label: str, created: str):
    return (
        f"INSERT INTO {table} ({ws_col}, label, created_at) VALUES (:w, :l, {created})",
        {"w": ws, "l": label},
    )


def test_variance_runs_once_per_workspace_on_its_newest_row(calls):
    db = _db(
        "CREATE TABLE fpa_results (id INTEGER PRIMARY KEY, workspace_id VARCHAR(64), label TEXT, created_at TIMESTAMP)",
        [
            _insert("fpa_results", "workspace_id", WS_A, "A old", "datetime('now', '-2 day')"),
            _insert("fpa_results", "workspace_id", WS_A, "A new", "datetime('now')"),
            _insert("fpa_results", "workspace_id", WS_B, "B new", "datetime('now', '-1 day')"),
            _insert("fpa_results", "workspace_id", None, "untagged newest", "datetime('now', '+1 day')"),
        ],
    )
    insights = asyncio.run(scheduler.run_variance_agent(db))

    assert sorted(i["what_happened"] for i in insights) == ["A new", "B new"]
    assert sorted(calls["insight"]) == [("fpa_variance", "A new"), ("fpa_variance", "B new")]
    assert sorted(calls["store"]) == [(f"fpa_variance:{WS_A}", WS_A), (f"fpa_variance:{WS_B}", WS_B)]
    assert sorted(calls["memory"]) == sorted(calls["read"]) == [f"fpa_variance:{WS_A}", f"fpa_variance:{WS_B}"]


def test_forecast_uses_tenant_id_column(calls):
    db = _db(
        "CREATE TABLE forecast_results (id INTEGER PRIMARY KEY, tenant_id VARCHAR(64), label TEXT, created_at TIMESTAMP)",
        [_insert("forecast_results", "tenant_id", WS_B, "B forecast", "datetime('now')")],
    )
    asyncio.run(scheduler.run_forecast_agent(db))
    assert calls["store"] == [(f"fpa_forecast:{WS_B}", WS_B)]


def test_table_without_workspace_column_is_skipped(calls):
    db = _db(
        "CREATE TABLE fpa_results (id INTEGER PRIMARY KEY, label TEXT, created_at TIMESTAMP)",
        [("INSERT INTO fpa_results (label, created_at) VALUES ('global', datetime('now'))", {})],
    )
    assert asyncio.run(scheduler.run_variance_agent(db)) == []
    assert calls["insight"] == calls["store"] == calls["memory"] == []


def test_missing_tables_are_skipped(calls):
    db = _db("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)", [])
    assert asyncio.run(scheduler.run_variance_agent(db)) == []
    assert asyncio.run(scheduler.run_forecast_agent(db)) == []
