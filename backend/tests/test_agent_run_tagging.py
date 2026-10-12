"""Variance + forecast agents: login required, runs tagged and memory keyed per workspace."""

from __future__ import annotations

import os
import sys
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.agents.memory as agent_memory
from app.api.routes import cfo_dashboard, fpa_variance
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"

VARIANCE = ("POST", "/api/fpa/variance/calculate", {"line_items": [{"account": "Revenue", "budget": 100, "actual": 120}]})
FORECAST = ("POST", "/api/cfo/forecast?period=month&type=revenue", None)


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "viewer", WS_B: "accountant"}

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(self.workspace)
        return WorkspaceContext(
            workspace_id=self.workspace,
            workspace=SimpleNamespace(id=self.workspace),
            user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


@pytest.fixture()
def memory(monkeypatch):
    store: dict[str, list] = {"fpa_variance": [{"data": "legacy"}], "fpa_forecast": [{"data": "legacy"}]}
    runs: list[tuple[str, str | None]] = []
    seen: list[list] = []

    async def read(name, _db):
        return list(store.get(name, []))

    async def update(name, data, _db):
        store.setdefault(name, []).append({"data": data})

    async def store_run(name, *_args, tenant_id=None):
        runs.append((name, tenant_id))

    async def insight(_agent, _data, history):
        seen.append(history)
        return {}

    monkeypatch.setattr(agent_memory, "read_agent_memory", read)
    monkeypatch.setattr(agent_memory, "update_agent_memory", update)
    monkeypatch.setattr(agent_memory, "store_agent_run", store_run)
    monkeypatch.setitem(sys.modules, "app.agents.intelligence", SimpleNamespace(generate_insight=insight))
    return SimpleNamespace(store=store, runs=runs, seen=seen)


def _app(env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(fpa_variance.router)
    app.include_router(cfo_dashboard.router)
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


def _call(client: TestClient, route):
    method, path, body = route
    return client.request(method, path, json=body)


@pytest.mark.parametrize("route", [VARIANCE, FORECAST], ids=["variance", "forecast"])
def test_requires_login(route):
    assert _call(TestClient(_app(None)), route).status_code == 401


@pytest.mark.parametrize("route,agent", [(VARIANCE, "fpa_variance"), (FORECAST, "fpa_forecast")], ids=["variance", "forecast"])
def test_runs_are_tagged_and_memory_isolated(route, agent, env, memory):
    client = TestClient(_app(env))

    assert _call(client, route).status_code == 200
    env.workspace = WS_B
    assert _call(client, route).status_code == 200
    env.workspace = WS_A
    assert _call(client, route).status_code == 200

    first_a, first_b, second_a = memory.seen
    assert first_a == [] and first_b == [] and len(second_a) == 1
    assert memory.runs == [(f"{agent}:{WS_A}", WS_A), (f"{agent}:{WS_B}", WS_B), (f"{agent}:{WS_A}", WS_A)]
    assert len(memory.store[f"{agent}:{WS_A}"]) == 2 and len(memory.store[f"{agent}:{WS_B}"]) == 1
    assert memory.store[agent] == [{"data": "legacy"}]


@pytest.mark.parametrize("route", [VARIANCE, FORECAST], ids=["variance", "forecast"])
def test_non_member_is_forbidden(route, env, memory):
    env.roles.pop(WS_A)
    assert _call(TestClient(_app(env)), route).status_code == 403
    assert memory.runs == []
