"""E2E bank recon verification (run with API already up, e.g. port 8010 or 8000)."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"
ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "uploads" / "samples"


def main() -> None:
    r = requests.get(f"{BASE}/health", timeout=10)
    print("health:", r.status_code, r.text)

    ws = requests.post(
        f"{BASE}/api/recon/workspace",
        json={
            "workspace_name": "Dec 2025 Bank Recon E2E Test",
            "period_start": "2025-12-01",
            "period_end": "2025-12-31",
            "recon_type": "bank_to_gl",
            "currency": "USD",
        },
        timeout=30,
    )
    ws.raise_for_status()
    wid = ws.json()["id"]
    print("workspace_id:", wid)

    for side, path, label in [
        ("book", SAMPLES / "sample_gl.csv", "GL"),
        ("bank", SAMPLES / "sample_bank.csv", "Bank"),
    ]:
        with path.open("rb") as f:
            up = requests.post(
                f"{BASE}/api/recon/workspace/{wid}/upload/{side}",
                files={"file": (path.name, f, "text/csv")},
                timeout=60,
            )
        print(f"upload {label}:", up.status_code, up.text[:500])
        up.raise_for_status()
        j = up.json()
        print(f"  lines_imported={j.get('lines_imported')} dup_exc={j.get('duplicate_exceptions_created')}")

    rm = requests.post(f"{BASE}/api/recon/workspace/{wid}/run-matching", timeout=30)
    print("run-matching:", rm.status_code, rm.text)
    time.sleep(10)

    mr = requests.get(f"{BASE}/api/recon/workspace/{wid}/match-results", timeout=60)
    print("match-results:", mr.status_code)
    mj = mr.json()
    print(json.dumps(mj.get("stats"), indent=2))

    stats = mj.get("stats") or {}
    print("\n--- checklist gates ---")
    print("tier1_exact >= 15:", stats.get("tier1_exact"), ">= 15 ->", stats.get("tier1_exact", 0) >= 15)
    print("tier2_fuzzy > 0:", stats.get("tier2_fuzzy"), "> 0 ->", stats.get("tier2_fuzzy", 0) > 0)
    print("match_rate > 85:", stats.get("match_rate"), "> 85 ->", stats.get("match_rate", 0 ) > 85)
    print("unmatched_bank == 2:", stats.get("unmatched_bank"), "== 2 ->", stats.get("unmatched_bank") == 2)

    # Duplicate exception wiring
    ws2 = requests.post(
        f"{BASE}/api/recon/workspace",
        json={
            "workspace_name": "E2E Dup Test",
            "period_start": "2025-12-01",
            "period_end": "2025-12-31",
            "recon_type": "bank_to_gl",
            "currency": "USD",
        },
        timeout=30,
    )
    ws2.raise_for_status()
    wid2 = ws2.json()["id"]
    dp = SAMPLES / "sample_dup_book.csv"
    with dp.open("rb") as f:
        dup_up = requests.post(
            f"{BASE}/api/recon/workspace/{wid2}/upload/book",
            files={"file": (dp.name, f, "text/csv")},
            timeout=60,
        )
    dup_up.raise_for_status()
    ex = requests.get(f"{BASE}/api/recon/workspace/{wid2}/exceptions", timeout=30)
    exj = ex.json()
    dup_types = []
    for sev, rows in (exj.get("by_severity") or {}).items():
        for row in rows:
            if row.get("exception_type") == "duplicate_detected":
                dup_types.append(row)
    print("dup workspace exception duplicate_detected count:", len(dup_types))

    # Confirm first pending_review match on main workspace
    pending = (mj.get("matches_by_status") or {}).get("pending_review") or []
    auto = (mj.get("matches_by_status") or {}).get("auto_confirmed") or []
    pick = pending[0] if pending else (auto[0] if auto else None)
    mid = pick["id"] if pick else None
    if mid:
        c = requests.patch(
            f"{BASE}/api/recon/workspace/{wid}/match/{mid}/confirm",
            json={"confirmed_by": "test_user"},
            timeout=30,
        )
        print("confirm match:", c.status_code, c.text)

    # Manual match: reject a match to free txns then manual — skip if complex
    adj = requests.post(
        f"{BASE}/api/recon/workspace/{wid}/adjustment",
        json={
            "adjustment_type": "bank_charges",
            "description": "Monthly bank service fee",
            "amount": 25.0,
            "affects_side": "book",
            "journal_entry_required": True,
        },
        timeout=30,
    )
    print("adjustment:", adj.status_code, adj.text[:300])

    det = requests.get(f"{BASE}/api/recon/workspace/{wid}", timeout=30)
    dj = det.json()
    audit = dj.get("audit_trail") or []
    print("audit entries:", len(audit))
    for a in audit[:5]:
        print(" ", a.get("action"), a.get("performed_at"))

    ex_c = requests.post(
        f"{BASE}/api/recon/workspace/{wid}/exception",
        json={
            "exception_type": "unmatched_bank",
            "severity": "medium",
            "description": "E2E manual exception",
        },
        timeout=30,
    )
    print("raise exception:", ex_c.status_code, ex_c.text[:200])


if __name__ == "__main__":
    main()
