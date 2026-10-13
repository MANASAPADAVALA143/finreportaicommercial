"""API docs (/docs, /redoc, /openapi.json) are off on Render unless ENABLE_API_DOCS=true."""

from __future__ import annotations

import pytest

from app.main import _api_docs_enabled


@pytest.mark.parametrize(
    ("render", "flag", "expected"),
    [
        (None, None, True),
        ("true", None, False),
        ("true", "true", True),
        ("true", "1", True),
        ("true", "false", False),
        (None, "false", False),
    ],
)
def test_api_docs_enabled(monkeypatch, render, flag, expected):
    for name, value in (("RENDER", render), ("ENABLE_API_DOCS", flag)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    assert _api_docs_enabled() is expected
