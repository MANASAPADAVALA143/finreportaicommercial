"""FTA UAE e-invoicing timeline — single source of truth."""
from __future__ import annotations

from datetime import date

PHASE_1_THRESHOLD_AED = 50_000_000
PHASE_2_THRESHOLD_AED = 20_000_000

PHASE_1_MANDATORY = date(2027, 1, 1)
PHASE_2_MANDATORY = date(2027, 7, 1)
PHASE_1_ASP_DEADLINE = date(2026, 10, 30)
PHASE_2_ASP_DEADLINE = date(2027, 3, 31)

VOLUNTARY_PILOT_START = date(2026, 7, 1)
PEPPOL_5_CORNER_ADOPTED = date(2026, 4, 21)
MONTHLY_NON_COMPLIANCE_PENALTY_AED = 5_000

PINT_AE_CUSTOMIZATION_ID = "urn:peppol:pint:billing-1@ae-1"
PINT_AE_PROFILE_ID = "urn:peppol:bis:billing:1.0"

DOCUMENT_TYPE_INVOICE = "380"
DOCUMENT_TYPE_CREDIT_NOTE = "381"
