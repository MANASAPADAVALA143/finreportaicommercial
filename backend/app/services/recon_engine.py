"""
Multi-tier bank reconciliation matching engine.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy.orm import Session

from app.models.bank_recon import (
    BankTransaction,
    BankTxnStatus,
    BookTransaction,
    BookTxnStatus,
    MatchGroup,
    MatchGroupStatus,
    MatchTypeEnum,
    ReconException,
    ReconExceptionType,
    ExceptionSeverity,
    ReconWorkspace,
)

MATCH_CONFIG = {
    "auto_confirm_threshold": 0.95,
    "review_threshold": 0.70,
    "amount_tolerance_pct": 0.001,
    "amount_tolerance_abs": 0.05,
    "date_tolerance_days": 3,
    "description_weight": 0.30,
    "amount_weight": 0.50,
    "date_weight": 0.20,
}


def _mg_status(s: str) -> MatchGroupStatus:
    try:
        return MatchGroupStatus(s)
    except ValueError:
        return MatchGroupStatus.pending_review


def _amt_key(a) -> str:
    return f"{float(a):.2f}"


def exact_match(book_txns: list[BookTransaction], bank_txns: list[BankTransaction]) -> list[dict[str, Any]]:
    bank_index: dict[tuple[str, str, str], list[BankTransaction]] = {}
    for b in bank_txns:
        if b.status != BankTxnStatus.unmatched:
            continue
        key = (
            _amt_key(b.amount),
            b.txn_date.isoformat(),
            (b.bank_reference or "").upper().strip(),
        )
        bank_index.setdefault(key, []).append(b)

    matches: list[dict[str, Any]] = []
    for book in book_txns:
        if book.status != BookTxnStatus.unmatched:
            continue
        key = (
            _amt_key(book.amount),
            book.txn_date.isoformat(),
            (book.reference or "").upper().strip(),
        )
        if key in bank_index and bank_index[key]:
            bank = bank_index[key].pop(0)
            matches.append(
                {
                    "book_txn_id": book.id,
                    "bank_txn_id": bank.id,
                    "match_type": "exact",
                    "confidence_score": 1.0,
                    "amount_variance": 0.0,
                    "date_variance_days": 0,
                    "description_similarity": 1.0,
                    "status": "auto_confirmed",
                }
            )
    return matches


def fuzzy_match(
    unmatched_book: list[BookTransaction],
    unmatched_bank: list[BankTransaction],
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    used_bank_ids: set[int] = set()

    for book in unmatched_book:
        if book.status != BookTxnStatus.unmatched:
            continue
        best_score = 0.0
        best_bank: BankTransaction | None = None
        best_breakdown: dict[str, float] = {}

        for bank in unmatched_bank:
            if bank.id in used_bank_ids or bank.status != BankTxnStatus.unmatched:
                continue

            diff = abs(float(book.amount) - float(bank.amount))
            max_amt = max(abs(float(book.amount)), 0.01)
            if diff <= MATCH_CONFIG["amount_tolerance_abs"]:
                amount_score = 1.0
            elif diff / max_amt <= MATCH_CONFIG["amount_tolerance_pct"]:
                amount_score = 0.95
            elif diff / max_amt <= 0.01:
                amount_score = 0.70
            else:
                continue

            date_diff = abs((book.txn_date - bank.txn_date).days)
            if date_diff == 0:
                date_score = 1.0
            elif date_diff <= 1:
                date_score = 0.90
            elif date_diff <= 3:
                date_score = 0.70
            elif date_diff <= 7:
                date_score = 0.40
            else:
                date_score = 0.10

            desc_book = (book.description or "").lower()
            desc_bank = (bank.description or "").lower()
            token_score = fuzz.token_sort_ratio(desc_book, desc_bank) / 100.0
            partial_score = fuzz.partial_ratio(desc_book, desc_bank) / 100.0
            desc_score = max(token_score, partial_score)

            total = (
                amount_score * MATCH_CONFIG["amount_weight"]
                + date_score * MATCH_CONFIG["date_weight"]
                + desc_score * MATCH_CONFIG["description_weight"]
            )

            if total > best_score and total >= MATCH_CONFIG["review_threshold"]:
                best_score = total
                best_bank = bank
                best_breakdown = {
                    "amount_score": amount_score,
                    "date_score": date_score,
                    "desc_score": desc_score,
                }

        if best_bank:
            status = (
                "auto_confirmed"
                if best_score >= MATCH_CONFIG["auto_confirm_threshold"]
                else "pending_review"
            )
            matches.append(
                {
                    "book_txn_id": book.id,
                    "bank_txn_id": best_bank.id,
                    "match_type": "fuzzy",
                    "confidence_score": round(best_score, 4),
                    "amount_variance": float(book.amount) - float(best_bank.amount),
                    "date_variance_days": abs((book.txn_date - best_bank.txn_date).days),
                    "description_similarity": best_breakdown["desc_score"],
                    "status": status,
                    "breakdown": best_breakdown,
                }
            )
            used_bank_ids.add(best_bank.id)

    return matches


def composite_match(
    unmatched_book: list[BookTransaction],
    unmatched_bank: list[BankTransaction],
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    used_bank_ids: set[int] = set()
    used_book_ids: set[int] = set()

    for bank in unmatched_bank:
        if bank.id in used_bank_ids or bank.status != BankTxnStatus.unmatched:
            continue
        bank_amt = float(bank.amount)

        candidates = [
            b
            for b in unmatched_book
            if b.id not in used_book_ids and b.status == BookTxnStatus.unmatched
            and abs((bank.txn_date - b.txn_date).days) <= 5
        ]

        for i, b1 in enumerate(candidates):
            for b2 in candidates[i + 1 :]:
                pair_sum = float(b1.amount) + float(b2.amount)
                if abs(pair_sum - bank_amt) <= 0.05:
                    matches.append(
                        {
                            "bank_txn_ids": [bank.id],
                            "book_txn_ids": [b1.id, b2.id],
                            "match_type": "one_to_many",
                            "confidence_score": 0.92,
                            "status": "pending_review",
                            "amount_variance": pair_sum - bank_amt,
                            "date_variance_days": max(
                                abs((bank.txn_date - b1.txn_date).days),
                                abs((bank.txn_date - b2.txn_date).days),
                            ),
                        }
                    )
                    used_bank_ids.add(bank.id)
                    used_book_ids.update([b1.id, b2.id])
                    break
            if bank.id in used_bank_ids:
                break

    return matches


def _apply_pair_matches(
    db: Session,
    workspace_id: int,
    pairs: list[dict[str, Any]],
) -> None:
    for m in pairs:
        if "book_txn_ids" in m:
            continue
        book = db.query(BookTransaction).filter_by(id=m["book_txn_id"], workspace_id=workspace_id).first()
        bank = db.query(BankTransaction).filter_by(id=m["bank_txn_id"], workspace_id=workspace_id).first()
        if not book or not bank:
            continue
        if book.status != BookTxnStatus.unmatched or bank.status != BankTxnStatus.unmatched:
            continue

        try:
            mt = MatchTypeEnum(m["match_type"])
        except ValueError:
            mt = MatchTypeEnum.fuzzy
        mg = MatchGroup(
            workspace_id=workspace_id,
            match_type=mt,
            confidence_score=float(m.get("confidence_score", 0)),
            amount_variance=Decimal(str(m.get("amount_variance", 0))),
            date_variance_days=m.get("date_variance_days"),
            description_similarity=m.get("description_similarity"),
            status=_mg_status(m.get("status", "pending_review")),
            ai_reasoning=m.get("ai_reasoning"),
            match_metadata={
                k: v
                for k, v in m.items()
                if k
                not in {
                    "book_txn_id",
                    "bank_txn_id",
                    "match_type",
                    "confidence_score",
                    "amount_variance",
                    "date_variance_days",
                    "description_similarity",
                    "status",
                    "ai_reasoning",
                }
            }
            or None,
        )
        db.add(mg)
        db.flush()
        book.match_id = mg.id
        bank.match_id = mg.id
        book.status = BookTxnStatus.matched
        bank.status = BankTxnStatus.matched


def _apply_composite_matches(
    db: Session,
    workspace_id: int,
    composites: list[dict[str, Any]],
) -> None:
    for m in composites:
        bids = m.get("book_txn_ids") or []
        nk = m.get("bank_txn_ids") or []
        if not bids or not nk:
            continue
        books = (
            db.query(BookTransaction)
            .filter(BookTransaction.workspace_id == workspace_id, BookTransaction.id.in_(bids))
            .all()
        )
        banks = (
            db.query(BankTransaction)
            .filter(BankTransaction.workspace_id == workspace_id, BankTransaction.id.in_(nk))
            .all()
        )
        if len(books) != len(bids) or len(banks) != len(nk):
            continue
        if any(b.status != BookTxnStatus.unmatched for b in books):
            continue
        if any(b.status != BankTxnStatus.unmatched for b in banks):
            continue

        mg = MatchGroup(
            workspace_id=workspace_id,
            match_type=MatchTypeEnum.one_to_many,
            confidence_score=float(m.get("confidence_score", 0.92)),
            amount_variance=Decimal(str(m.get("amount_variance", 0))),
            date_variance_days=m.get("date_variance_days"),
            status=_mg_status(m.get("status", "pending_review")),
            match_metadata={"book_txn_ids": bids, "bank_txn_ids": nk},
        )
        db.add(mg)
        db.flush()
        for b in books:
            b.match_id = mg.id
            b.status = BookTxnStatus.matched
        for b in banks:
            b.match_id = mg.id
            b.status = BankTxnStatus.matched


def detect_duplicates(txns: list[Any]) -> list[dict[str, Any]]:
    duplicates: list[dict[str, Any]] = []
    for i, t1 in enumerate(txns):
        for t2 in txns[i + 1 :]:
            if (
                abs(float(t1.amount) - float(t2.amount)) < 0.01
                and abs((t1.txn_date - t2.txn_date).days) <= 7
                and fuzz.ratio(
                    (t1.description or "").lower(),
                    (t2.description or "").lower(),
                )
                > 85
            ):
                duplicates.append(
                    {
                        "txn1_id": t1.id,
                        "txn2_id": t2.id,
                        "amount": float(t1.amount),
                        "date1": str(t1.txn_date),
                        "date2": str(t2.txn_date),
                        "similarity": fuzz.ratio(t1.description or "", t2.description or ""),
                    }
                )
    return duplicates


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```$", "", t)
    return t


async def ai_match_exceptions(
    unmatched_book: list[BookTransaction],
    unmatched_bank: list[BankTransaction],
    workspace_context: dict[str, Any],
) -> dict[str, Any]:
    from app.services.llm_service import invoke

    if not unmatched_book or not unmatched_bank:
        return {"matches": [], "exceptions": []}

    book_sample = unmatched_book[:20]
    bank_sample = unmatched_bank[:20]

    system = """You are an expert bank reconciliation accountant 
with 20 years of experience. You specialize in identifying matches 
between bank statements and GL entries that automated systems miss.

Rules:
- Only suggest a match if you are confident
- Explain your reasoning for each match
- Flag exceptions that need human investigation
- Return ONLY valid JSON, no markdown
"""

    prompt = f"""
Workspace: {workspace_context.get('workspace_name')}
Period: {workspace_context.get('period_start')} to {workspace_context.get('period_end')}
Currency: {workspace_context.get('currency')}

UNMATCHED GL ENTRIES:
{[{"id": b.id, "date": str(b.txn_date), "amount": float(b.amount), "description": b.description, "reference": b.reference} for b in book_sample]}

UNMATCHED BANK TRANSACTIONS:
{[{"id": b.id, "date": str(b.txn_date), "amount": float(b.amount), "description": b.description, "bank_reference": b.bank_reference} for b in bank_sample]}

For each match you identify, return:
{{
  "book_txn_id": <id>,
  "bank_txn_id": <id>,
  "confidence": <0.0-1.0>,
  "reasoning": "<why these match>",
  "exception_type": "<null or: timing|fx_rounding|partial|bank_error|duplicate>",
  "requires_adjustment": <true/false>,
  "suggested_adjustment": "<description if needed>"
}}

Also return unmatched items that are clear exceptions:
{{
  "type": "exception",
  "txn_id": <id>,
  "side": "bank" or "gl",
  "exception_type": "<type>",
  "severity": "low|medium|high|critical",
  "reasoning": "<explanation>"
}}

Return JSON: {{"matches": [...], "exceptions": [...]}}
"""

    result = invoke(prompt=prompt, system=system, max_tokens=2000)
    try:
        parsed = json.loads(_strip_json_fence(result))
    except json.JSONDecodeError:
        return {"matches": [], "exceptions": []}

    for m in parsed.get("matches", []):
        m["match_type"] = "ai_suggested"
        conf = float(m.pop("confidence", 0.8))
        m["confidence_score"] = conf
        m["status"] = "pending_review" if conf < 0.95 else "auto_confirmed"
        m["ai_reasoning"] = m.pop("reasoning", "") or ""
        m["amount_variance"] = 0.0
        m["date_variance_days"] = 0
        m["description_similarity"] = conf

    return parsed


def _apply_ai_pair_matches(db: Session, workspace_id: int, t4: dict[str, Any]) -> int:
    n = 0
    for m in t4.get("matches", []):
        if "book_txn_id" not in m or "bank_txn_id" not in m:
            continue
        _apply_pair_matches(
            db,
            workspace_id,
            [
                {
                    "book_txn_id": m["book_txn_id"],
                    "bank_txn_id": m["bank_txn_id"],
                    "match_type": m.get("match_type", "ai_suggested"),
                    "confidence_score": m.get("confidence_score", 0.8),
                    "amount_variance": m.get("amount_variance", 0),
                    "date_variance_days": m.get("date_variance_days"),
                    "description_similarity": m.get("description_similarity"),
                    "status": m.get("status", "pending_review"),
                    "ai_reasoning": m.get("ai_reasoning"),
                }
            ],
        )
        n += 1
    return n


def _persist_ai_exceptions(db: Session, workspace_id: int, t4: dict[str, Any]) -> int:
    count = 0
    for ex in t4.get("exceptions", []):
        if ex.get("type") != "exception":
            continue
        side = ex.get("side", "bank")
        bank_id = ex.get("txn_id") if side == "bank" else None
        book_id = ex.get("txn_id") if side == "gl" else None
        sev_raw = ex.get("severity", "medium")
        try:
            sev = ExceptionSeverity(sev_raw)
        except ValueError:
            sev = ExceptionSeverity.medium
        try:
            et = ReconExceptionType(ex.get("exception_type", "unmatched_bank"))
        except ValueError:
            et = ReconExceptionType.unmatched_bank
        row = ReconException(
            workspace_id=workspace_id,
            exception_type=et,
            severity=sev,
            description=ex.get("reasoning"),
            bank_txn_id=bank_id,
            book_txn_id=book_id,
        )
        db.add(row)
        count += 1
    return count


async def run_full_matching_engine(workspace_id: int, db: Session) -> dict[str, Any]:
    book_txns = (
        db.query(BookTransaction)
        .filter(BookTransaction.workspace_id == workspace_id, BookTransaction.status == BookTxnStatus.unmatched)
        .all()
    )
    bank_txns = (
        db.query(BankTransaction)
        .filter(BankTransaction.workspace_id == workspace_id, BankTransaction.status == BankTxnStatus.unmatched)
        .all()
    )

    stats: dict[str, Any] = {
        "total_book": len(book_txns),
        "total_bank": len(bank_txns),
        "tier1_exact": 0,
        "tier2_fuzzy": 0,
        "tier3_composite": 0,
        "tier4_ai": 0,
        "exceptions": 0,
        "unmatched_book": 0,
        "unmatched_bank": 0,
    }

    all_matches: list[dict[str, Any]] = []

    t1 = exact_match(book_txns, bank_txns)
    stats["tier1_exact"] = len(t1)
    all_matches.extend(t1)
    _apply_pair_matches(db, workspace_id, t1)
    db.flush()

    remaining_book = [
        b
        for b in book_txns
        if b.status == BookTxnStatus.unmatched
    ]
    remaining_bank = [
        b
        for b in bank_txns
        if b.status == BankTxnStatus.unmatched
    ]

    t2 = fuzzy_match(remaining_book, remaining_bank)
    stats["tier2_fuzzy"] = len(t2)
    all_matches.extend(t2)
    _apply_pair_matches(db, workspace_id, t2)
    db.flush()

    remaining_book = [b for b in book_txns if b.status == BookTxnStatus.unmatched]
    remaining_bank = [b for b in bank_txns if b.status == BankTxnStatus.unmatched]

    t3 = composite_match(remaining_book, remaining_bank)
    stats["tier3_composite"] = len(t3)
    all_matches.extend(t3)
    _apply_composite_matches(db, workspace_id, t3)
    db.flush()

    remaining_book = [b for b in book_txns if b.status == BookTxnStatus.unmatched]
    remaining_bank = [b for b in bank_txns if b.status == BankTxnStatus.unmatched]

    workspace = db.query(ReconWorkspace).filter_by(id=workspace_id).first()
    t4: dict[str, Any] = {"matches": [], "exceptions": []}
    if workspace and remaining_book and remaining_bank:
        try:
            t4 = await ai_match_exceptions(
                remaining_book,
                remaining_bank,
                {
                    "workspace_name": workspace.workspace_name,
                    "period_start": str(workspace.period_start),
                    "period_end": str(workspace.period_end),
                    "currency": workspace.currency,
                },
            )
        except Exception:
            t4 = {"matches": [], "exceptions": []}
        stats["tier4_ai"] = _apply_ai_pair_matches(db, workspace_id, t4)
        stats["exceptions"] = _persist_ai_exceptions(db, workspace_id, t4)
    db.flush()

    remaining_book = [b for b in book_txns if b.status == BookTxnStatus.unmatched]
    remaining_bank = [b for b in bank_txns if b.status == BankTxnStatus.unmatched]

    total_matched_pairs = (
        stats["tier1_exact"]
        + stats["tier2_fuzzy"]
        + stats["tier3_composite"]
        + stats["tier4_ai"]
    )
    stats["unmatched_book"] = len(remaining_book)
    stats["unmatched_bank"] = len(remaining_bank)
    stats["match_rate"] = round(
        (len(book_txns) - len(remaining_book)) / max(len(book_txns), 1) * 100,
        2,
    )
    auto_pairs = stats["tier1_exact"] + sum(1 for x in t2 if x.get("status") == "auto_confirmed")
    stats["auto_confirm_rate"] = round(
        auto_pairs / max(total_matched_pairs, 1) * 100,
        2,
    )
    stats["exceptions_count"] = stats["exceptions"]

    db.commit()
    return {
        "workspace_id": workspace_id,
        "stats": stats,
        "matches": all_matches,
        "ai_results": t4,
    }
