"""One-shot IFRS TB upload -> AI map -> statements smoke test (run backend first)."""
from __future__ import annotations

import json
import subprocess
import sys
import time

CURL = r"C:\Windows\System32\curl.exe"
BASE = "http://127.0.0.1:8000"
# Prism workbook not in repo; sample CSV exercises the same APIs.
FILE = r"C:\Users\HCSUSER\OneDrive\Desktop\CFO\frontend\public\sample-trial-balance.csv"


def curl_s(args: list[str]) -> str:
    r = subprocess.run([CURL, "-s"] + args, capture_output=True, text=True)
    if r.returncode != 0:
        print("curl stderr:", r.stderr, file=sys.stderr)
    return r.stdout


def main() -> int:
    out = curl_s(
        [
            "-X",
            "POST",
            f"{BASE}/api/ifrs/trial-balance/upload",
            "-F",
            f"file=@{FILE}",
        ]
    )
    upload = json.loads(out)
    tb_id = upload["trial_balance_id"]
    lines_count = upload["lines_count"]
    print("UPLOAD:", json.dumps(upload, indent=2))

    # Upload already queues run_ai_mapping_job; a second map-with-ai can race and duplicate rows.
    # Uncomment to test the explicit endpoint only on a fresh TB with no background job:
    # curl_s(["-X", "POST", f"{BASE}/api/ifrs/trial-balance/{tb_id}/map-with-ai"])

    total = 0
    status = ""
    for i in range(48):
        time.sleep(5)
        mout = curl_s([f"{BASE}/api/ifrs/trial-balance/{tb_id}/mappings"])
        data = json.loads(mout)
        total = data["counts"]["total_mappings"]
        status = data.get("trial_balance_status", "")
        print(f"poll {i + 1}: mappings={total}/{lines_count} status={status}")
        if total >= lines_count and status == "mapped":
            break

    mout = curl_s([f"{BASE}/api/ifrs/trial-balance/{tb_id}/mappings"])
    data = json.loads(mout)
    mappings = data["mappings"]

    def _score(m: dict) -> float:
        v = m.get("ai_confidence_score")
        if v is None:
            return 0.0
        return float(v)

    high = [m for m in mappings if _score(m) >= 0.85]
    low = [m for m in mappings if _score(m) < 0.60]
    empty = [m for m in mappings if not m.get("ifrs_line_item")]

    print()
    print("QUALITY:")
    print(f"  Total mappings: {len(mappings)}")
    print(f"  High confidence (85%+): {len(high)}")
    print(f"  Low confidence (<60%): {len(low)}")
    print(f"  Missing line item: {len(empty)}")
    print("  Sample:")
    for m in mappings[:8]:
        print(
            f"    GL {m.get('gl_code')} -> {m.get('ifrs_line_item', 'EMPTY')} ({_score(m):.0%})"
        )

    gen = curl_s(["-X", "POST", f"{BASE}/api/ifrs/trial-balance/{tb_id}/generate-statements"])
    print()
    print("GENERATE_STATEMENTS:", gen[:2000])

    st_out = curl_s([f"{BASE}/api/ifrs/trial-balance/{tb_id}/statements"])
    st = json.loads(st_out)
    stmts = st.get("statements") or {}
    n_stmt = len(stmts)
    print()
    print("STATEMENTS_KEYS:", list(stmts.keys()))
    print(f"STATEMENT_COUNT: {n_stmt}")

    print()
    print("=== REPORT 6 NUMBERS ===")
    print(f"1. lines_count from upload = {lines_count}")
    print(f"2. Total mappings returned = {len(mappings)}")
    print(f"3. High confidence count = {len(high)}")
    print(f"4. Missing line item count = {len(empty)}")
    print(f"5. Statements generated = {n_stmt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
