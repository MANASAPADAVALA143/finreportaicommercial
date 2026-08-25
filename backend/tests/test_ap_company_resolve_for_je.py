"""Unit tests for AP JE company_id resolution (never None)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi import HTTPException


def test_resolve_uses_existing_ap_company_when_raw_is_ap_id():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    db = MagicMock()
    # profiles query → empty; raw ApCompany lookup → hit
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
    db.query.return_value.filter.return_value.first.return_value = MagicMock(id="ap-co-1")

    with patch(
        "app.services.ap_invoice_post_service.resolve_ap_company_id",
        return_value="ap-co-1",
    ):
        assert _resolve_company_id_for_je(db, "tenant-1", "ap-co-1") == "ap-co-1"


def test_resolve_profile_id_ensures_matching_ap_company():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    profile = MagicMock()
    profile.id = "profile-1"
    profile.company_name = "Gnanova UAE Test FZE"
    profile.created_at = datetime.utcnow()

    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [profile]

    with patch(
        "app.services.ap_invoice_post_service._ensure_ap_company_for_profile",
        return_value="profile-1",
    ) as ensure:
        out = _resolve_company_id_for_je(db, "tenant-1", "profile-1")
        assert out == "profile-1"
        ensure.assert_called_once()


def test_resolve_ignores_unrelated_sole_ap_company():
    """Sole ap_companies row (Al Noor) must not win over UAE profiles (Gnanova)."""
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    profile = MagicMock()
    profile.id = "profile-1"
    profile.company_name = "Gnanova UAE Test FZE"
    profile.created_at = datetime.utcnow()

    al_noor = MagicMock()
    al_noor.id = "al-noor"
    al_noor.name = "Al Noor Commercial LLC"

    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [profile]
    db.get.return_value = al_noor

    with patch(
        "app.services.ap_invoice_post_service.resolve_ap_company_id",
        return_value="al-noor",
    ), patch(
        "app.services.ap_invoice_post_service._ensure_ap_company_for_profile",
        return_value="profile-1",
    ) as ensure:
        out = _resolve_company_id_for_je(db, "tenant-1", None, invoice_ref="backfill")
        assert out == "profile-1"
        ensure.assert_called_once()


def test_resolve_falls_back_to_single_uae_profile():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    profile = MagicMock()
    profile.id = "profile-1"
    profile.company_name = "Gnanova UAE Test FZE"
    profile.reporting_standard = "IFRS"
    profile.created_at = datetime.utcnow()

    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [profile]
    db.get.return_value = None

    with patch(
        "app.services.ap_invoice_post_service.resolve_ap_company_id",
        side_effect=HTTPException(status_code=422, detail="unknown"),
    ), patch(
        "app.services.ap_invoice_post_service._ensure_ap_company_for_profile",
        return_value="profile-1",
    ) as ensure:
        out = _resolve_company_id_for_je(db, "tenant-1", "supabase-unknown-id")
        assert out == "profile-1"
        ensure.assert_called_once()


def test_resolve_never_returns_none_creates_default():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []

    with patch(
        "app.services.ap_invoice_post_service.resolve_ap_company_id",
        return_value=None,
    ), patch(
        "app.services.ap_invoice_post_service._ensure_default_ap_company",
        return_value="default-co",
    ):
        assert _resolve_company_id_for_je(db, "tenant-1", None) == "default-co"
