"""
Regression tests for IFRS16Calculator.calculate_lease_liability (PV of lease
payments) in app/modules/ifrs16/ifrs16_calculator.py.

Root cause covered: `calculate_lease_liability` used to dispatch to the
escalation/CPI-aware `_pv_lease_payments_schedule_based` only when
`not is_advance` — silently excluding every Advance-timing lease with
escalation or CPI from that calculation and falling through to a flat,
non-escalated closed-form formula. Separately, `_pv_lease_payments_schedule_based`
itself never branched on payment_type at all, hardcoding the Arrears exponent.

Both bugs are fixed generically (no lease-ID special-casing) in the PV
function itself, so this test is written generically too: for ANY lease
built from arbitrary parameters, PV computed by the engine must equal PV
computed independently from the exponent(t) rule:
    Arrears: exponent(t) = t,     t = 1..n
    Advance: exponent(t) = t - 1, t = 1..n  (i.e. 0..n-1)
applied consistently whether or not the payment escalates period-to-period.
"""
from decimal import Decimal
from datetime import datetime

import pytest

from app.modules.ifrs16.ifrs16_calculator import IFRS16Calculator, LeaseInput


def _lease(
    payment_type="Arrears",
    monthly_payment=10_000,
    annual_rate=0.085,
    term=36,
    escalation_rate=0.0,
    cpi_index_base=0,
    cpi_index_current=0,
    rent_free_months=0,
):
    return LeaseInput(
        lease_id="TEST-1",
        asset_description="Generic test lease",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=term,
        monthly_payment=Decimal(str(monthly_payment)),
        annual_discount_rate=Decimal(str(annual_rate)),
        payment_type=payment_type,
        escalation_rate=Decimal(str(escalation_rate)),
        cpi_index_base=Decimal(str(cpi_index_base)),
        cpi_index_current=Decimal(str(cpi_index_current)),
        rent_free_months=rent_free_months,
    )


def _independent_pv(
    monthly_payment: Decimal,
    annual_rate: Decimal,
    term_months: int,
    is_advance: bool,
    escalation_rate: Decimal = Decimal("0"),
    rent_free_months: int = 0,
) -> Decimal:
    """PV computed directly from the general exponent(t) rule, independent of
    any code path inside the calculator — the arbiter of correctness."""
    r = annual_rate / 12
    total = Decimal("0")
    for period in range(1, term_months + 1):
        if period <= rent_free_months:
            continue
        cycles_since_start = (period - 1 - rent_free_months) // 12
        pay = monthly_payment * ((Decimal("1") + escalation_rate) ** max(cycles_since_start, 0)) if escalation_rate > 0 else monthly_payment
        exponent = (period - 1) if is_advance else period
        total += pay / ((Decimal("1") + r) ** exponent)
    return total.quantize(Decimal("0.01"))


class TestGenericPvReconciliation:
    """The permanent regression guard: for ANY lease (not specific IDs), the
    engine's calculate_lease_liability() must equal the independently-computed
    PV to within AED 1, regardless of payment_type or escalation."""

    @pytest.mark.parametrize("payment_type", ["Arrears", "Advance"])
    @pytest.mark.parametrize("term", [12, 24, 36, 60, 84, 120])
    def test_plain_lease_reconciles(self, payment_type, term):
        calc = IFRS16Calculator()
        lease = _lease(payment_type=payment_type, term=term)
        engine_pv = calc.calculate_lease_liability(lease)
        expected_pv = _independent_pv(
            Decimal("10000"), Decimal("0.085"), term, payment_type.lower() == "advance"
        )
        assert abs(engine_pv - expected_pv) < 1, (
            f"{payment_type} {term}mo: engine={engine_pv} expected={expected_pv}"
        )

    @pytest.mark.parametrize("payment_type", ["Arrears", "Advance"])
    def test_lease_with_escalation_reconciles(self, payment_type):
        """This is the exact regression: before the fix, Advance leases with
        escalation silently ignored the escalation entirely."""
        calc = IFRS16Calculator()
        lease = _lease(payment_type=payment_type, term=36, escalation_rate=0.05)
        engine_pv = calc.calculate_lease_liability(lease)
        expected_pv = _independent_pv(
            Decimal("10000"), Decimal("0.085"), 36,
            payment_type.lower() == "advance", escalation_rate=Decimal("0.05"),
        )
        assert abs(engine_pv - expected_pv) < 1, (
            f"{payment_type}+escalation: engine={engine_pv} expected={expected_pv}"
        )

    @pytest.mark.parametrize("payment_type", ["Arrears", "Advance"])
    def test_lease_with_cpi_reconciles(self, payment_type):
        calc = IFRS16Calculator()
        lease = _lease(
            payment_type=payment_type, term=36,
            cpi_index_base=100, cpi_index_current=107.5,
        )
        engine_pv = calc.calculate_lease_liability(lease)
        # CPI applies a one-time step-up of current/base ratio from the first review
        # period onward — reuse the engine's own per-period payment function as the
        # oracle for the escalated amount, but keep the exponent(t) rule independent.
        r = Decimal("0.085") / 12
        expected = Decimal("0")
        payment = Decimal("10000")
        for period in range(1, 37):
            new_payment = calc._apply_cpi_and_escalation_payment(lease, period, 0, payment)
            if new_payment != payment:
                payment = new_payment
            exponent = (period - 1) if payment_type.lower() == "advance" else period
            expected += payment / ((Decimal("1") + r) ** exponent)
        expected = expected.quantize(Decimal("0.01"))
        assert abs(engine_pv - expected) < 1, (
            f"{payment_type}+CPI: engine={engine_pv} expected={expected}"
        )

    @pytest.mark.parametrize("payment_type", ["Arrears", "Advance"])
    def test_lease_with_rent_free_and_escalation_reconciles(self, payment_type):
        calc = IFRS16Calculator()
        lease = _lease(
            payment_type=payment_type, term=36, escalation_rate=0.05, rent_free_months=2,
        )
        engine_pv = calc.calculate_lease_liability(lease)
        expected_pv = _independent_pv(
            Decimal("10000"), Decimal("0.085"), 36,
            payment_type.lower() == "advance", escalation_rate=Decimal("0.05"),
            rent_free_months=2,
        )
        assert abs(engine_pv - expected_pv) < 1, (
            f"{payment_type}+rent-free+escalation: engine={engine_pv} expected={expected_pv}"
        )


class TestArrearsUnaffectedByFix:
    """Task 4 — explicit non-regression check: the fix must only change behavior
    for the Advance branch. Arrears leases (with or without escalation) must
    produce byte-identical results before and after."""

    def test_arrears_plain_matches_closed_form_annuity(self):
        calc = IFRS16Calculator()
        lease = _lease(payment_type="Arrears", term=12, annual_rate=0.06)
        engine_pv = calc.calculate_lease_liability(lease)
        # Textbook ordinary annuity closed form, computed independently of the engine.
        r = Decimal("0.06") / 12
        n = 12
        df = (Decimal("1") - (Decimal("1") + r) ** -n) / r
        expected = (Decimal("10000") * df).quantize(Decimal("0.01"))
        assert abs(engine_pv - expected) < 1

    def test_arrears_with_escalation_uses_schedule_based_path(self):
        calc = IFRS16Calculator()
        lease = _lease(payment_type="Arrears", term=36, escalation_rate=0.05)
        engine_pv = calc.calculate_lease_liability(lease)
        expected_pv = _independent_pv(
            Decimal("10000"), Decimal("0.085"), 36, False, escalation_rate=Decimal("0.05")
        )
        assert abs(engine_pv - expected_pv) < 1


class TestAdvanceAmortizationScheduleConsistency:
    """The initial liability figure and the amortization schedule's period-1
    opening balance must always agree — both for plain and escalating Advance
    leases — since 'current carrying value' features read the schedule directly."""

    @pytest.mark.parametrize("escalation_rate", [0.0, 0.05])
    def test_period1_opening_balance_equals_calculated_liability(self, escalation_rate):
        calc = IFRS16Calculator()
        lease = _lease(payment_type="Advance", term=24, escalation_rate=escalation_rate)
        liability = calc.calculate_lease_liability(lease)
        schedule = calc.generate_amortization_schedule(lease, liability)
        first_opening = Decimal(str(schedule.iloc[0]["Opening_Balance"]))
        assert abs(first_opening - liability) < Decimal("0.01")

    def test_advance_period1_has_zero_interest(self):
        calc = IFRS16Calculator()
        lease = _lease(payment_type="Advance", term=24, escalation_rate=0.05)
        liability = calc.calculate_lease_liability(lease)
        schedule = calc.generate_amortization_schedule(lease, liability)
        assert schedule.iloc[0]["Interest"] == 0.0
