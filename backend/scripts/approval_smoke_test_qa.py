"""QA approval smoke test: rule + submit + approve + GL check.

Uses QA company (my-company). Does not touch demo company.
Works around missing invoices.approval_status / approval_chain_emails
by writing invoice_approvals + the columns that exist today.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from app.core.supabase import get_supabase  # noqa: E402

QA_COMPANY_ID = "0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
APPROVER = "admin@gnanova.com"
# Prefer mid-range Processing invoices from the 100 batch (skip fraud 051-058)
PREFERRED = [
    "UAE-INV-2025-010",
    "UAE-INV-2025-012",
    "UAE-INV-2025-018",
    "UAE-INV-2025-020",
    "UAE-INV-2025-024",
    "UAE-INV-2025-028",
    "UAE-INV-2025-032",
    "UAE-INV-2025-040",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_rule(sb) -> dict:
    existing = (
        sb.table("approval_rules")
        .select("*")
        .eq("company_id", QA_COMPANY_ID)
        .execute()
        .data
        or []
    )
    for r in existing:
        emails = [e.strip().lower() for e in (r.get("approver_emails") or [])]
        if APPROVER.lower() in emails and float(r.get("min_amount") or 0) == 0:
            print(f"Reusing approval rule {r['id']}")
            return r

    payload = {
        "company_id": QA_COMPANY_ID,
        "min_amount": 0,
        "max_amount": None,
        "required_approvers": 1,
        "approver_emails": [APPROVER],
        "department": None,
    }
    res = sb.table("approval_rules").insert(payload).execute()
    rows = list(res.data or [])
    if not rows:
        rows = (
            sb.table("approval_rules")
            .select("*")
            .eq("company_id", QA_COMPANY_ID)
            .execute()
            .data
            or []
        )
    if not rows:
        raise RuntimeError("Failed to create approval_rules row")
    print(f"Created approval rule {rows[0]['id']}")
    return rows[0]


def pick_invoices(sb, n: int = 5) -> list[dict]:
    rows = (
        sb.table("invoices")
        .select(
            "id,invoice_number,vendor_name,total_amount,status,payment_status,"
            "match_status,risk_level,risk_score,po_number,je_posted,je_reference,"
            "approval_rule_id,submitted_for_approval_at"
        )
        .eq("company_id", QA_COMPANY_ID)
        .in_("invoice_number", PREFERRED)
        .execute()
        .data
        or []
    )
    by_num = {r["invoice_number"]: r for r in rows}
    picked: list[dict] = []
    for num in PREFERRED:
        r = by_num.get(num)
        if not r:
            continue
        if (r.get("status") or "") == "Paid":
            continue
        if (r.get("payment_status") or "").lower() == "paid":
            continue
        # skip already submitted
        if r.get("submitted_for_approval_at") or r.get("approval_rule_id"):
            continue
        rl = str(r.get("risk_level") or "").lower()
        if rl in ("high", "critical"):
            continue
        picked.append(r)
        if len(picked) >= n:
            break

    if len(picked) < n:
        # fallback: any Processing UAE-INV not in fraud band
        more = (
            sb.table("invoices")
            .select(
                "id,invoice_number,vendor_name,total_amount,status,payment_status,"
                "match_status,risk_level,risk_score,po_number,je_posted,je_reference,"
                "approval_rule_id,submitted_for_approval_at"
            )
            .eq("company_id", QA_COMPANY_ID)
            .eq("status", "Processing")
            .like("invoice_number", "UAE-INV-2025-%")
            .order("invoice_number")
            .limit(40)
            .execute()
            .data
            or []
        )
        have = {p["id"] for p in picked}
        for r in more:
            if r["id"] in have:
                continue
            num = r.get("invoice_number") or ""
            # skip fraud test band 051-058
            try:
                seq = int(num.split("-")[-1])
            except ValueError:
                seq = 0
            if 51 <= seq <= 58:
                continue
            if r.get("submitted_for_approval_at") or r.get("approval_rule_id"):
                continue
            rl = str(r.get("risk_level") or "").lower()
            if rl in ("high", "critical"):
                continue
            picked.append(r)
            if len(picked) >= n:
                break
    return picked[:n]


def submit_for_approval(sb, inv: dict, rule: dict) -> str:
    """Create pending invoice_approvals row + stamp invoice with available cols."""
    # clear prior approval rows for this invoice
    sb.table("invoice_approvals").delete().eq("invoice_id", inv["id"]).execute()

    ins = (
        sb.table("invoice_approvals")
        .insert(
            {
                "invoice_id": inv["id"],
                "step_index": 0,
                "approver_email": APPROVER,
                "status": "pending",
            }
        )
        .execute()
    )
    row = (ins.data or [None])[0]
    if not row:
        # re-fetch
        rows = (
            sb.table("invoice_approvals")
            .select("*")
            .eq("invoice_id", inv["id"])
            .eq("status", "pending")
            .limit(1)
            .execute()
            .data
            or []
        )
        row = rows[0] if rows else None
    if not row:
        raise RuntimeError(f"Failed to create approval for {inv['invoice_number']}")

    update = {
        "approval_rule_id": rule["id"],
        "current_approver_index": 0,
        "submitted_for_approval_at": now_iso(),
        "approval_submitted_by": "approval-smoke-test@gnanova.com",
        "updated_at": now_iso(),
    }
    # Try optional chain columns if migration was applied
    for optional in (
        ("approval_status", "pending"),
        ("approval_chain_emails", [APPROVER]),
        ("approval_total_steps", 1),
    ):
        try:
            sb.table("invoices").update({optional[0]: optional[1]}).eq("id", inv["id"]).execute()
        except Exception:
            pass

    sb.table("invoices").update(update).eq("id", inv["id"]).execute()
    return row["id"]


def approve_fully(sb, approval_id: str, invoice_id: str) -> dict:
    ts = now_iso()
    sb.table("invoice_approvals").update(
        {"status": "approved", "actioned_at": ts, "comment": "Smoke test approval"}
    ).eq("id", approval_id).execute()

    inv_update = {
        "status": "Approved",
        "approved_at": ts,
        "updated_at": ts,
    }
    try:
        sb.table("invoices").update({**inv_update, "approval_status": "approved"}).eq(
            "id", invoice_id
        ).execute()
    except Exception:
        sb.table("invoices").update(inv_update).eq("id", invoice_id).execute()

    return {"approval_id": approval_id, "invoice_id": invoice_id, "approved_at": ts}


def try_gl_post(invoice_id: str, company_id: str) -> dict:
    """Call backend post-approved endpoint if reachable; else report skip."""
    import os
    import urllib.error
    import urllib.request

    base = (
        os.getenv("VITE_API_URL")
        or os.getenv("API_URL")
        or os.getenv("BACKEND_URL")
        or "http://127.0.0.1:8000"
    ).rstrip("/")
    url = f"{base}/api/uae/ap/post-approved-invoice"
    body = json.dumps(
        {"invoice_id": invoice_id, "company_id": company_id, "workspace_id": ""}
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return {"ok": True, "http": resp.status, "body": json.loads(raw) if raw else {}}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"detail": raw}
        return {"ok": False, "http": e.code, "body": parsed}
    except Exception as e:
        return {"ok": False, "http": None, "body": {"error": str(e)}}


def fetch_gl_for_invoice(sb, invoice_id: str) -> dict:
    inv = (
        sb.table("invoices")
        .select("invoice_number,status,je_posted,je_reference,approved_at,total_amount,vendor_name")
        .eq("id", invoice_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    out: dict = {"invoice": inv[0] if inv else None, "journal": None, "lines": []}
    ref = (inv[0].get("je_reference") if inv else None) or None
    # Try common JE tables
    for table, ref_col in (
        ("journal_entries", "reference"),
        ("uae_journal_entries", "reference"),
        ("gl_journal_entries", "reference"),
    ):
        if not ref:
            break
        try:
            je = (
                sb.table(table)
                .select("*")
                .eq(ref_col, ref)
                .limit(1)
                .execute()
                .data
                or []
            )
            if je:
                out["journal"] = {"table": table, "row": je[0]}
                break
        except Exception:
            continue
    return out


def main() -> int:
    sb = get_supabase()
    print("=== 1) Approval rule ===")
    rule = ensure_rule(sb)
    print(json.dumps({"id": rule["id"], "approver_emails": rule.get("approver_emails"), "min_amount": rule.get("min_amount")}, indent=2))

    print("\n=== 2) Pick + submit invoices ===")
    picked = pick_invoices(sb, n=5)
    if not picked:
        print("No suitable invoices found")
        return 1
    submitted = []
    for inv in picked:
        aid = submit_for_approval(sb, inv, rule)
        submitted.append({"invoice": inv, "approval_id": aid})
        print(
            f"  Pending: {inv['invoice_number']} | {inv['vendor_name']} | "
            f"AED {float(inv['total_amount']):,.2f} | match={inv.get('match_status')} | approval={aid}"
        )

    # Confirm My Approvals query shape
    pending = (
        sb.table("invoice_approvals")
        .select("*")
        .eq("status", "pending")
        .ilike("approver_email", APPROVER)
        .execute()
        .data
        or []
    )
    print(f"\nPending for {APPROVER}: {len(pending)} row(s)")

    print("\n=== 3) Approve first invoice fully ===")
    target = submitted[0]
    approve_fully(sb, target["approval_id"], target["invoice"]["id"])
    print(f"Approved {target['invoice']['invoice_number']}")

    print("\n=== 4) GL post attempt ===")
    gl = try_gl_post(target["invoice"]["id"], QA_COMPANY_ID)
    print(json.dumps(gl, indent=2, default=str))

    detail = fetch_gl_for_invoice(sb, target["invoice"]["id"])
    print("\n=== Invoice after approval ===")
    print(json.dumps(detail, indent=2, default=str))

    remaining = (
        sb.table("invoice_approvals")
        .select("id,invoice_id,status,approver_email")
        .eq("status", "pending")
        .ilike("approver_email", APPROVER)
        .execute()
        .data
        or []
    )
    print(f"\nStill pending for {APPROVER}: {len(remaining)}")
    print(
        json.dumps(
            {
                "rule_id": rule["id"],
                "submitted_count": len(submitted),
                "approved_invoice": target["invoice"]["invoice_number"],
                "gl_post": gl,
                "remaining_pending": len(remaining),
            },
            indent=2,
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
