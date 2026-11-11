"""AP agent: invoice register, PO/GRN three-way match, duplicates, vendor exceptions,
payment proposals and accruals for goods received but not invoiced.

Reads the company's AP InvoiceFlow tables in Supabase (invoices, purchase_orders,
goods_receipts) and never writes to them. Payment proposals are a list for review; no
payment is made. Accruals are journal drafts that post only after approval.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from app.services.ai_close.context import (
    MATERIALITY_FLOOR,
    AgentOutcome,
    Check,
    CloseContext,
    ExceptionItem,
    JournalDraft,
    money,
    severity,
)
from app.services.ap_bulk_invoice_service import classify_three_way
from app.services.ar_aging_service import BUCKET_LABELS, BUCKET_ORDER, BUCKET_RISK, bucket_key
from app.services.vendor_normalize import normalize_vendor_name

ACCRUED_EXPENSES = ("3020", "Accrued Expenses")
DEFAULT_ACCRUAL_EXPENSE = ("7140", "Professional Fees")
PAYMENT_WINDOW_DAYS = 14
DUPLICATE_WINDOW_DAYS = 7
_CLOSED = {"paid", "rejected"}
_CLOSED_PAYMENT = {"paid", "cancelled"}


PAGE_SIZE = 1000
MAX_ROWS = 50000


def fetch_ap(company_id: str) -> dict[str, Any]:
    """All of the company's AP rows, paged; tables larger than MAX_ROWS are cut off and reported."""
    from app.core.supabase import get_supabase

    sb = get_supabase()
    truncated: list[str] = []

    def rows(table: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        while len(out) < MAX_ROWS:
            page = list(sb.table(table).select("*").eq("company_id", company_id).order("id")
                        .range(len(out), len(out) + PAGE_SIZE - 1).execute().data or [])
            out += page
            if len(page) < PAGE_SIZE:
                return out
        truncated.append(table)
        return out

    data: dict[str, Any] = {t: rows(t) for t in ("invoices", "purchase_orders", "goods_receipts")}
    data["truncated"] = truncated
    return data


def _d(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value if not isinstance(value, datetime) else value.date()
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _num_key(number: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(number or "").lower())


def _is_open(inv: dict[str, Any]) -> bool:
    return (str(inv.get("status") or "").lower() not in _CLOSED
            and str(inv.get("payment_status") or "").lower() not in _CLOSED_PAYMENT)


def _ref(inv: dict[str, Any]) -> dict[str, Any]:
    return {"type": "ap_invoice", "id": inv.get("id"), "ref": inv.get("invoice_number"),
            "date": str(inv.get("invoice_date") or "")[:10], "description": inv.get("vendor_name"),
            "amount": money(inv.get("total_amount"))}


def _no_source(ctx: CloseContext, reason: str) -> AgentOutcome:
    return AgentOutcome(
        records_processed=0,
        output={"invoices_processed": 0, "source_available": False, "limitations": [reason]},
        checks=[Check("ap_source_available", False, reason)],
        exceptions=[ExceptionItem(f"data_gap:ap_source:{ctx.company_id}", "data_gap", "medium",
                                  "AP invoices could not be read", reason)],
        messages=[reason],
    )


def ap_processing(ctx: CloseContext) -> AgentOutcome:
    try:
        data = fetch_ap(ctx.company_id)
    except Exception as exc:  # noqa: BLE001 - reported as a data gap, not a crash
        return _no_source(ctx, f"AP InvoiceFlow store unavailable ({type(exc).__name__}).")

    start, end = ctx.start, ctx.end
    invoices = [i for i in data["invoices"] if (_d(i.get("invoice_date")) or date.max) <= end]
    in_period = [i for i in invoices if start <= (_d(i.get("invoice_date")) or date.min) <= end]
    pos = {str(p.get("po_number") or "").strip().lower(): p for p in data["purchase_orders"] if p.get("po_number")}
    grn_by_po: dict[str, dict[str, Any]] = {}
    for g in data["goods_receipts"]:
        if (_d(g.get("received_date")) or date.max) > end or not g.get("po_id"):
            continue
        prev = grn_by_po.get(str(g["po_id"]))
        if prev is None or str(g.get("status") or "") == "confirmed":
            grn_by_po[str(g["po_id"])] = g

    exceptions: list[ExceptionItem] = []
    match: dict[str, tuple[str, str]] = {}
    for inv in invoices:
        po_no = str(inv.get("po_number") or "").strip()
        po = pos.get(po_no.lower()) if po_no else None
        if po is None:
            match[inv["id"]] = ("no_po", f'No PO found for "{po_no}"' if po_no else "Invoice has no PO number")
            continue
        status, notes, _score = classify_three_way(inv, po, grn_by_po.get(str(po.get("id"))))
        match[inv["id"]] = (status, notes)

    duplicates, possible, held = _duplicates(invoices, in_period, exceptions)

    po_vendors = {normalize_vendor_name(p.get("vendor_name")) for p in data["purchase_orders"]}
    for inv in in_period:
        status, notes = match[inv["id"]]
        amount = money(inv.get("total_amount"))
        if inv["id"] in held:
            pass  # already reported once as a duplicate
        elif status == "mismatch":
            vendor = notes.startswith("Vendor mismatch")
            exceptions.append(ExceptionItem(
                f"ap_match:{inv['id']}", "vendor_exception" if vendor else "ap_match_exception", severity(amount),
                f"{inv.get('vendor_name')} {inv.get('invoice_number')}: {'vendor differs from PO' if vendor else 'amount differs from PO/GRN'} ({amount:,.2f})",
                notes + ". Hold payment until resolved.", amount, [_ref(inv)],
            ))
        elif status in ("partial", "matched"):
            exceptions.append(ExceptionItem(
                f"ap_match:{inv['id']}", "ap_awaiting_grn", "low",
                f"{inv.get('vendor_name')} {inv.get('invoice_number')}: invoiced before goods receipt ({amount:,.2f})",
                notes + ".", amount, [_ref(inv)],
            ))
        elif status == "no_po" and (amount >= MATERIALITY_FLOOR or normalize_vendor_name(inv.get("vendor_name")) in po_vendors):
            exceptions.append(ExceptionItem(
                f"ap_match:{inv['id']}", "ap_no_po", "medium",
                f"{inv.get('vendor_name')} {inv.get('invoice_number')}: no purchase order ({amount:,.2f})",
                notes + "; obtain approval or a retrospective PO before payment.", amount, [_ref(inv)],
            ))
        if not inv.get("vendor_name") or amount <= 0 or not inv.get("invoice_number"):
            exceptions.append(ExceptionItem(
                f"ap_data:{inv['id']}", "vendor_exception", "medium",
                f"Incomplete invoice record {inv.get('invoice_number') or inv['id'][:8]}",
                "Vendor, invoice number or amount is missing.", amount, [_ref(inv)],
            ))

    open_invoices = [i for i in invoices if _is_open(i)]
    for inv in open_invoices:
        status, notes = match[inv["id"]]
        if status == "mismatch":
            held.setdefault(inv["id"], notes)
        elif status in ("partial", "matched"):
            held.setdefault(inv["id"], "Awaiting goods receipt")
    return _finish(ctx, data, invoices, in_period, match, exceptions, duplicates, possible, held, open_invoices)


def _duplicates(invoices: list[dict[str, Any]], in_period: list[dict[str, Any]],
                exceptions: list[ExceptionItem]) -> tuple[list[dict], list[dict], dict[str, str]]:
    duplicates, possible = [], []
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for inv in invoices:
        groups.setdefault((normalize_vendor_name(inv.get("vendor_name")), _num_key(inv.get("invoice_number"))), []).append(inv)
    held: dict[str, str] = {}
    period_ids = {i["id"] for i in in_period}
    for (_vendor, key), group in groups.items():
        if not key or len(group) < 2 or not any(i["id"] in period_ids for i in group):
            continue
        group.sort(key=lambda i: (str(i.get("invoice_date") or ""), str(i.get("created_at") or ""), i["id"]))
        for dup in group[1:]:
            original = group[0]
            amount = money(dup.get("total_amount"))
            duplicates.append({**_ref(dup), "duplicate_of": original.get("invoice_number"), "duplicate_of_id": original["id"]})
            held[dup["id"]] = f"Duplicate of {original.get('invoice_number')}"
            exceptions.append(ExceptionItem(
                f"ap_duplicate:{dup['id']}", "duplicate_invoice", "high",
                f"Duplicate invoice: {dup.get('vendor_name')} {dup.get('invoice_number')} ({amount:,.2f})",
                f"Same supplier and invoice number as {original.get('invoice_number')} dated {str(original.get('invoice_date'))[:10]}. Do not pay twice.",
                amount, [_ref(dup), _ref(original)],
            ))
    by_vendor: dict[str, list[dict[str, Any]]] = {}
    for inv in invoices:
        if inv["id"] not in held:
            by_vendor.setdefault(normalize_vendor_name(inv.get("vendor_name")), []).append(inv)
    for vendor, rows in by_vendor.items():
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                if not ({a["id"], b["id"]} & period_ids) or _num_key(a.get("invoice_number")) == _num_key(b.get("invoice_number")):
                    continue
                da, db_ = _d(a.get("invoice_date")), _d(b.get("invoice_date"))
                if (money(a.get("total_amount")) == money(b.get("total_amount")) and money(a.get("total_amount")) > 0
                        and da and db_ and abs((da - db_).days) <= DUPLICATE_WINDOW_DAYS):
                    first, second = sorted((a, b), key=lambda r: (str(r.get("invoice_date")), r["id"]))
                    possible.append({**_ref(second), "similar_to": first.get("invoice_number")})
                    held.setdefault(second["id"], f"Possible duplicate of {first.get('invoice_number')}")
                    exceptions.append(ExceptionItem(
                        f"ap_possible_duplicate:{first['id']}:{second['id']}", "duplicate_invoice", "medium",
                        f"Possible duplicate: {second.get('vendor_name')} {second.get('invoice_number')} and {first.get('invoice_number')} ({money(second.get('total_amount')):,.2f})",
                        f"Same supplier and amount within {DUPLICATE_WINDOW_DAYS} days. Confirm with the supplier before paying.",
                        money(second.get("total_amount")), [_ref(second), _ref(first)],
                    ))
    return duplicates, possible, held


def _finish(ctx: CloseContext, data: dict[str, list[dict[str, Any]]], invoices: list[dict[str, Any]],
            in_period: list[dict[str, Any]], match: dict[str, tuple[str, str]], exceptions: list[ExceptionItem],
            duplicates: list[dict], possible: list[dict], held: dict[str, str], open_invoices: list[dict[str, Any]]) -> AgentOutcome:
    end = ctx.end
    proposals, buckets = [], {k: {"amount": 0.0, "count": 0} for k in BUCKET_ORDER}
    due_schedule = {"0_30": 0.0, "31_60": 0.0, "61_90": 0.0}
    for inv in open_invoices:
        amount = money(inv.get("total_amount"))
        due = _d(inv.get("due_date")) or end
        key = bucket_key((end - due).days)
        buckets[key]["amount"] += amount
        buckets[key]["count"] += 1
        ahead = (due - end).days
        if ahead <= 30:
            due_schedule["0_30"] += amount
        elif ahead <= 60:
            due_schedule["31_60"] += amount
        elif ahead <= 90:
            due_schedule["61_90"] += amount
        if inv["id"] not in held and ahead <= PAYMENT_WINDOW_DAYS:
            proposals.append({**_ref(inv), "due_date": str(due), "match_status": match[inv["id"]][0],
                              "reason": "Overdue" if ahead < 0 else f"Due within {PAYMENT_WINDOW_DAYS} days"})
    open_total = round(sum(b["amount"] for b in buckets.values()), 2)

    journals: list[JournalDraft] = []
    grni = []
    invoiced_pos = {str(i.get("po_number") or "").strip().lower() for i in invoices if i.get("po_number")}
    invoiced_grn_numbers = {_num_key(i.get("invoice_number")) for i in invoices}
    pos_by_id = {str(p.get("id")): p for p in data["purchase_orders"]}
    grns_evaluated = 0
    for g in data["goods_receipts"]:
        received = _d(g.get("received_date"))
        if not received or received > end or str(g.get("status") or "confirmed") != "confirmed" or money(g.get("received_amount")) <= 0:
            continue
        grns_evaluated += 1
        po = pos_by_id.get(str(g.get("po_id") or ""))
        po_no = str((po or {}).get("po_number") or "").strip()
        if (po_no and po_no.lower() in invoiced_pos) or (g.get("invoice_number") and _num_key(g["invoice_number"]) in invoiced_grn_numbers):
            continue
        amount = money(g.get("received_amount"))
        line = ((po or {}).get("line_items") or [{}])
        line = line[0] if isinstance(line, list) and line else {}
        expense = (str(line.get("account_code") or DEFAULT_ACCRUAL_EXPENSE[0]),
                   str(line.get("account_name") or DEFAULT_ACCRUAL_EXPENSE[1]))
        refs = [{"type": "goods_receipt", "id": g.get("id"), "ref": g.get("grn_number"), "date": str(received), "amount": amount}]
        if po:
            refs.append({"type": "purchase_order", "id": po.get("id"), "ref": po_no, "amount": money(po.get("po_amount"))})
        vendor = g.get("vendor_name") or (po or {}).get("vendor_name")
        grni.append({"grn_number": g.get("grn_number"), "po_number": po_no, "vendor": vendor, "received_date": str(received),
                     "amount": amount, "expense_account": expense[0], "description": (po or {}).get("description")})
        desc = f"{vendor}: {(po or {}).get('description') or 'goods/services received'} (GRN {g.get('grn_number')})"
        journals.append(JournalDraft(
            f"grni:{g.get('id')}", f"Accrue {expense[1]} {amount:,.2f} - goods received not invoiced",
            f"Goods or services were received on {received} under PO {po_no or 'n/a'} from {vendor}, but no supplier "
            f"invoice had been recorded by {end}. The cost belongs to {ctx.period} (accrual basis, IAS 1.27-28), so it "
            "is accrued now and should be reversed when the invoice is posted.",
            end,
            [{"account_code": expense[0], "account_name": expense[1], "debit": amount, "credit": 0, "description": desc},
             {"account_code": ACCRUED_EXPENSES[0], "account_name": ACCRUED_EXPENSES[1], "debit": 0, "credit": amount, "description": desc}],
            refs,
        ))
        exceptions.append(ExceptionItem(
            f"grni:{g.get('id')}", "goods_received_not_invoiced", severity(amount),
            f"Goods received not invoiced: {vendor} GRN {g.get('grn_number')} ({amount:,.2f})",
            f"Received {received}; no supplier invoice by {end}. Accrual proposed.", amount, refs,
        ))

    summary = {k: 0 for k in ("three_way_matched", "matched", "partial", "mismatch", "no_po")}
    for inv in in_period:
        summary[match[inv["id"]][0]] += 1
    register = [
        {**_ref(i), "due_date": str(i.get("due_date") or "")[:10], "po_number": i.get("po_number"),
         "vat": money(i.get("vat_amount") or i.get("tax_amount")), "status": i.get("status"),
         "payment_status": i.get("payment_status"), "match_status": match[i["id"]][0], "match_notes": match[i["id"]][1],
         "hold": held.get(i["id"])}
        for i in sorted(in_period, key=lambda r: (str(r.get("invoice_date")), str(r.get("invoice_number"))))
    ]
    proposal_ids = {p["id"] for p in proposals}
    checks = [
        Check("match_counts_consistent", sum(summary.values()) == len(in_period),
              f"Match outcomes {sum(summary.values())} = invoices in the period {len(in_period)}.", blocking=True),
        Check("holds_excluded_from_payment", not (proposal_ids & set(held)),
              "No held invoice (duplicate, mismatch, awaiting receipt) is proposed for payment.", blocking=True),
        Check("ageing_ties", abs(open_total - sum(money(i.get("total_amount")) for i in open_invoices)) < 0.05,
              f"AP ageing buckets {open_total:,.2f} = open invoices."),
    ]
    if not in_period:
        exceptions.append(ExceptionItem(
            f"data_gap:ap_invoices:{ctx.company_id}:{ctx.period}", "data_gap", "low",
            f"No supplier invoices recorded for {ctx.period}", "Check that the period's supplier invoices have been captured."))
    return AgentOutcome(
        records_processed=len(in_period) + grns_evaluated,
        output={
            "source_available": True, "invoices_processed": len(in_period),
            "invoice_value": round(sum(money(i.get("total_amount")) for i in in_period), 2),
            "match_summary": summary, "register": register[:500],
            "duplicates": duplicates, "possible_duplicates": possible,
            "vendor_exceptions": [e.title for e in exceptions if e.category == "vendor_exception"],
            "payment_proposals": proposals, "payment_proposal_total": round(sum(p["amount"] for p in proposals), 2),
            "held": [{"id": k, "reason": v} for k, v in held.items()],
            "open_ap_total": open_total, "open_ap_overdue": round(open_total - buckets["current"]["amount"], 2),
            "buckets": [{"bucket": k, "label": BUCKET_LABELS[k], "risk": BUCKET_RISK[k], "invoice_count": buckets[k]["count"],
                         "amount": round(buckets[k]["amount"], 2)} for k in BUCKET_ORDER],
            "due_schedule": {k: round(v, 2) for k, v in due_schedule.items()},
            "grni": grni, "grni_total": round(sum(r["amount"] for r in grni), 2), "goods_receipts_evaluated": grns_evaluated,
            "limitations": [
                "Supplier invoices are read from AP InvoiceFlow; they reach the ledger (3001) only once approved and posted, "
                "so a payables control reconciliation is not performed.",
                "Payment proposals are for review only; no payment has been made.",
            ] + [f"Only the first {MAX_ROWS:,} {t.replace('_', ' ')} were read." for t in data.get("truncated", [])],
        },
        checks=checks, exceptions=exceptions, journals=journals,
        messages=[f"Processed {len(in_period)} supplier invoice(s): {summary['three_way_matched']} three-way matched, "
                  f"{summary['mismatch']} mismatched, {len(duplicates) + len(possible)} duplicate(s); "
                  f"{len(proposals)} proposed for payment; {len(grni)} receipt(s) to accrue."],
    )
