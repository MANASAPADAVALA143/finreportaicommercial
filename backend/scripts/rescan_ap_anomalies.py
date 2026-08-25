"""Rescan AP invoices into invoice_anomalies with identity + sequence rules.

Usage:
  cd backend
  python scripts/rescan_ap_anomalies.py
  python scripts/rescan_ap_anomalies.py --numbers UAE-INV-2025-051,UAE-INV-2025-055,UAE-INV-2025-056,UAE-INV-2025-057
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from app.core.supabase import get_supabase  # noqa: E402
from app.services.ap_anomaly_engine import detect_invoice_anomalies  # noqa: E402


def norm_trn(raw: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def is_placeholder_trn(raw: str | None) -> bool:
    t = norm_trn(raw)
    if not t or len(t) < 5:
        return True
    if "0000000" in t or "1111111" in t:
        return True
    return False


def risk_level(score: float) -> str:
    if score >= 60:
        return "High"
    if score >= 30:
        return "Medium"
    return "Low"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--numbers", help="Comma-separated invoice_number list")
    parser.add_argument("--company-id", default=None)
    args = parser.parse_args()

    sb = get_supabase()
    q = sb.table("invoices").select("*")
    if args.company_id:
        q = q.eq("company_id", args.company_id)
    if args.numbers:
        nums = [n.strip() for n in args.numbers.split(",") if n.strip()]
        q = q.in_("invoice_number", nums)
    invoices = q.execute().data or []
    print(f"Scanning {len(invoices)} invoices…")

    # Preload
    company_ids = list({i["company_id"] for i in invoices if i.get("company_id")})
    all_history: dict[str, list] = defaultdict(list)
    vendors_by_co: dict[str, list] = defaultdict(list)
    for cid in company_ids:
        rows = (
            sb.table("invoices")
            .select(
                "id,invoice_number,vendor_name,total_amount,invoice_date,due_date,"
                "vendor_email,vendor_trn,gstin,status"
            )
            .eq("company_id", cid)
            .execute()
            .data
            or []
        )
        all_history[cid] = rows
        try:
            vendors_by_co[cid] = (
                sb.table("vendors").select("*").eq("company_id", cid).execute().data or []
            )
        except Exception:
            vendors_by_co[cid] = []

    flagged = 0
    for inv in invoices:
        cid = inv["company_id"]
        history = [h for h in all_history.get(cid, []) if h["id"] != inv["id"]]
        vname = (inv.get("vendor_name") or "").strip()
        inv_trn = (inv.get("vendor_trn") or inv.get("gstin") or "").strip()

        masters = vendors_by_co.get(cid, [])
        master = next(
            (v for v in masters if (v.get("name") or "").strip().lower() == vname.lower()),
            None,
        )
        if not master:
            master = next(
                (
                    v
                    for v in masters
                    if vname.lower() in (v.get("name") or "").lower()
                    or (v.get("name") or "").lower() in vname.lower()
                ),
                None,
            )

        prior = [
            h
            for h in history
            if (h.get("vendor_name") or "").strip().lower() == vname.lower()
        ]
        trn_counts: Counter[str] = Counter()
        for h in prior:
            t = norm_trn(h.get("vendor_trn") or h.get("gstin"))
            if t and not is_placeholder_trn(t):
                trn_counts[t] += 1
        consensus = trn_counts.most_common(1)[0][0] if trn_counts else ""
        master_trn = norm_trn(
            (master or {}).get("gstin")
            or (master or {}).get("tax_id")
            or (master or {}).get("trn")
            or consensus
        )
        placeholder = is_placeholder_trn(inv_trn)
        in_master = master is not None
        ghost = (len(masters) > 0 and not in_master) or placeholder
        trn_mismatch = bool(norm_trn(inv_trn) and master_trn and norm_trn(inv_trn) != master_trn)

        po_date = None
        grn_date = None
        po_num = (inv.get("po_number") or "").strip()
        po_id = inv.get("po_id")
        if po_num or po_id:
            pq = sb.table("purchase_orders").select("id,po_date").eq("company_id", cid)
            if po_id:
                pq = pq.eq("id", po_id)
            else:
                pq = pq.ilike("po_number", po_num)
            pos = pq.limit(1).execute().data or []
            if pos:
                po_id = pos[0]["id"]
                po_date = pos[0].get("po_date")
        if po_id:
            grns = (
                sb.table("goods_receipts")
                .select("received_date")
                .eq("po_id", po_id)
                .order("received_date")
                .limit(1)
                .execute()
                .data
                or []
            )
            if grns:
                grn_date = grns[0].get("received_date")

        vendor_ctx = {
            "vendor_age_days": 0 if not prior else 120,
            "in_vendor_master": in_master,
            "flag_ghost_vendor": ghost,
            "placeholder_trn": placeholder,
            "trn_mismatch": trn_mismatch,
            "master_trn": master_trn or None,
            "po_date": po_date,
            "grn_date": grn_date,
        }
        engine_inv = {
            **inv,
            "po_date": po_date,
            "grn_date": grn_date,
        }
        result = detect_invoice_anomalies(engine_inv, history, vendor_ctx)

        # Extra client-like flags
        flags = list(result.get("flags") or [])
        codes = {f["flag_code"] for f in flags}
        if ghost and "GHOST_VENDOR" not in codes:
            flags.append(
                {
                    "anomaly_type": "rule_based",
                    "detection_method": "ghost_vendor",
                    "severity": "critical",
                    "risk_score": 90,
                    "flag_code": "GHOST_VENDOR",
                    "flag_reason": "Vendor not found in Vendor Master (or placeholder TRN)",
                    "flag_details": {"vendor_name": vname, "placeholder_trn": placeholder},
                }
            )
        if trn_mismatch and "VENDOR_IDENTITY_MISMATCH" not in codes:
            flags.append(
                {
                    "anomaly_type": "rule_based",
                    "detection_method": "vendor_identity_mismatch",
                    "severity": "critical",
                    "risk_score": 88,
                    "flag_code": "VENDOR_IDENTITY_MISMATCH",
                    "flag_reason": "Invoice TRN does not match Vendor Master / historical TRN",
                    "flag_details": {"invoice_trn": inv_trn, "master_trn": master_trn},
                }
            )
        inv_date = inv.get("invoice_date")
        if inv_date and po_date and str(inv_date) < str(po_date) and "INVOICE_BEFORE_PO" not in codes:
            flags.append(
                {
                    "anomaly_type": "rule_based",
                    "detection_method": "invoice_before_po",
                    "severity": "high",
                    "risk_score": 80,
                    "flag_code": "INVOICE_BEFORE_PO",
                    "flag_reason": f"Invoice date {inv_date} is before PO date {po_date}",
                    "flag_details": {"invoice_date": inv_date, "po_date": po_date},
                }
            )

        # duplicate number
        for h in history:
            if (
                (h.get("invoice_number") or "").lower() == (inv.get("invoice_number") or "").lower()
                and (h.get("vendor_name") or "").lower() == vname.lower()
            ):
                flags.append(
                    {
                        "anomaly_type": "rule_based",
                        "detection_method": "duplicate",
                        "severity": "high",
                        "risk_score": 75,
                        "flag_code": "DUPLICATE_INVOICE",
                        "flag_reason": f"Duplicate invoice number {inv.get('invoice_number')}",
                        "flag_details": {"other_id": h.get("id")},
                    }
                )
                break

        overall = max((f["risk_score"] for f in flags), default=0)
        # wipe open flags then insert
        sb.table("invoice_anomalies").delete().eq("invoice_id", inv["id"]).eq("status", "open").execute()
        if flags:
            rows = [
                {
                    "invoice_id": inv["id"],
                    "company_id": cid,
                    "anomaly_type": f["anomaly_type"],
                    "detection_method": f["detection_method"],
                    "severity": f["severity"],
                    "risk_score": f["risk_score"],
                    "flag_code": f["flag_code"],
                    "flag_reason": f["flag_reason"],
                    "flag_details": f.get("flag_details") or {},
                    "status": "open",
                }
                for f in flags
            ]
            sb.table("invoice_anomalies").insert(rows).execute()
            flagged += 1

        sb.table("invoices").update(
            {
                "risk_score": overall,
                "risk_level": risk_level(overall),
                "risk_flags": [
                    {
                        "type": f["flag_code"],
                        "severity": f["severity"],
                        "message": f["flag_reason"],
                        "explanation": str(f.get("flag_details") or {}),
                    }
                    for f in flags
                ],
            }
        ).eq("id", inv["id"]).execute()

        print(
            f"{inv['invoice_number']}: score={overall} flags={[f['flag_code'] for f in flags]}"
        )

    print(f"Done. flagged={flagged}/{len(invoices)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
