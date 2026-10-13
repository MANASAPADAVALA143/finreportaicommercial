"""/api/test-aws and /api/setup-aws touch the shared S3 buckets: platform admins only."""

from __future__ import annotations

import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient

from app.core import aws_config
from app.main import app
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
ROUTES = [("GET", "/api/test-aws"), ("POST", "/api/setup-aws")]


@pytest.fixture()
def s3_calls(monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(aws_config, "test_aws_connection", lambda: seen.append("test") or {"UAE": {"status": "connected"}})
    monkeypatch.setattr(aws_config, "create_bucket_folders", lambda: seen.append("setup") or {"UAE": {}})
    return seen


def _as(role: str):
    ctx = WorkspaceContext(
        workspace_id=WS_A,
        workspace=SimpleNamespace(id=WS_A),
        user=SimpleNamespace(id="user-1", email="a@example.com", role=role),
        role=WorkspaceRole.owner,
    )
    app.dependency_overrides[validate_workspace] = lambda: ctx
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.pop(validate_workspace, None)


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_anonymous_is_401(s3_calls, method, path):
    assert TestClient(app, raise_server_exceptions=False).request(method, path).status_code == 401
    assert s3_calls == []


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_workspace_owner_is_403(s3_calls, method, path):
    assert _as("user").request(method, path).status_code == 403
    assert s3_calls == []


def test_platform_admin_can_run_both(s3_calls):
    client = _as("super_admin")
    assert client.get("/api/test-aws").status_code == 200
    assert client.post("/api/setup-aws").status_code == 200
    assert s3_calls == ["test", "setup"]
