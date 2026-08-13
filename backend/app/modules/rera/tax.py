"""RERA payment tax/escrow split — UAE VAT vs India GST/TDS, by project currency.

UAE (currency == "AED"):
  - Residential off-plan sales are zero-rated (0% VAT) per UAE VAT law.
  - Commercial units attract 5% VAT.
  - No TDS.
India (currency == "INR"):
  - GST 5% on under-construction residential (no input tax credit).
  - TDS 1% under Section 194-IA, applies only when the booking's total
    sale consideration is >= INR 50,00,000 (statutory threshold).
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def compute_payment_tax(
    *,
    currency: str,
    gross_amount: Decimal,
    is_commercial: bool = False,
    booking_total_value: Decimal | None = None,
) -> dict[str, Decimal]:
    """Return {gst_amount, vat_amount, tds_amount, net_amount} for one installment.

    `gross_amount` is treated as the base (pre-tax) installment amount; VAT/GST
    is added on top, TDS is withheld from the net receivable.
    """
    gross_amount = Decimal(str(gross_amount))
    gst_amount = Decimal("0")
    vat_amount = Decimal("0")
    tds_amount = Decimal("0")

    if currency == "AED":
        if is_commercial:
            vat_amount = _q(gross_amount * Decimal("0.05"))
        # residential: zero-rated, vat_amount stays 0
    elif currency == "INR":
        gst_amount = _q(gross_amount * Decimal("0.05"))
        threshold = Decimal("5000000")  # Sec 194-IA: INR 50 lakh
        total_value = Decimal(str(booking_total_value)) if booking_total_value is not None else gross_amount
        if total_value >= threshold:
            tds_amount = _q(gross_amount * Decimal("0.01"))

    net_amount = _q(gross_amount + gst_amount + vat_amount - tds_amount)

    return {
        "gst_amount": gst_amount,
        "vat_amount": vat_amount,
        "tds_amount": tds_amount,
        "net_amount": net_amount,
    }


def compute_escrow_split(*, net_amount: Decimal, escrow_percentage: Decimal) -> Decimal:
    """Portion of a received payment that must be deposited to the RERA escrow account."""
    net_amount = Decimal(str(net_amount))
    escrow_percentage = Decimal(str(escrow_percentage))
    return _q(net_amount * (escrow_percentage / Decimal("100")))


PAN_PATTERN = r"^[A-Z]{5}[0-9]{4}[A-Z]$"
DIN_PATTERN = r"^\d{8}$"
