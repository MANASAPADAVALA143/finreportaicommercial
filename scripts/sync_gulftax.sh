#!/bin/bash
# Post-sync cleanup for GulfTax ported backend — run after pulling uaetax into ported/.
#
# Usage (standalone):
#   bash scripts/sync_gulftax.sh
#
# Normally invoked automatically by scripts/sync-standalone-repos.py after backend copy.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python scripts/strip_gulftax_ported_models.py
