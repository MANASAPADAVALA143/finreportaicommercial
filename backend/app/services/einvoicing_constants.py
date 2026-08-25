"""FTA UAE e-invoicing timeline — single source of truth.

Regulatory references (verify against current FTA / MoF circulars before production):
- Ministerial Decision No. 243 of 2025 — Electronic Invoicing System
- Ministerial Decision No. 244 of 2025 — implementation roadmap (phases, ASP deadlines, go-live)
- Amendment to MD 244 announced 10 May 2026 — Phase 1 ASP appointment extended from
  31 Jul 2026 to 30 Oct 2026 (mandatory go-live 1 Jan 2027 unchanged)

Three dates often confused in code/UI — they are NOT interchangeable:
- VOLUNTARY_PILOT_START (1 Jul 2026): optional testing window; NOT the ASP or mandate deadline
- PHASE_1_ASP_DEADLINE (30 Oct 2026): appoint accredited ASP for revenue ≥ AED 50M
- PHASE_1_MANDATORY (1 Jan 2027): mandatory Peppol PINT AE e-invoicing go-live for Phase 1
"""
from __future__ import annotations

from datetime import date

PHASE_1_THRESHOLD_AED = 50_000_000
PHASE_2_THRESHOLD_AED = 20_000_000

PHASE_1_MANDATORY = date(2027, 1, 1)
PHASE_2_MANDATORY = date(2027, 7, 1)
# Extended from 31 Jul 2026 per MD 244 amendment (10 May 2026); verify against latest FTA notice.
PHASE_1_ASP_DEADLINE = date(2026, 10, 30)
PHASE_2_ASP_DEADLINE = date(2027, 3, 31)

# Voluntary pilot — distinct from ASP appointment and mandatory go-live dates.
VOLUNTARY_PILOT_START = date(2026, 7, 1)
PEPPOL_5_CORNER_ADOPTED = date(2026, 4, 21)
MONTHLY_NON_COMPLIANCE_PENALTY_AED = 5_000

PINT_AE_CUSTOMIZATION_ID = "urn:peppol:pint:billing-1@ae-1"
PINT_AE_PROFILE_ID = "urn:peppol:bis:billing:1.0"

DOCUMENT_TYPE_INVOICE = "380"
DOCUMENT_TYPE_CREDIT_NOTE = "381"

# einvoicing_submissions.record_type — outbound AR vs vendor-received internal archive
RECORD_TYPE_OUTBOUND_AR = "outbound_ar"
RECORD_TYPE_INTERNAL_VENDOR = "internal_vendor_record"
