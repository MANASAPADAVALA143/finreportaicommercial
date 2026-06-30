#!/usr/bin/env python3
"""Backfill PO links, IFRS categories, seed GRNs, and run 3-way match."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

_BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(_BACKEND / ".env", override=True)
load_dotenv(_BACKEND.parent / "frontend" / ".env", override=True)

base = os.getenv("SUPABASE_URL", os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
key = os.getenv("SUPABASE_KEY", "")
if not base or not key:
    print("Missing SUPABASE_URL / SUPABASE_KEY")
    sys.exit(1)

HEADERS = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

IFRS_KW = [
    (re.compile(r"construction|materials|civil|mep|electrical|installation", re.I), "Industrial Supplies"),
    (re.compile(r"transport|delivery|logistics", re.I), "Travel & Entertainment"),
    (re.compile(r"furniture|office|cleaning", re.I), "Office Supplies"),
    (re.compile(r"utilit|electric|water", re.I), "Utilities"),
    (re.compile(r"architect|design|consult|professional", re.I), "Professional Services"),
    (re.compile(r"internet|telecom|software|\bit\b", re.I), "IT Infrastructure"),
]


def get(path: str) -> list:
    req = urllib.request.Request(f"{base}{path}", headers=HEADERS)
    return json.loads(urllib.request.urlopen(req).read())


def patch(path: str, payload: dict) -> None:
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        headers=HEADERS,
        method="PATCH",
    )
    urllib.request.urlopen(req)


def post(path: str, payload: dict) -> None:
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        headers=HEADERS,
        method="POST",
    )
    urllib.request.urlopen(req)


def net_amount(gross: float, po_amt: float) -> float:
    if po_amt > 0 and gross > po_amt and abs(gross / po_amt - 1.05) < 0.01:
        return round(gross / 1.05, 2)
    return gross


def main() -> None:
    invoices = get(
        "/rest/v1/invoices?select=id,invoice_number,vendor_name,total_amount,po_number,description,ifrs_category,company_id,status"
    )
    pos = get("/rest/v1/purchase_orders?select=id,po_number,vendor_name,po_amount,company_id,status")
    po_by_num = {p["po_number"]: p for p in pos}

    linked = classified = created = matched = 0

    for inv in invoices:
        if not inv.get("po_number"):
            m = re.match(r"INV-(\d{4})-(\d+)$", inv.get("invoice_number") or "")
            if m:
                po_num = f"PO-{m.group(1)}-{m.group(2)}"
                if po_num in po_by_num:
                    patch(f"/rest/v1/invoices?id=eq.{inv['id']}", {"po_number": po_num})
                    inv["po_number"] = po_num
                    linked += 1
                    print(f"linked {inv['invoice_number']} -> {po_num}")

        if not inv.get("ifrs_category"):
            text = f"{inv.get('description') or ''} {inv.get('vendor_name') or ''}"
            cat = next((c for rx, c in IFRS_KW if rx.search(text)), None)
            if cat:
                patch(f"/rest/v1/invoices?id=eq.{inv['id']}", {"ifrs_category": cat, "ifrs_confidence": 80})
                inv["ifrs_category"] = cat
                classified += 1
                print(f"ifrs {inv['invoice_number']} -> {cat}")

    try:
        grns = get("/rest/v1/goods_receipts?select=id,grn_number,po_id,vendor_name,received_amount,status")
    except urllib.error.HTTPError:
        grns = []
    grn_by_po = {g["po_id"]: g for g in grns if g.get("po_id")}
    existing_po_ids = set(grn_by_po.keys())

    for po in pos:
        if str(po["po_number"]).startswith("PO-TEST") or po["id"] in existing_po_ids:
            continue
        m = re.match(r"PO-(\d{4})-(\d+)$", po["po_number"])
        if not m:
            continue
        grn_num = f"GRN-{m.group(1)}-{m.group(2)}"
        try:
            post(
                "/rest/v1/goods_receipts",
                {
                    "grn_number": grn_num,
                    "po_id": po["id"],
                    "vendor_name": po["vendor_name"],
                    "received_amount": float(po["po_amount"]),
                    "received_date": "2026-06-10",
                    "status": "confirmed",
                    "company_id": po.get("company_id"),
                },
            )
            created += 1
            print(f"grn {grn_num} for {po['po_number']}")
            grn_by_po[po["id"]] = {"id": None, "received_amount": po["po_amount"]}
        except urllib.error.HTTPError as e:
            print(f"grn fail {grn_num}: {e.read().decode()[:150]}")

    if not grn_by_po or not any(g.get("id") for g in grns):
        grns = get("/rest/v1/goods_receipts?select=id,grn_number,po_id,received_amount,status")
        grn_by_po = {g["po_id"]: g for g in grns if g.get("po_id")}

    for inv in invoices:
        if inv.get("status") != "Processing":
            continue
        po_num = (inv.get("po_number") or "").strip()
        po = po_by_num.get(po_num) if po_num else None
        if not po:
            print(f"no po: {inv['invoice_number']}")
            continue
        po_amt = float(po.get("po_amount") or 0)
        inv_amt = net_amount(float(inv.get("total_amount") or 0), po_amt)
        diff_pct = abs((inv_amt - po_amt) / po_amt * 100) if po_amt else 100
        grn = grn_by_po.get(po["id"])
        if diff_pct <= 3 and grn:
            status, notes, score = "three_way_matched", f"Full 3-way: {po_num}", 95.0
        elif diff_pct <= 3:
            status, notes, score = "matched", f"2-way: {po_num}", 85.0
        else:
            status, notes, score = "mismatch", f"Variance {diff_pct:.1f}%", 45.0
        patch(
            f"/rest/v1/invoices?id=eq.{inv['id']}",
            {
                "po_id": po["id"],
                "po_number": po_num,
                "grn_id": grn.get("id") if grn else None,
                "match_status": status,
                "match_notes": notes,
                "match_score": score,
                "po_amount": po_amt,
                "grn_amount": float(grn.get("received_amount") or 0) if grn else None,
                "auto_matched": True,
                "grn_confirmed": status == "three_way_matched",
            },
        )
        matched += 1
        print(f"match {inv['invoice_number']} -> {status}")

    print(f"SUMMARY linked={linked} classified={classified} grns={created} matched={matched}")


if __name__ == "__main__":
    main()
