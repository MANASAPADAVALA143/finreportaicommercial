"""Unit tests for AP JE company_id resolution (never None)."""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest


def test_resolve_uses_existing_ap_company_when_resolver_ok():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je

    db = MagicMock()
    with patch(
        "app.services.ap_invoice_post_service.resolve_ap_company_id",
        return_value="ap-co-1",
    ):
        assert _resolve_company_id_for_je(db, "tenant-1", "ap-co-1") == "ap-co-1"


def test_resolve_falls_back_to_single_uae_profile():
    from app.services.ap_invoice_post_service import _resolve_company_id_for_je
    from fastapi import HTTPException

    profile = MagicMock()
    profile.id = "profile-1"
    profile.company_name = "Gnanova UAE Test FZE"
    profile.reporting_standard = "IFRS"
    profile.created_at = datetime.utcnow()

    db = MagicMock()
    # query(UaeCompanyProfile).filter(...).order_by(...).all()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [profile]
    db.get.return_value = None  # no ApCompany with profile id yet

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
