"""Quick E2E smoke checks for Prabu handover."""
from __future__ import annotations

import sys
from datetime import date

import httpx

BASE = "http://127.0.0.1:8001"
FE = "http://localhost:3006"
WS = "demo"
start = date.today().replace(day=1).isoformat()
end = date.today().isoformat()

results: list[tuple[str, bool, str]] = []


def check(name: str, fn) -> None:
    try:
        ok, detail = fn()
        results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'} | {name}: {detail}")
    except Exception as exc:
        results.append((name, False, str(exc)))
        print(f"FAIL | {name}: {exc}")


def part1():
    r = httpx.get(f"{BASE}/docs", timeout=15)
    return r.status_code == 200, f"status {r.status_code}"


def part2():
    r = httpx.get(
        f"{BASE}/api/integration/gl-summary",
        params={
            "company_id": "demo",
            "workspace_id": WS,
            "period_start": start,
            "period_end": end,
        },
        timeout=20,
    )
    if r.status_code != 200:
        return False, f"status {r.status_code} {r.text[:120]}"
    data = r.json()
    return "has_data" in data, f"has_data={data.get('has_data')} je_count={data.get('je_count')}"


def part3():
    r = httpx.get(
        f"{BASE}/api/entity-health/summary",
        params={"period": date.today().strftime("%Y-%m")},
        headers={"X-Workspace-ID": WS},
        timeout=20,
    )
    if r.status_code != 200:
        return False, f"status {r.status_code}"
    data = r.json()
    entities = data.get("entities") or data.get("data") or []
    count = len(entities) if isinstance(entities, list) else "ok"
    return True, f"entities={count}"


def part4():
    r = httpx.get(
        f"{BASE}/api/company-setup/periods",
        params={"workspace_id": WS},
        timeout=20,
    )
    return r.status_code in (200, 404, 422), f"status {r.status_code}"


def part5():
    body = {
        "vendor_name": "Test Vendor",
        "total_amount": 1500,
        "invoice_number": "INV-E2E",
        "invoice_id": "00000000-0000-0000-0000-000000000001",
        "currency": "AED",
    }
    r = httpx.post(
        f"{BASE}/api/notifications/ap-invoice-uploaded",
        json=body,
        headers={"X-Workspace-ID": WS},
        timeout=20,
    )
    if r.status_code != 200:
        return False, f"status {r.status_code} {r.text[:120]}"
    return "sent" in r.json(), r.text[:160]


def part6():
    r = httpx.get(f"{BASE}/api/notifications", headers={"X-Workspace-ID": WS}, timeout=20)
    return r.status_code == 200, f"status {r.status_code}"


ROUTES = [
    "/ap-invoices/upload",
    "/ap-invoices/approvals",
    "/uae-full/ar",
    "/gulftax/vat-return",
    "/fpa/variance",
    "/consolidation",
]


def main() -> int:
    check("1 Backend health", part1)
    check("2 GL summary API", part2)
    check("3 Entity health API", part3)
    check("4 Company setup periods", part4)
    check("5 AP upload notification", part5)
    check("6 Notifications feed", part6)

    for idx, route in enumerate(ROUTES, start=7):
        name = f"{idx} Route {route}"

        def route_check(rt=route):
            resp = httpx.get(f"{FE}{rt}", timeout=30, follow_redirects=True)
            return resp.status_code == 200, f"status {resp.status_code}"

        check(name, route_check)

    failed = [name for name, ok, _ in results if not ok]
    print("---")
    if failed:
        print("FAILED:", ", ".join(failed))
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
