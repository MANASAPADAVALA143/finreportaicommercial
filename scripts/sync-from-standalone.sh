#!/bin/bash
# Sync embedded AP Invoice + GulfTax from standalone repos into FinReportAI.
#
#   python scripts/sync-standalone-repos.py
#
# Prerequisites:
#   git fetch apinvoice uaetax
#   OR shallow clones in .sync-tmp/apinvoice and .sync-tmp/uaetax

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python scripts/sync-standalone-repos.py
