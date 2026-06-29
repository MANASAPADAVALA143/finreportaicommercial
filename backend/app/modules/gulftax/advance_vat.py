"""FTA advance payment VAT — two-step rule (VAT on receipt + VAT at delivery)."""
from __future__ import annotations

import re
from datetime import date
from typing import Any


def _quarter_label(d: date) -> str:
    q = (d.month - 1) // 3 + 1
    return f"{d.year}-Q{q}"


def calculate_advance_vat(
    *,
    invoice_amount: float,
    contract_value: float,
    invoice_date: str,
    delivery_date: str,
    vat_rate: float = 5.0,
) -> dict[str, Any]:
    """Compute FTA two-step advance payment VAT."""
    if invoice_amount <= 0:
        raise ValueError("invoice_amount must be positive")
    if contract_value <= 0:
        raise ValueError("contract_value must be positive")
    if invoice_amount > contract_value:
        raise ValueError("invoice_amount cannot exceed contract_value")

    rate = vat_rate / 100.0
    vat_on_advance = round(invoice_amount * rate, 2)
    remaining_amount = round(contract_value - invoice_amount, 2)
    vat_at_delivery = round(remaining_amount * rate, 2)
    total_vat = round(vat_on_advance + vat_at_delivery, 2)

    inv_dt = date.fromisoformat(invoice_date[:10])
    del_dt = date.fromisoformat(delivery_date[:10]) if delivery_date else None

    # Tax invoice must be issued within 14 days of advance receipt (FTA Art. 59)
    tax_invoice_required_by = inv_dt.isoformat()
    reporting_period = _quarter_label(inv_dt)

    return {
        "vat_on_advance": vat_on_advance,
        "remaining_amount": remaining_amount,
        "vat_at_delivery": vat_at_delivery,
        "total_vat": total_vat,
        "reporting_period": reporting_period,
        "tax_invoice_required_by": tax_invoice_required_by,
        "invoice_date": inv_dt.isoformat(),
        "delivery_date": del_dt.isoformat() if del_dt else None,
        "vat_rate": vat_rate,
    }


def trn_mod97_valid(trn: str) -> bool:
    """Basic UAE TRN format check (15 digits, starts with 1)."""
    t = re.sub(r"\s+", "", trn or "")
    return len(t) == 15 and t.isdigit() and t.startswith("1")
