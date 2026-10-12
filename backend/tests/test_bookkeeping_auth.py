"""Bookkeeping: login required; a client id typed in one workspace never reaches another workspace's data."""

from __future__ import annotations

import os
import re
from datetime import datetime
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.bookkeeping as bk_models
from app.api.routes import bookkeeping as bk
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.bookkeeping import BookkeepingTransaction, MissingReceiptRow
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: "accountant"}

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
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, _cid: [])
    monkeypatch.setattr(bk.bookkeeping_engine, "claude_verify_receipt", lambda *_a: {"matches": True})
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [
        obj.__table__
        for obj in vars(bk_models).values()
        if isinstance(obj, type) and hasattr(obj, "__table__") and obj.__module__ == bk_models.__name__
    ]
    Base.metadata.create_all(engine, tables=tables)
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(bk.router)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(factory, env):
    return TestClient(_app(factory, env))


def _txn(factory, client_key: str, *, missing_receipt: bool = False) -> int:
    db = factory()
    try:
        t = BookkeepingTransaction(
            client_id=client_key, period_year=2026, period_month=9,
            txn_date=datetime(2026, 9, 1), description="d", amount=500.0, type="debit",
        )
        db.add(t)
        db.flush()
        if missing_receipt:
            db.add(MissingReceiptRow(transaction_id=t.id, amount=500.0))
        db.commit()
        return t.id
    finally:
        db.close()


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for route in bk.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path + "?client_id=ACME&month=9&year=2026", json={})
    assert res.status_code == 401, res.text


def test_same_label_in_two_workspaces_is_kept_apart(client, env):
    up = client.post(
        "/api/bookkeeping/upload-transactions",
        data={"client_id": "ACME"},
        files={"file": ("bank.csv", b"date,description,amount\n2026-09-01,Coffee,-12.5\n")},
    )
    assert up.status_code == 200, up.text
    assert up.json()["transactions"][0]["client_id"] == "ACME"

    env.workspace = WS_B
    assert client.get("/api/bookkeeping/transactions?client_id=ACME").json()["transactions"] == []
    assert client.get("/api/bookkeeping/review-queue?client_id=ACME").status_code == 200

    env.workspace = WS_A
    assert len(client.get("/api/bookkeeping/transactions?client_id=ACME").json()["transactions"]) == 1


def test_transaction_routes_refuse_other_workspaces_transactions(client, factory):
    theirs = _txn(factory, f"ws:{WS_B}:ACME", missing_receipt=True)
    legacy = _txn(factory, "ACME")
    for tid in (theirs, legacy):
        assert client.post(
            f"/api/bookkeeping/transactions/{tid}/receipt", json={"client_id": "ACME", "receipt_url": "u"}
        ).status_code == 404
        assert client.post(
            "/api/bookkeeping/verify-receipt", json={"client_id": "ACME", "transaction_id": tid, "receipt_text": "t"}
        ).status_code == 404
        assert client.post(
            "/api/bookkeeping/anomaly-action", json={"client_id": "ACME", "transaction_id": tid, "action": "escalate"}
        ).status_code == 404
    assert client.post(
        "/api/bookkeeping/bulk-approve", json={"client_id": "ACME", "transaction_ids": [theirs, legacy]}
    ).json()["approved_count"] == 0
    assert client.post("/api/bookkeeping/receipt-reminder?client_id=ACME", json={}).json()["reminders_logged"] == 0


def test_own_transactions_still_work(client, factory):
    mine = _txn(factory, f"ws:{WS_A}:ACME", missing_receipt=True)
    assert client.post(
        f"/api/bookkeeping/transactions/{mine}/receipt", json={"client_id": "ACME", "receipt_url": "u"}
    ).status_code == 200
    assert client.post(
        "/api/bookkeeping/verify-receipt", json={"client_id": "ACME", "transaction_id": mine, "receipt_text": "t"}
    ).status_code == 200
    profile = client.get("/api/bookkeeping/client-profile/ACME").json()
    assert profile["client_id"] == "ACME"
    assert client.get("/api/bookkeeping/monthly-report?client_id=ACME&month=9&year=2026").json()["client_id"] == "ACME"


def test_other_workspace_or_unknown_company_ids_are_refused(client):
    assert client.get(f"/api/bookkeeping/transactions?client_id={WS_B}").status_code == 403
    assert client.get(f"/api/bookkeeping/accuracy/{WS_B}").status_code == 403


def test_viewer_can_read_but_not_write_and_non_member_is_refused(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/bookkeeping/transactions?client_id=ACME").status_code == 200
    assert client.post("/api/bookkeeping/categorise", json={"client_id": "ACME"}).status_code == 403
    assert client.put("/api/bookkeeping/client-profile/ACME", json={}).status_code == 403

    env.roles.pop(WS_A)
    assert client.get("/api/bookkeeping/transactions?client_id=ACME").status_code == 403
