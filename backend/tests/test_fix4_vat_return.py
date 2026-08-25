"""Unit tests for Fix 4 — FTA box mapping + canonical UAE profile preference."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch


def test_fta_box_zero_rated_output_is_box4():
    from app.services.gulftax_sync_service import _fta_box

    assert _fta_box("zero", "output") == "box4"
    assert _fta_box("reverse_charge", "output") == "box3"
    assert _fta_box("standard", "output") == "box1"
    assert _fta_box("standard", "input") == "box9"


def test_resolve_collapses_duplicate_gnanova_profiles_to_canonical():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    older = MagicMock()
    older.id = "77905042-bc16-48d0-93f9-50190ad1f9e1"
    older.company_name = "Gnanova UAE Test FZE"
    older.created_at = datetime(2026, 1, 1)
    older.reporting_standard = "IFRS"

    newer = MagicMock()
    newer.id = "a3a117fe-557c-4edf-b52d-f56081007b0a"
    newer.company_name = "Gnanova UAE Test FZE"
    newer.created_at = datetime(2026, 6, 1)
    newer.reporting_standard = "IFRS"

    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
        older,
        newer,
    ]

    with patch(
        "app.services.ap_invoice_post_service._ensure_ap_company_for_profile",
        side_effect=lambda _db, _t, p: p.id,
    ) as ensure:
        out = _resolve_company_id_for_je(db, "tenant-1", newer.id)
        assert out == older.id
        ensure.assert_called_once()
        assert ensure.call_args[0][2].id == older.id
