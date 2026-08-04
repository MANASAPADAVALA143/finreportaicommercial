"""UAE FTA VAT return box assignment by AP (purchase) vs AR (sale) side.

Single source of truth for classifier UI box_number and gulftax_transactions.fta_box.
Does not change AUTO_APPROVE / REVIEW_QUEUE / HARD_BLOCK decisions.
"""
from __future__ import annotations

from typing import Optional


def normalize_transaction_side(
    transaction_type: str | None = None,
    *,
    direction: str | None = None,
    source: str | None = None,
    invoice_type: str | None = None,
) -> str:
    """Return 'purchase' (AP / input) or 'sale' (AR / output)."""
    src = (source or "").lower().strip()
    if src in (
        "ap_invoice",
        "ap_invoiceflow",
        "ap",
        "purchase",
        "vat_classifier_approved",  # default unless sale typed
    ):
        # vat_classifier_approved may be sale — fall through to type/direction
        if src != "vat_classifier_approved":
            return "purchase"
    if src in ("ar_invoice", "ar_invoiceflow", "ar", "sales", "sale"):
        return "sale"

    inv = (invoice_type or "").lower().strip()
    if inv in ("sales", "sale", "ar"):
        return "sale"
    if inv in ("purchase", "purchases", "ap"):
        return "purchase"

    side = (transaction_type or "").lower().strip()
    if side in ("sale", "sales", "output"):
        return "sale"
    if side in ("purchase", "purchases", "input"):
        return "purchase"

    d = (direction or "").lower().strip()
    if d == "output":
        return "sale"
    if d == "input":
        return "purchase"

    return "purchase"


def normalize_vat_treatment(raw: str | None) -> str:
    t = (raw or "standard_rated").lower().replace("-", "_").strip()
    if t in ("standard", "standard_rated"):
        return "standard_rated"
    if t in ("zero", "zero_rated"):
        return "zero_rated"
    if t == "exempt":
        return "exempt"
    if t in ("out_of_scope", "outofscope"):
        return "out_of_scope"
    if t in ("reverse_charge", "rcm", "import_vat", "imports"):
        return "reverse_charge"
    if t in ("blocked", "entertainment", "entertainment_restricted", "non_recoverable"):
        return "blocked"
    return "standard_rated"


def assign_box_number(
    transaction_type: str | None,
    vat_treatment: str | None = None,
    *,
    direction: str | None = None,
    source: str | None = None,
    invoice_type: str | None = None,
    blocked: bool = False,
) -> Optional[int]:
    """Primary FTA box for the net/value line. None = out of return / no box.

    AP (purchase):
      standard_rated / zero_rated / blocked → 9
      reverse_charge (RCM / overseas) → 6
      exempt / out_of_scope → None

    AR (sale):
      standard_rated → 1
      zero_rated → 4
      exempt → 5
      out_of_scope / reverse_charge → None (or 1 fallback only for unknown)
    """
    side = normalize_transaction_side(
        transaction_type, direction=direction, source=source, invoice_type=invoice_type
    )
    treatment = normalize_vat_treatment(vat_treatment)
    if blocked and treatment not in ("reverse_charge", "out_of_scope", "exempt"):
        treatment = "blocked"

    if side == "sale":
        if treatment == "standard_rated":
            return 1
        if treatment == "zero_rated":
            return 4
        if treatment == "exempt":
            return 5
        if treatment in ("out_of_scope", "blocked"):
            return None
        # reverse_charge on sales is unusual — leave off return
        if treatment == "reverse_charge":
            return None
        return 1

    # purchase / AP
    if treatment in ("exempt", "out_of_scope"):
        return None
    if treatment == "reverse_charge":
        return 6
    # standard_rated, zero_rated, blocked → Box 9 (value); VAT recoverable handled in return calc
    return 9


def assign_fta_box(
    transaction_type: str | None,
    vat_treatment: str | None = None,
    *,
    direction: str | None = None,
    source: str | None = None,
    invoice_type: str | None = None,
    blocked: bool = False,
) -> Optional[str]:
    """Return 'boxN' or None for gulftax_transactions.fta_box."""
    n = assign_box_number(
        transaction_type,
        vat_treatment,
        direction=direction,
        source=source,
        invoice_type=invoice_type,
        blocked=blocked,
    )
    if n is None:
        return None
    return f"box{n}"


def direction_for_side(side: str) -> str:
    return "output" if side == "sale" else "input"
