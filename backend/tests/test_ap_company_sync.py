"""Tests for AP company sync orphan linking."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.ap_company_sync import _link_orphan_company, sync_ap_company_for_workspace


def _ws(ws_id: str = "ws-aaa-111", name: str = "UAE Client", country: str = "UAE"):
    return SimpleNamespace(id=ws_id, name=name, country=country, industry="general")


def test_link_orphan_single_null_workspace(monkeypatch):
    orphan = {
        "id": "0deaa402-f6a1-4c38-90e8-711f4fd0aa09",
        "name": "My Company",
        "slug": "my-company",
        "workspace_id": None,
        "market": "uae",
    }
    linked = {**orphan, "workspace_id": "ws-aaa-111"}

    sb = MagicMock()
    # .is_("workspace_id","null").execute()
    sb.table.return_value.select.return_value.is_.return_value.execute.return_value = SimpleNamespace(
        data=[orphan]
    )
    # .update().eq().select().maybe_single().execute()
    sb.table.return_value.update.return_value.eq.return_value.select.return_value.maybe_single.return_value.execute.return_value = SimpleNamespace(
        data=linked
    )
    # company_config upsert
    sb.table.return_value.upsert.return_value.execute.return_value = SimpleNamespace(data=None)

    monkeypatch.setattr(
        "app.services.ap_company_sync.get_supabase",
        lambda: sb,
    )

    # First lookup by workspace_id returns nothing
    chain = sb.table.return_value.select.return_value
    # eq().maybe_single().execute() for existing lookup — empty
    chain.eq.return_value.maybe_single.return_value.execute.return_value = SimpleNamespace(data=None)

    result = sync_ap_company_for_workspace(_ws())
    assert result is not None
    assert result["id"] == orphan["id"]
    assert result["workspace_id"] == "ws-aaa-111"
    sb.table.return_value.update.assert_called()


def test_link_orphan_helper_prefers_my_company_slug():
    sb = MagicMock()
    rows = [
        {"id": "a", "name": "Other", "slug": "other", "workspace_id": None, "market": "uae"},
        {"id": "b", "name": "My Company", "slug": "my-company", "workspace_id": None, "market": "uae"},
    ]
    sb.table.return_value.select.return_value.is_.return_value.execute.return_value = SimpleNamespace(data=rows)
    sb.table.return_value.update.return_value.eq.return_value.select.return_value.maybe_single.return_value.execute.return_value = SimpleNamespace(
        data={**rows[1], "workspace_id": "ws-1"}
    )
    sb.table.return_value.upsert.return_value.execute.return_value = SimpleNamespace(data=None)

    out = _link_orphan_company(sb, _ws("ws-1"), "ws-1")
    assert out is not None
    assert out["id"] == "b"
    sb.table.return_value.update.assert_called()
    assert sb.table.return_value.update.call_args[0][0] == {"workspace_id": "ws-1"}
