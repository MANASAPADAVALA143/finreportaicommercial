"""Unit tests for AP GL post account mapping and JE line builder."""

from app.services.ap_invoice_post_service import (
    AP_EXPENSE_DEFAULT,
    AP_PAYABLE_CODE,
    AP_VAT_INPUT_CODE,
    _build_ap_je_lines,
    map_ap_gl_code,
)


def test_map_ap_gl_code_legacy_aliases():
    assert map_ap_gl_code("6100") == "7140"
    assert map_ap_gl_code("2100") == "3001"
    assert map_ap_gl_code("1810") == "1110"
    assert map_ap_gl_code("7140") == "7140"


def test_map_ap_gl_code_unknown_passthrough():
    assert map_ap_gl_code("7110") == "7110"


def test_build_ap_je_lines_recoverable_vat():
    lines = _build_ap_je_lines(
        expense_acct=AP_EXPENSE_DEFAULT,
        ap_acct=AP_PAYABLE_CODE,
        vat_acct=AP_VAT_INPUT_CODE,
        expense_debit=1000.0,
        vat_amount=50.0,
        total_amount=1050.0,
        recoverable_vat=True,
        vendor_name="Acme",
        invoice_number="INV-1",
        vat_treatment="standard_rated",
    )
    assert len(lines) == 3
    assert lines[0]["account_code"] == "7140"
    assert lines[0]["debit"] == 1000.0
    assert lines[1]["account_code"] == "1110"
    assert lines[1]["debit"] == 50.0
    assert lines[2]["account_code"] == "3001"
    assert lines[2]["credit"] == 1050.0


def test_build_ap_je_lines_blocked_vat_single_expense_line():
    lines = _build_ap_je_lines(
        expense_acct="7140",
        ap_acct=AP_PAYABLE_CODE,
        vat_acct=AP_VAT_INPUT_CODE,
        expense_debit=1050.0,
        vat_amount=50.0,
        total_amount=1050.0,
        recoverable_vat=False,
        vendor_name="Acme",
        invoice_number="INV-2",
        vat_treatment="blocked",
    )
    assert len(lines) == 2
    assert lines[0]["debit"] == 1050.0
    assert lines[1]["credit"] == 1050.0
