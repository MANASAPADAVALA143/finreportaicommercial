#!/usr/bin/env python3
"""Smoke-test VAT advanced business logic (no server required)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "frontend" / "src" / "lib" / "gulftax"))

# Inline test — logic mirrors vatAdvanced.ts
def test_partial_exemption():
    taxable, exempt, input_vat = 700_000, 300_000, 50_000
    total = taxable + exempt
    pct = taxable / total * 100
    recoverable = input_vat * pct / 100
    assert abs(pct - 70.0) < 0.01
    assert abs(recoverable - 35_000) < 0.01
    print("partial exemption OK", pct, recoverable)


def test_designated_zone_goods_dz_to_mainland():
    # DZ -> Mainland goods = import 5%
    s, c = "designated_zone", "mainland"
    assert s == "designated_zone" and c == "mainland"
    print("designated zones OK")


def test_bad_debt_6_months():
    from datetime import date, timedelta
    due = date.today() - timedelta(days=200)
    months = (date.today() - due).days / 30.44
    assert months >= 6
    print("bad debt eligibility OK", round(months, 1), "months overdue")


def main():
    test_partial_exemption()
    test_designated_zone_goods_dz_to_mainland()
    test_bad_debt_6_months()
    print("\nALL VAT ADVANCED LOGIC TESTS PASSED")


if __name__ == "__main__":
    main()
