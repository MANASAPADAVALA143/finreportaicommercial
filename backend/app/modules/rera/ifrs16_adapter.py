"""IFRS 16 adapter for RERA OS.

Per project decision, this calls this repo's own local IFRS 16 engine
(app.modules.ifrs16.ifrs16_calculator) directly — there is no external
ifrsai.onrender.com call and no stub. `source` on the returned payload is
always "local_module" so the frontend never needs to show a placeholder
notice.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from app.modules.ifrs16.ifrs16_calculator import IFRS16Calculator, LeaseInput

SOURCE = "local_module"


def _serialize(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(v) for v in obj]
    if isinstance(obj, Decimal):
        return float(obj)
    if hasattr(obj, "to_dict"):  # pandas DataFrame (amortization_schedule)
        return obj.to_dict(orient="records")
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


def compute_amortization_schedule(
    *,
    lease_id: str,
    monthly_payment: float,
    term_months: int,
    commencement_date_iso: str,
    incremental_borrowing_rate: float = 0.065,
    currency: str = "AED",
    asset_description: str = "RERA unit installment lease component",
) -> tuple[dict[str, Any], str]:
    """Direct replacement for the external IFRS.ai `/api/ifrs16/schedule` stub call."""
    commencement = datetime.strptime(commencement_date_iso[:10], "%Y-%m-%d")

    lease = LeaseInput(
        lease_id=lease_id,
        asset_description=asset_description,
        commencement_date=commencement,
        lease_term_months=term_months,
        monthly_payment=Decimal(str(monthly_payment)),
        annual_discount_rate=Decimal(str(incremental_borrowing_rate)),
        currency=currency,
    )
    calculator = IFRS16Calculator()
    results = calculator.calculate_full_ifrs16(lease)
    return _serialize(results), SOURCE


def derive_lease_terms_from_schedule(payment_schedule: list[dict]) -> tuple[float, int] | None:
    """Approximate (monthly_payment, term_months) from a booking's installment schedule.

    RERA off-plan sale installments aren't natively "leases" — this treats the
    average remaining installment as a level monthly payment over the number
    of remaining installments so the local IFRS 16 engine has something to
    amortize. Real lease terms should come from a dedicated lease record once
    one exists.
    """
    remaining = [row for row in (payment_schedule or []) if row.get("amount")]
    if not remaining:
        return None
    total = sum(float(row["amount"]) for row in remaining)
    count = len(remaining)
    if count == 0 or total <= 0:
        return None
    return total / count, count
