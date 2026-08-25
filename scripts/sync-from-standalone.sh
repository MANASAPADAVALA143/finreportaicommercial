#!/bin/bash
# Sync embedded AP Invoice + GulfTax from standalone repos into FinReportAI.
#
#   python scripts/sync-standalone-repos.py
#   # or: bash scripts/sync_gulftax.sh  (post-sync User/auth strip only)
#
# Prerequisites:
#   git fetch apinvoice uaetax
#   OR shallow clones in .sync-tmp/apinvoice and .sync-tmp/uaetax
#
# GulfTax models.py is a selective merge: new VAT/e-invoicing tables sync in,
# but User/auth ORM classes are stripped automatically (scripts/sync_gulftax.sh).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python scripts/sync-standalone-repos.py
