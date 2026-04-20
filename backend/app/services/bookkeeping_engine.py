"""Rules + Claude categorisation, anomaly detection, GL reconciliation helpers."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from statistics import mean, pstdev
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Company, JournalHistory
from app.models.bookkeeping import (
    AccuracyMetric,
    BookkeepingClientProfile,
    BookkeepingReconciliationRun,
    BookkeepingTransaction,
    ClientRule,
    ClientVendor,
    MissingReceiptRow,
    TransactionCategoryRow,
)
from app.services import llm_service


def _calendar_days_between(a: Any, b: Any) -> int:
    """Safe day diff for datetime/date mix (avoids TypeError on datetime vs date)."""
    from datetime import date, datetime as dt

    def norm(x: Any):
        if x is None:
            return None
        if isinstance(x, dt):
            if x.tzinfo is not None:
                x = x.replace(tzinfo=None)
            return x.date()
        if isinstance(x, date):
            return x
        return None

    da, db_ = norm(a), norm(b)
    if da is None or db_ is None:
        return 9999
    return abs((da - db_).days)


PERSONAL_KEYWORDS = (
    "restaurant",
    "hotel",
    "spa",
    "cinema",
    "netflix",
    "uber eats",
    "doordash",
    "grubhub",
)
TRANSFER_KEYWORDS = ("transfer", "xfer", "trf", "internal transfer", "between accounts", "acct to acct")

# Card / processor keywords — flag for review (clearing vs GL / receipt)
_CC_PATTERN = re.compile(
    r"\b(visa|mastercard|amex|american express|discover card|stripe|paypal|"
    r"square|squareup|adyen|card payment|pos purchase|credit card|debit card)\b",
    re.IGNORECASE,
)


def _extract_json_obj(text: str) -> dict[str, Any] | None:
    t = text.strip()
    m = re.search(r"\{[\s\S]*\}", t)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return None


def _extract_json_list(text: str) -> list | None:
    t = text.strip()
    m = re.search(r"\[[\s\S]*\]", t)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return None


def ensure_client_profile(db: Session, client_id: str) -> BookkeepingClientProfile:
    p = db.query(BookkeepingClientProfile).filter(BookkeepingClientProfile.client_id == client_id).first()
    if not p:
        p = BookkeepingClientProfile(client_id=client_id)
        db.add(p)
        db.flush()
    return p


def get_or_create_accuracy(db: Session, client_id: str, month: int, year: int) -> AccuracyMetric:
    m = (
        db.query(AccuracyMetric)
        .filter(
            AccuracyMetric.client_id == client_id,
            AccuracyMetric.month == month,
            AccuracyMetric.year == year,
        )
        .first()
    )
    if not m:
        m = AccuracyMetric(client_id=client_id, month=month, year=year)
        db.add(m)
        db.flush()
    return m


def _similar_tx_fewshot(db: Session, client_id: str, description: str, limit: int = 5) -> list[dict]:
    q = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .filter(BookkeepingTransaction.category.isnot(None))
        .order_by(BookkeepingTransaction.id.desc())
        .limit(80)
    )
    scored: list[tuple[int, BookkeepingTransaction]] = []
    desc_l = (description or "").lower()
    for tx in q.all():
        r = fuzz.partial_ratio(desc_l, (tx.description or "").lower())
        scored.append((r, tx))
    scored.sort(key=lambda x: -x[0])
    out = []
    for _, tx in scored[:limit]:
        out.append(
            {
                "description": (tx.description or "")[:200],
                "amount": tx.amount,
                "category": tx.category,
            }
        )
    return out


def apply_rules_engine(
    db: Session,
    client_id: str,
    vendor_name: str,
    description: str,
) -> tuple[str | None, float, str | None]:
    rules = db.query(ClientRule).filter(ClientRule.client_id == client_id).all()
    best_cat = None
    best_score = 0.0
    best_pat = None
    needle = (vendor_name or "").lower()
    desc_l = (description or "").lower()
    for r in rules:
        pat = (r.vendor_pattern or "").lower()
        if not pat:
            continue
        fr = fuzz.ratio(needle, pat) if needle else 0
        pr = fuzz.partial_ratio(pat, desc_l)
        score = max(fr, pr)
        if score > best_score:
            best_score = float(score)
            best_cat = r.category
            best_pat = r.vendor_pattern
    if best_score >= 85 and best_cat:
        conf = 0.95
        for r in rules:
            if r.vendor_pattern == best_pat:
                conf = min(0.99, 0.95 + float(r.confidence_boost or 0))
                break
        return best_cat, conf, "rules"
    return None, 0.0, None


def claude_categorise_batch(
    industry: str,
    chart_of_accounts: list[str],
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not items:
        return []
    coa = ", ".join(chart_of_accounts[:40]) if chart_of_accounts else "General expense, Revenue, Payroll, Rent, Utilities, Travel, Meals, Software, Bank fees, Other"
    lines = []
    for i, it in enumerate(items):
        lines.append(
            f"{i + 1}. desc={it['description'][:300]!r} amount={it['amount']} vendor={it.get('vendor_name', '')!r}"
        )
    few = items[0].get("fewshot") or []
    fs = "\n".join(f"  - {x}" for x in few[:5]) if few else "(none)"
    prompt = f"""You are a bookkeeper. Industry: {industry}.
Chart of accounts (pick the best matching label or closest): {coa}

Similar past categorisations for this client:
{fs}

Categorise each numbered transaction. Return ONLY a JSON array of objects, one per line number, with keys:
category (string), confidence (0-1 float), reason (short string).

Transactions:
{chr(10).join(lines)}
"""
    try:
        raw = llm_service.invoke(prompt, max_tokens=1200, temperature=0.2)
    except Exception:
        return [{"category": "Review required", "confidence": 0.5, "reason": "AI unavailable"} for _ in items]
    arr = _extract_json_list(raw)
    if not arr or not isinstance(arr, list):
        return [{"category": "Review required", "confidence": 0.5, "reason": "Could not parse AI response"} for _ in items]
    out = []
    for i in range(len(items)):
        cell = arr[i] if i < len(arr) else {}
        if not isinstance(cell, dict):
            cell = {}
        cat = str(cell.get("category") or "Other")
        conf = float(cell.get("confidence") or 0.7)
        reason = str(cell.get("reason") or "")
        out.append({"category": cat, "confidence": max(0.0, min(1.0, conf)), "reason": reason})
    return out


def categorise_transactions(
    db: Session,
    client_id: str,
    transaction_ids: list[int] | None = None,
    *,
    period_month: int | None = None,
    period_year: int | None = None,
) -> list[BookkeepingTransaction]:
    q = db.query(BookkeepingTransaction).filter(BookkeepingTransaction.client_id == client_id)
    if transaction_ids:
        q = q.filter(BookkeepingTransaction.id.in_(transaction_ids))
    txs = q.order_by(BookkeepingTransaction.id).all()
    if not txs:
        return []

    ids = [t.id for t in txs]
    db.query(TransactionCategoryRow).filter(TransactionCategoryRow.transaction_id.in_(ids)).delete(
        synchronize_session=False
    )

    company = db.query(Company).filter(Company.id == client_id).first()
    industry = company.industry if company else "General"
    prof = ensure_client_profile(db, client_id)
    coa = prof.chart_of_accounts if isinstance(prof.chart_of_accounts, list) else []

    need_ai: list[tuple[BookkeepingTransaction, list[dict]]] = []
    for tx in txs:
        cat, conf, _meth = apply_rules_engine(db, client_id, tx.vendor_name or "", tx.description or "")
        if cat and conf >= 0.85:
            final_conf = conf
            method = "rules"
            reason = "Matched client rule / vendor pattern"
        else:
            need_ai.append((tx, _similar_tx_fewshot(db, client_id, tx.description or "")))
            continue

        tx.category = cat
        tx.confidence = final_conf
        tx.auto_approved = final_conf > 0.95
        tx.flag_for_review = final_conf < 0.80
        db.add(
            TransactionCategoryRow(
                transaction_id=tx.id,
                category=cat,
                confidence=final_conf,
                method=method,
                claude_reason=reason if method == "claude" else None,
            )
        )

    # Batch AI in chunks of 12
    CHUNK = 12
    for i in range(0, len(need_ai), CHUNK):
        chunk = need_ai[i : i + CHUNK]
        payload = [
            {
                "description": t.description or "",
                "amount": t.amount,
                "vendor_name": t.vendor_name or "",
                "fewshot": fs,
            }
            for t, fs in chunk
        ]
        ai_results = claude_categorise_batch(industry, coa, payload)
        for j, (tx, _fs) in enumerate(chunk):
            ar = ai_results[j] if j < len(ai_results) else {"category": "Other", "confidence": 0.6, "reason": "padded"}
            cat = ar.get("category", "Other")
            final_conf = float(ar.get("confidence", 0.75))
            reason = ar.get("reason", "")
            tx.category = cat
            tx.confidence = final_conf
            tx.auto_approved = final_conf > 0.95
            tx.flag_for_review = final_conf < 0.80
            db.add(
                TransactionCategoryRow(
                    transaction_id=tx.id,
                    category=cat,
                    confidence=final_conf,
                    method="claude",
                    claude_reason=reason,
                )
            )

    # Bump accuracy metrics (use first tx period or now)
    y = period_year or (txs[0].period_year if txs[0].period_year else datetime.utcnow().year)
    mo = period_month or (txs[0].period_month if txs[0].period_month else datetime.utcnow().month)
    acc = get_or_create_accuracy(db, client_id, mo, y)
    acc.total_transactions += len(txs)
    acc.auto_approved += sum(1 for t in txs if t.auto_approved)
    acc.flagged += sum(1 for t in txs if t.flag_for_review)
    denom = acc.total_transactions or 1
    acc.accuracy_pct = round(100.0 * acc.auto_approved / denom, 2)

    for tx in txs:
        _upsert_client_vendor(db, client_id, tx)

    db.flush()
    return txs


def _upsert_client_vendor(db: Session, client_id: str, tx: BookkeepingTransaction) -> None:
    vn = (tx.vendor_name or "").strip()
    if not vn:
        return
    row = (
        db.query(ClientVendor)
        .filter(ClientVendor.client_id == client_id, ClientVendor.vendor_name == vn)
        .first()
    )
    if not row:
        db.add(
            ClientVendor(
                client_id=client_id,
                vendor_name=vn,
                category=tx.category,
                avg_amount=float(tx.amount),
                last_seen=tx.txn_date,
                transaction_count=1,
            )
        )
        return
    n = row.transaction_count + 1
    row.avg_amount = ((row.avg_amount or 0) * (n - 1) + float(tx.amount)) / n
    row.transaction_count = n
    row.last_seen = max(row.last_seen or tx.txn_date, tx.txn_date)
    if tx.category:
        row.category = tx.category


def _severity_order(sev: str) -> int:
    return {"critical": 3, "high": 2, "medium": 1}.get(sev.lower(), 0)


def detect_anomalies_for_client(
    db: Session,
    client_id: str,
    transaction_ids: list[int] | None = None,
) -> list[BookkeepingTransaction]:
    q = db.query(BookkeepingTransaction).filter(BookkeepingTransaction.client_id == client_id)
    if transaction_ids:
        q = q.filter(BookkeepingTransaction.id.in_(transaction_ids))
    txs = q.order_by(BookkeepingTransaction.txn_date).all()
    if not txs:
        return []

    prof = ensure_client_profile(db, client_id)
    threshold = float(prof.receipt_threshold or 100.0)

    # Category stats (historical, excluding current batch ids for mean — use all prior for client)
    by_cat: dict[str, list[float]] = defaultdict(list)
    prior = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .filter(BookkeepingTransaction.category.isnot(None))
        .all()
    )
    for p in prior:
        if p.category:
            by_cat[p.category].append(abs(float(p.amount)))

    batch_ids = {t.id for t in txs}

    # Index txs by date for duplicates / transfers
    by_vendor_amount: dict[tuple[str, float], list[BookkeepingTransaction]] = defaultdict(list)
    for t in txs:
        key = ((t.vendor_name or "").strip().lower(), round(float(t.amount), 2))
        by_vendor_amount[key].append(t)

    for tx in txs:
        flags: list[dict[str, Any]] = []
        amt = abs(float(tx.amount))
        cat = tx.category or "Uncategorised"

        # CHECK 1 amount vs category distribution
        amounts = by_cat.get(cat, [])
        if len(amounts) >= 3:
            m = mean(amounts)
            try:
                sd = pstdev(amounts)
            except Exception:
                sd = 0.0
            if sd > 0 and amt > m + 3 * sd:
                flags.append(
                    {
                        "type": "amount_anomaly",
                        "severity": "medium",
                        "message": f"Amount {amt:.2f} exceeds category mean+3σ ({m:.2f}, σ={sd:.2f})",
                        "action": "Verify supporting documentation",
                    }
                )
            elif sd > 0 and amt >= 2 * m and m > 0:
                flags.append(
                    {
                        "type": "amount_spike",
                        "severity": "medium",
                        "message": f"Amount is 2×+ typical for category ({m:.2f})",
                        "action": "Review with budget owner",
                    }
                )

        # CHECK 2 new vendor (prior activity outside this batch only — not skewed by categorise upserts)
        vn_key = (tx.vendor_name or "").strip().lower()
        if vn_key and vn_key != "unknown":
            q_prior = (
                db.query(BookkeepingTransaction)
                .filter(BookkeepingTransaction.client_id == client_id)
                .filter(func.lower(BookkeepingTransaction.vendor_name) == vn_key)
            )
            if batch_ids:
                q_prior = q_prior.filter(~BookkeepingTransaction.id.in_(batch_ids))
            latest_prior = q_prior.order_by(BookkeepingTransaction.txn_date.desc()).first()
            now = datetime.utcnow()
            stale = (
                latest_prior is None
                or latest_prior.txn_date is None
                or _calendar_days_between(latest_prior.txn_date, now) > 183
            )
            if stale:
                flags.append(
                    {
                        "type": "new_vendor",
                        "severity": "high",
                        "message": "Vendor first seen in this batch or not seen in the last 6 months",
                        "action": "Validate vendor onboarding and approval",
                    }
                )

        # CHECK 3 duplicates / similar
        peers = by_vendor_amount.get((vn_key, round(amt, 2)), [])
        if len(peers) > 1:
            for a in peers:
                for b in peers:
                    if a.id >= b.id:
                        continue
                    if _calendar_days_between(a.txn_date, b.txn_date) <= 7:
                        flags.append(
                            {
                                "type": "duplicate_payment",
                                "severity": "critical",
                                "message": "Same vendor and amount within 7 days",
                                "action": "Confirm duplicate or reverse one payment",
                            }
                        )
                        break
        for other in txs:
            if other.id == tx.id:
                continue
            if (other.vendor_name or "").lower() != vn_key or not vn_key:
                continue
            if abs(other.amount - tx.amount) / max(amt, 1e-6) <= 0.02 and _calendar_days_between(other.txn_date, tx.txn_date) <= 7:
                flags.append(
                    {
                        "type": "similar_amount",
                        "severity": "medium",
                        "message": "Similar amount (within 2%) to another txn from same vendor within 7 days",
                        "action": "Check for duplicate or split payment",
                    }
                )
                break

        # CHECK 4 round numbers (whole dollars ending in 00)
        if amt > 500 and abs(amt - round(amt, 2)) < 1e-6:
            whole = int(round(amt))
            if whole % 100 == 0:
                flags.append(
                    {
                        "type": "round_number",
                        "severity": "high",
                        "message": "Round amount > 500 - possible owner draw",
                        "action": "Confirm business purpose or reclassify equity draw",
                    }
                )

        # CHECK 5 weekend
        wd = tx.txn_date.weekday()
        if not prof.weekend_operations and wd >= 5:
            flags.append(
                {
                    "type": "weekend_transaction",
                    "severity": "high",
                    "message": "Transaction on weekend while client profile disallows weekend operations",
                    "action": "Verify transaction date or update client profile",
                }
            )

        # CHECK 6 missing receipt
        if amt > threshold and not (tx.receipt_url):
            flags.append(
                {
                    "type": "missing_receipt",
                    "severity": "medium",
                    "message": f"Amount exceeds receipt threshold ({threshold}) and no receipt uploaded",
                    "action": "Collect receipt from payee",
                }
            )
            exists = (
                db.query(MissingReceiptRow).filter(MissingReceiptRow.transaction_id == tx.id).first()
            )
            if not exists:
                db.add(
                    MissingReceiptRow(
                        transaction_id=tx.id,
                        amount=amt,
                        vendor=tx.vendor_name,
                        date=tx.txn_date,
                    )
                )

        # CHECK 7 transfer mismatch (amounts normalized positive — look for paired leg with same amount)
        desc_l = (tx.description or "").lower()
        if any(k in desc_l for k in TRANSFER_KEYWORDS):
            peers_t = [
                o
                for o in txs
                if o.id != tx.id
                and _calendar_days_between(o.txn_date, tx.txn_date) <= 3
                and abs(float(o.amount) - amt) <= max(0.01 * amt, 1.0)
            ]
            if len(peers_t) < 1:
                flags.append(
                    {
                        "type": "transfer_mismatch",
                        "severity": "critical",
                        "message": "Inter-account transfer with no matching counter-entry within 3 days",
                        "action": "Locate paired transfer in other bank / GL accounts",
                    }
                )

        # CHECK 8a card / processor (verify against card statement + invoices)
        if _CC_PATTERN.search(desc_l or ""):
            flags.append(
                {
                    "type": "credit_card_indicator",
                    "severity": "medium",
                    "message": "Card or payment-processor keyword — verify clearing, fees, and merchant receipt",
                    "action": "Match to card statement and supporting invoice",
                }
            )

        # CHECK 8 personal indicators
        if any(k in desc_l for k in PERSONAL_KEYWORDS):
            flags.append(
                {
                    "type": "personal_expense_indicator",
                    "severity": "medium",
                    "message": "Description contains personal-expense keywords",
                    "action": "Confirm business purpose or reimburse personally",
                }
            )

        # Dedupe identical flags
        seen = set()
        uniq = []
        for f in flags:
            key = (f.get("type"), f.get("message"))
            if key in seen:
                continue
            seen.add(key)
            uniq.append(f)
        tx.anomaly_flags = uniq
        sevs = {_severity_order(f.get("severity", "medium")) for f in uniq}
        max_sev = max(sevs) if sevs else 0
        if max_sev >= 2:
            tx.flag_for_review = True

    db.flush()
    return txs


def reconcile_bank_to_gl(
    db: Session,
    client_id: str,
    transaction_ids: list[int] | None = None,
) -> dict[str, Any]:
    q = db.query(BookkeepingTransaction).filter(BookkeepingTransaction.client_id == client_id)
    if transaction_ids:
        q = q.filter(BookkeepingTransaction.id.in_(transaction_ids))
    bank_txs = q.all()
    journals = (
        db.query(JournalHistory)
        .filter(JournalHistory.company_id == client_id)
        .order_by(JournalHistory.posting_date)
        .all()
    )

    matched: list[dict[str, Any]] = []
    unmatched_bank: list[int] = []
    used_je: set[int] = set()

    for bt in bank_txs:
        best = None
        best_score = 0.0
        bamt = abs(float(bt.amount))
        for je in journals:
            if je.id in used_je:
                continue
            if not je.posting_date:
                continue
            jamt = abs(float(je.amount))
            if abs(jamt - bamt) > 0.01 and abs(jamt - bamt) / max(bamt, 1e-6) > 0.001:
                continue
            days = _calendar_days_between(bt.txn_date, je.posting_date)
            if days > 3:
                continue
            dr = fuzz.partial_ratio((bt.description or "").lower(), (je.description or "").lower())
            score = 1.0 if days == 0 and abs(jamt - bamt) < 0.01 else 0.85 + 0.05 * min(dr / 100, 1)
            if score > best_score:
                best_score = score
                best = je
        if best and best_score >= 0.85:
            used_je.add(best.id)
            matched.append(
                {
                    "bank_transaction_id": bt.id,
                    "journal_history_id": best.id,
                    "match_type": "exact_date_amount" if best_score >= 0.95 else "fuzzy_description",
                    "confidence": round(best_score, 3),
                }
            )
        else:
            # fuzzy: amount exact, description similar without strict date
            best2 = None
            best2_score = 0.0
            for je in journals:
                if je.id in used_je:
                    continue
                jamt = abs(float(je.amount))
                if abs(jamt - bamt) > 0.01:
                    continue
                dr = fuzz.partial_ratio((bt.description or "").lower(), (je.description or "").lower())
                if dr >= 70:
                    sc = dr / 100.0
                    if sc > best2_score:
                        best2_score = sc
                        best2 = je
            if best2 and best2_score >= 0.72:
                used_je.add(best2.id)
                matched.append(
                    {
                        "bank_transaction_id": bt.id,
                        "journal_history_id": best2.id,
                        "match_type": "fuzzy_description",
                        "confidence": round(best2_score, 3),
                    }
                )
            else:
                unmatched_bank.append(bt.id)

    by_id = {t.id: t for t in bank_txs}
    bank_total = sum(abs(float(t.amount)) for t in bank_txs)
    matched_total = sum(abs(float(by_id[m["bank_transaction_id"]].amount)) for m in matched if m["bank_transaction_id"] in by_id)
    variance = bank_total - matched_total
    abs_var = abs(variance)
    escalated = abs_var > 500.0 or (bank_total > 0 and abs_var / bank_total > 0.01)

    summary = {
        "matched": matched,
        "unmatched_bank_transaction_ids": unmatched_bank,
        "unmatched_journal_count": len(journals) - len(used_je),
        "bank_total": round(bank_total, 2),
        "matched_total": round(matched_total, 2),
        "variance": round(variance, 2),
        "escalated": escalated,
    }
    run = BookkeepingReconciliationRun(
        client_id=client_id,
        variance_amount=float(variance),
        escalated=escalated,
        summary_json=summary,
    )
    db.add(run)
    db.flush()
    return summary


def apply_learning_feedback(
    db: Session,
    client_id: str,
    transaction_id: int,
    correct_category: str,
    *,
    vendor_name: str | None = None,
) -> None:
    tx = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.id == transaction_id, BookkeepingTransaction.client_id == client_id)
        .first()
    )
    if not tx:
        return
    vn = vendor_name or tx.vendor_name or (tx.description or "")[:80]
    db.add(
        ClientRule(
            client_id=client_id,
            vendor_pattern=vn,
            category=correct_category,
            confidence_boost=0.02,
            source="learned",
        )
    )
    tx.category = correct_category
    tx.confidence = 1.0
    tx.auto_approved = True
    tx.flag_for_review = False
    db.add(
        TransactionCategoryRow(
            transaction_id=tx.id,
            category=correct_category,
            confidence=1.0,
            method="staff",
            staff_corrected=True,
            corrected_to=correct_category,
            corrected_at=datetime.utcnow(),
        )
    )
    y = tx.period_year or datetime.utcnow().year
    mo = tx.period_month or datetime.utcnow().month
    acc = get_or_create_accuracy(db, client_id, mo, y)
    acc.staff_corrected += 1
    db.flush()


def claude_verify_receipt(description: str, vendor: str, amount: float, receipt_text: str) -> dict[str, Any]:
    prompt = f"""Does this receipt text match the bank transaction?
Transaction: amount={amount}, vendor_hint={vendor!r}, description={description[:400]!r}
Receipt text:
{receipt_text[:4000]}

Reply ONLY JSON: {{"matches": true/false, "confidence": 0-1, "reason": "short"}}"""
    try:
        raw = llm_service.invoke(prompt, max_tokens=400, temperature=0.1)
    except Exception:
        return {"matches": False, "confidence": 0.0, "reason": "AI unavailable"}
    obj = _extract_json_obj(raw) or {}
    return {
        "matches": bool(obj.get("matches")),
        "confidence": float(obj.get("confidence") or 0),
        "reason": str(obj.get("reason") or ""),
    }


def monthly_report_aggregate(db: Session, client_id: str, month: int, year: int) -> dict[str, Any]:
    txs = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .all()
    )
    filtered = []
    for t in txs:
        if t.period_month is not None and t.period_year is not None:
            if t.period_month == month and t.period_year == year:
                filtered.append(t)
        elif t.txn_date.month == month and t.txn_date.year == year:
            filtered.append(t)

    by_cat: dict[str, float] = defaultdict(float)
    anomalies = 0
    for t in filtered:
        if t.category:
            by_cat[t.category] += abs(float(t.amount))
        anomalies += len(t.anomaly_flags or [])

    missing = (
        db.query(MissingReceiptRow)
        .join(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .filter(MissingReceiptRow.resolved.is_(False))
        .count()
    )

    acc = (
        db.query(AccuracyMetric)
        .filter(AccuracyMetric.client_id == client_id, AccuracyMetric.month == month, AccuracyMetric.year == year)
        .first()
    )

    last_recon = (
        db.query(BookkeepingReconciliationRun)
        .filter(BookkeepingReconciliationRun.client_id == client_id)
        .order_by(BookkeepingReconciliationRun.id.desc())
        .first()
    )

    receipt_rate = 0.0
    if filtered:
        with_r = sum(1 for t in filtered if t.receipt_url)
        receipt_rate = round(100.0 * with_r / len(filtered), 1)

    return {
        "client_id": client_id,
        "month": month,
        "year": year,
        "transaction_count": len(filtered),
        "by_category": dict(by_cat),
        "anomaly_flags_total": anomalies,
        "missing_receipts_open": missing,
        "accuracy": acc.accuracy_pct if acc else None,
        "last_reconciliation": {
            "variance": last_recon.variance_amount if last_recon else None,
            "escalated": last_recon.escalated if last_recon else None,
            "at": last_recon.created_at.isoformat() if last_recon else None,
        },
        "receipt_collection_rate_pct": receipt_rate,
    }
