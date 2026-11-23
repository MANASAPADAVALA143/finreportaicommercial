"""Regression tests for Decimal arithmetic in ai_cfo ledger and detection services.

Verifies that monetary conversions, debit/credit calculations, negative/zero amounts,
spike calculations, budget overrun calculations, and duplicate amounts use
exact Decimal rounding rather than binary float arithmetic.
"""
from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# ledger._money — Decimal conversion
# ---------------------------------------------------------------------------

class TestMoneyConversion:
    def setup_method(self):
        from app.services.ai_cfo.ledger import _money
        self.m = _money

    def test_integer_input(self):
        assert self.m(1000) == 1000.0

    def test_string_numeric(self):
        assert self.m("1234.56") == 1234.56

    def test_none_returns_zero(self):
        assert self.m(None) == 0.0

    def test_zero_string(self):
        assert self.m("0") == 0.0

    def test_negative_amount(self):
        assert self.m(-500.25) == -500.25

    def test_rounds_half_up(self):
        # 1.005 in binary float is actually slightly less, so plain round() gives 1.00
        # Decimal("1.005") quantize ROUND_HALF_UP must give 1.01
        assert self.m("1.005") == 1.01

    def test_avoids_classic_float_error(self):
        # 0.1 + 0.2 in binary float ≠ 0.3; _money("0.3") must be exactly 0.3
        assert self.m("0.3") == 0.30

    def test_very_large_amount(self):
        assert self.m("9999999.99") == 9999999.99

    def test_malformed_string_returns_zero(self):
        assert self.m("not_a_number") == 0.0

    def test_decimal_object_input(self):
        from decimal import Decimal
        assert self.m(Decimal("250.50")) == 250.50


# ---------------------------------------------------------------------------
# ledger.natural — debit/credit sign conventions
# ---------------------------------------------------------------------------

class TestNaturalBalance:
    def setup_method(self):
        from app.services.ai_cfo.ledger import natural
        self.n = natural

    def test_asset_debit_natural(self):
        assert self.n("Asset", 1000.0, 400.0) == 600.0

    def test_expense_debit_natural(self):
        assert self.n("Expense", 300.0, 50.0) == 250.0

    def test_income_credit_natural(self):
        assert self.n("Income", 100.0, 500.0) == 400.0

    def test_liability_credit_natural(self):
        assert self.n("Liability", 200.0, 800.0) == 600.0

    def test_equity_credit_natural(self):
        assert self.n("Equity", 0.0, 1000.0) == 1000.0

    def test_zero_amounts(self):
        assert self.n("Asset", 0.0, 0.0) == 0.0

    def test_negative_net_asset(self):
        # Overdraft: more credit than debit on an asset
        assert self.n("Asset", 100.0, 300.0) == -200.0

    def test_decimal_precision_in_subtraction(self):
        # 0.1 + 0.2 ≠ 0.3 in binary float; natural must round correctly
        assert self.n("Asset", 0.3, 0.1) == pytest.approx(0.2, abs=1e-9)
        # Stricter: should be exactly 0.20 not 0.19999... or 0.20000...001
        result = self.n("Asset", 1.10, 0.90)
        assert result == 0.20


# ---------------------------------------------------------------------------
# detection._materiality — Decimal multiplication precision
# ---------------------------------------------------------------------------

class TestMaterialityCalculation:
    def setup_method(self):
        from app.services.ai_cfo.detection import _materiality, MATERIALITY_FLOOR
        self.mat = _materiality
        self.floor = MATERIALITY_FLOOR

    def test_floor_applied_when_expense_is_low(self):
        assert self.mat(0.0) == self.floor

    def test_share_applied_when_expense_is_high(self):
        # 2% of 1_000_000 = 20_000 > 5_000 floor
        result = self.mat(1_000_000.0)
        assert result == 20_000.0

    def test_result_is_rounded_to_cents(self):
        # 2% of 333_333.33 = 6666.6666 → rounds to 6666.67
        result = self.mat(333_333.33)
        assert result == 6666.67

    def test_no_float_multiplication_error(self):
        # Binary float: 0.02 * 500_050.0 may not be exactly 10001.0
        result = self.mat(500_050.0)
        # 2% of 500_050 = 10001.0 — verify no spurious cents
        assert result == 10001.0


# ---------------------------------------------------------------------------
# detection._r2 / _r4 — rounding helpers
# ---------------------------------------------------------------------------

class TestRoundingHelpers:
    def test_r2_rounds_half_up(self):
        from app.services.ai_cfo.detection import _r2
        assert _r2(2.555) == 2.56

    def test_r2_negative(self):
        from app.services.ai_cfo.detection import _r2
        # ROUND_HALF_UP rounds half away from zero, so -1.005 → -1.01
        assert _r2(-1.005) == -1.01

    def test_r4_rounds_to_4_places(self):
        from app.services.ai_cfo.detection import _r4
        assert _r4(0.12345) == 0.1235

    def test_r2_zero(self):
        from app.services.ai_cfo.detection import _r2
        assert _r2(0.0) == 0.0


# ---------------------------------------------------------------------------
# detection — duplicate overstatement amount
# ---------------------------------------------------------------------------

class TestDuplicateOverstatement:
    """Duplicate amount * (n - 1) must be exact to the cent."""

    def test_two_duplicate_entries(self):
        from app.services.ai_cfo.detection import _r2
        amount = 1234.56
        n = 2
        overstatement = _r2(amount * (n - 1))
        assert overstatement == 1234.56

    def test_three_duplicate_entries(self):
        from app.services.ai_cfo.detection import _r2
        amount = 500.33
        n = 3
        # 500.33 * 2 = 1000.66 exactly (no float drift at this magnitude)
        overstatement = _r2(amount * (n - 1))
        assert overstatement == 1000.66

    def test_potential_float_drift(self):
        from app.services.ai_cfo.detection import _r2
        # Amount whose binary float multiplication accumulates error
        amount = 1.10
        n = 10
        overstatement = _r2(amount * (n - 1))
        assert overstatement == 9.90


# ---------------------------------------------------------------------------
# ledger API response compatibility — _money and natural return float
# ---------------------------------------------------------------------------

class TestApiCompatibility:
    def test_money_returns_float(self):
        from app.services.ai_cfo.ledger import _money
        result = _money("100.00")
        assert isinstance(result, float)

    def test_natural_returns_float(self):
        from app.services.ai_cfo.ledger import natural
        result = natural("Asset", 100.0, 50.0)
        assert isinstance(result, float)

    def test_money_none_returns_float_zero(self):
        from app.services.ai_cfo.ledger import _money
        result = _money(None)
        assert isinstance(result, float)
        assert result == 0.0

    def test_materiality_returns_float(self):
        from app.services.ai_cfo.detection import _materiality
        result = _materiality(100_000.0)
        assert isinstance(result, float)
