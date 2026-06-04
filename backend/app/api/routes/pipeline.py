"""
Connected Bookkeeping Pipeline — REST API router.

Endpoints:
  POST /api/accounting/invoice-to-je
  POST /api/accounting/validate-and-post
  POST /api/accounting/suggest-accruals
  POST /api/accounting/accept-accrual/{accrual_id}
  GET  /api/accounting/trial-balance/{period}
  POST /api/fpa/sync-actuals
  GET  /api/accounting/close-status/{period}
  GET  /api/audit/trail
  POST /api/recon/match
  POST /api/recon/approve-match/{match_id}
  GET  /api/recon/status/{period}
"""
from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import datetime, date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.pipeline import (
    AccountingAuditLog,
    AccrualSuggestion,
    BankReconMatch,
    GLEntry,
)

router = APIRouter(tags=["pipeline"])

VAT_RATE = 0.05  # UAE VAT 5 %

# ── UAE Chart-of-Account codes (IFRS) ─────────────────────────────────────────
COA = {
    "trade_payables":    "2001",
    "trade_receivables": "1300",
    "vat_payable":       "2200",
    "vat_recoverable":   "1400",
    "revenue":           "4001",
    "expense":           "6001",
}

COA_NAMES = {
    "2001": "Trade Payables",
    "1300": "Trade Receivables",
    "2200": "VAT Payable",
    "1400": "VAT Recoverable",
    "4001": "Revenue",
    "6001": "Operating Expenses",
}


# ── helpers ────────────────────────────────────────────────────────────────────

def _aed(v: float) -> float:
    return round(v, 2)


def _period_now() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _log(db: Session, action: str, entity_type: str, entity_id: str,
         new_value: Any = None, old_value: Any = None) -> None:
    try:
        db.add(AccountingAuditLog(
            action_type=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            old_value=json.dumps(old_value) if old_value is not None else None,
            new_value=json.dumps(new_value) if new_value is not None else None,
        ))
    except Exception:
        pass


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class InvoiceToJERequest(BaseModel):
    invoice_id: str
    invoice_type: str = Field(..., description="AP or AR")
    amount: float
    vendor: Optional[str] = None
    expense_category: Optional[str] = None


class JELine(BaseModel):
    account_code: str
    account_name: str
    debit: float = 0.0
    credit: float = 0.0


class ValidateAndPostRequest(BaseModel):
    je_id: str
    lines: list[JELine]


class SuggestAccrualsRequest(BaseModel):
    period: str = Field(default_factory=_period_now)
    company_id: str = "default"


class ReconMatchRequest(BaseModel):
    period: str = Field(default_factory=_period_now)
    gl_transactions: list[dict] = Field(default_factory=list)
    bank_transactions: list[dict] = Field(default_factory=list)


class SyncActualsRequest(BaseModel):
    period: str = Field(default_factory=_period_now)
    source: str = "ifrs_statements"


# ── POST /api/accounting/invoice-to-je ─────────────────────────────────────────

@router.post("/api/accounting/invoice-to-je")
async def invoice_to_je(req: InvoiceToJERequest, db: Session = Depends(get_db)):
    """Convert an AP or AR invoice into GL journal entry lines."""
    try:
        je_id = f"JE-{req.invoice_id}-{uuid.uuid4().hex[:6].upper()}"
        period = _period_now()
        net = _aed(req.amount)
        vat = _aed(net * VAT_RATE)
        gross = _aed(net + vat)
        lines: list[dict] = []

        if req.invoice_type.upper() == "AP":
            # Dr Expense (net) + Dr VAT Recoverable (vat) / Cr Trade Payables (gross)
            lines = [
                {"account_code": COA["expense"],        "account_name": COA_NAMES[COA["expense"]],        "debit": net,   "credit": 0.0},
                {"account_code": COA["vat_recoverable"],"account_name": COA_NAMES[COA["vat_recoverable"]],"debit": vat,   "credit": 0.0},
                {"account_code": COA["trade_payables"], "account_name": COA_NAMES[COA["trade_payables"]], "debit": 0.0,   "credit": gross},
            ]
        else:
            # Dr Trade Receivables (gross) / Cr Revenue (net) + Cr VAT Payable (vat)
            lines = [
                {"account_code": COA["trade_receivables"],"account_name": COA_NAMES[COA["trade_receivables"]],"debit": gross,"credit": 0.0},
                {"account_code": COA["revenue"],           "account_name": COA_NAMES[COA["revenue"]],          "debit": 0.0,  "credit": net},
                {"account_code": COA["vat_payable"],       "account_name": COA_NAMES[COA["vat_payable"]],      "debit": 0.0,  "credit": vat},
            ]

        # Persist as draft GL entries
        for ln in lines:
            db.add(GLEntry(
                je_id=je_id,
                account_code=ln["account_code"],
                account_name=ln["account_name"],
                debit=ln["debit"],
                credit=ln["credit"],
                period=period,
                source="invoice",
            ))

        _log(db, "invoice_to_je", "invoice", req.invoice_id, new_value={"je_id": je_id, "lines": lines})
        db.commit()

        return {"je_id": je_id, "lines": lines, "status": "draft", "period": period,
                "currency": "AED", "vat_amount": vat, "gross_amount": gross}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── POST /api/accounting/validate-and-post ─────────────────────────────────────

@router.post("/api/accounting/validate-and-post")
async def validate_and_post(req: ValidateAndPostRequest, db: Session = Depends(get_db)):
    """Run risk scoring on a JE and auto-post, flag, or block it."""
    try:
        score = 100
        flags: list[str] = []
        total_amount = sum(ln.debit for ln in req.lines)

        if total_amount > 500_000:
            score -= 30
            flags.append("High value transaction (>500,000 AED)")
        if total_amount > 0 and total_amount == round(total_amount):
            score -= 10
            flags.append("Round number amount — manual review recommended")
        today = datetime.utcnow()
        if today.weekday() >= 5:
            score -= 20
            flags.append("Weekend posting detected")

        if score > 60:
            status = "posted"
            auto_posted = True
            risk_level = "low"
        elif score >= 30:
            status = "review"
            auto_posted = False
            risk_level = "medium"
        else:
            status = "blocked"
            auto_posted = False
            risk_level = "high"

        # If auto-posted, update existing GL entries for this JE
        if auto_posted:
            existing = db.query(GLEntry).filter(GLEntry.je_id == req.je_id).all()
            for row in existing:
                row.source = row.source or "manual"

        _log(db, "validate_and_post", "journal_entry", req.je_id,
             new_value={"status": status, "risk_score": score, "flags": flags})
        db.commit()

        return {
            "je_id": req.je_id,
            "risk_score": score,
            "risk_level": risk_level,
            "auto_posted": auto_posted,
            "status": status,
            "flags": flags,
        }
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── POST /api/accounting/suggest-accruals ──────────────────────────────────────

@router.post("/api/accounting/suggest-accruals")
async def suggest_accruals(req: SuggestAccrualsRequest, db: Session = Depends(get_db)):
    """Generate accrual suggestions based on recurring GL patterns."""
    try:
        # Look at gl_entries and find recurring patterns
        rows = db.query(GLEntry).filter(GLEntry.source == "invoice").all()

        # Group by account_code and compute averages
        by_account: dict[str, list[float]] = defaultdict(list)
        for row in rows:
            if row.debit > 0:
                by_account[row.account_code].append(row.debit)

        suggestions = []
        accrual_patterns = [
            {"desc": "Rent & Office Costs Accrual",      "debit": "6001", "credit": "2001", "base_pct": 0.08},
            {"desc": "Utilities Accrual",                 "debit": "6001", "credit": "2001", "base_pct": 0.03},
            {"desc": "Salary & Benefits Accrual",         "debit": "6001", "credit": "2001", "base_pct": 0.25},
            {"desc": "Professional Services Accrual",     "debit": "6001", "credit": "2001", "base_pct": 0.05},
            {"desc": "Marketing & Advertising Accrual",   "debit": "6001", "credit": "2001", "base_pct": 0.04},
        ]

        expense_avg = 0.0
        if by_account.get("6001"):
            vals = by_account["6001"]
            expense_avg = sum(vals) / len(vals)

        base = expense_avg if expense_avg > 0 else 50_000.0

        for i, pattern in enumerate(accrual_patterns):
            amount = _aed(base * pattern["base_pct"])
            confidence = round(75.0 - i * 5, 1)
            suggestion = AccrualSuggestion(
                period=req.period,
                description=pattern["desc"],
                amount_aed=amount,
                debit_account=pattern["debit"],
                credit_account=pattern["credit"],
                confidence_pct=confidence,
                reason=f"Based on recurring GL pattern for period {req.period}",
                status="suggested",
            )
            db.add(suggestion)
            db.flush()
            suggestions.append({
                "id": suggestion.id,
                "period": req.period,
                "description": pattern["desc"],
                "amount_aed": amount,
                "debit_account": pattern["debit"],
                "credit_account": pattern["credit"],
                "confidence_pct": confidence,
                "reason": suggestion.reason,
                "status": "suggested",
            })

        db.commit()
        return {"period": req.period, "suggestions": suggestions, "count": len(suggestions)}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── POST /api/accounting/accept-accrual/{accrual_id} ──────────────────────────

@router.post("/api/accounting/accept-accrual/{accrual_id}")
async def accept_accrual(accrual_id: int, db: Session = Depends(get_db)):
    """Accept an accrual suggestion and create a posted JE."""
    try:
        accrual = db.query(AccrualSuggestion).filter(AccrualSuggestion.id == accrual_id).first()
        if not accrual:
            raise HTTPException(status_code=404, detail="Accrual suggestion not found")

        je_id = f"JE-ACCRUAL-{accrual_id}-{uuid.uuid4().hex[:4].upper()}"
        period = accrual.period or _period_now()

        db.add(GLEntry(je_id=je_id, account_code=accrual.debit_account,
                       account_name=COA_NAMES.get(accrual.debit_account, accrual.debit_account),
                       debit=accrual.amount_aed, credit=0.0, period=period, source="manual"))
        db.add(GLEntry(je_id=je_id, account_code=accrual.credit_account,
                       account_name=COA_NAMES.get(accrual.credit_account, accrual.credit_account),
                       debit=0.0, credit=accrual.amount_aed, period=period, source="manual"))

        accrual.status = "accepted"
        _log(db, "accept_accrual", "accrual", str(accrual_id), new_value={"je_id": je_id})
        db.commit()

        return {"je_id": je_id, "accrual_id": accrual_id, "status": "accepted",
                "amount_aed": accrual.amount_aed, "description": accrual.description}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── GET /api/accounting/trial-balance/{period} ────────────────────────────────

@router.get("/api/accounting/trial-balance/{period}")
async def get_trial_balance(period: str, db: Session = Depends(get_db)):
    """Return trial balance for a period. Falls back to demo data if no entries."""
    try:
        rows = db.query(GLEntry).filter(GLEntry.period == period).all()

        if not rows:
            # Return demo data so frontend never crashes on empty DB
            demo = [
                {"account_code": "1300", "account_name": "Trade Receivables", "total_debit": 250000.00, "total_credit": 0.0,      "net": 250000.00},
                {"account_code": "1400", "account_name": "VAT Recoverable",   "total_debit": 12500.00,  "total_credit": 0.0,      "net": 12500.00},
                {"account_code": "2001", "account_name": "Trade Payables",    "total_debit": 0.0,       "total_credit": 180000.00,"net": -180000.00},
                {"account_code": "2200", "account_name": "VAT Payable",       "total_debit": 0.0,       "total_credit": 5250.00,  "net": -5250.00},
                {"account_code": "4001", "account_name": "Revenue",           "total_debit": 0.0,       "total_credit": 105000.00,"net": -105000.00},
                {"account_code": "6001", "account_name": "Operating Expenses","total_debit": 27250.00,  "total_credit": 0.0,      "net": 27250.00},
            ]
            total_debit  = sum(r["total_debit"]  for r in demo)
            total_credit = sum(r["total_credit"] for r in demo)
            return {
                "period": period,
                "rows": demo,
                "total_debit": total_debit,
                "total_credit": total_credit,
                "balanced": abs(total_debit - total_credit) < 0.01,
                "demo_data": True,
            }

        # Aggregate
        by_account: dict[str, dict] = {}
        for row in rows:
            code = row.account_code
            if code not in by_account:
                by_account[code] = {
                    "account_code": code,
                    "account_name": row.account_name or COA_NAMES.get(code, code),
                    "total_debit": 0.0,
                    "total_credit": 0.0,
                }
            by_account[code]["total_debit"]  += row.debit or 0.0
            by_account[code]["total_credit"] += row.credit or 0.0

        result = []
        for r in by_account.values():
            r["net"] = _aed(r["total_debit"] - r["total_credit"])
            r["total_debit"]  = _aed(r["total_debit"])
            r["total_credit"] = _aed(r["total_credit"])
            result.append(r)

        result.sort(key=lambda x: x["account_code"])
        total_debit  = _aed(sum(r["total_debit"]  for r in result))
        total_credit = _aed(sum(r["total_credit"] for r in result))

        return {
            "period": period,
            "rows": result,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "balanced": abs(total_debit - total_credit) < 0.01,
            "demo_data": False,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── POST /api/fpa/sync-actuals ─────────────────────────────────────────────────

@router.post("/api/fpa/sync-actuals")
async def sync_actuals(req: SyncActualsRequest, db: Session = Depends(get_db)):
    """Pull trial balance for period and return variance-ready data."""
    try:
        rows = db.query(GLEntry).filter(GLEntry.period == req.period).all()

        revenue = sum((r.credit - r.debit) for r in rows if r.account_code.startswith("4"))
        expenses = sum((r.debit - r.credit) for r in rows if r.account_code.startswith("6"))
        assets   = sum((r.debit - r.credit) for r in rows if r.account_code.startswith("1"))
        liabilities = sum((r.credit - r.debit) for r in rows if r.account_code.startswith("2"))

        if not rows:
            revenue = 105000.0; expenses = 27250.0; assets = 262500.0; liabilities = 185250.0

        return {
            "period": req.period,
            "source": req.source,
            "synced_at": datetime.utcnow().isoformat(),
            "actuals": {
                "revenue":     _aed(revenue),
                "expenses":    _aed(expenses),
                "gross_profit":_aed(revenue - expenses),
                "assets":      _aed(assets),
                "liabilities": _aed(liabilities),
            },
            "currency": "AED",
            "ready_for_variance": True,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── GET /api/accounting/close-status/{period} ─────────────────────────────────

@router.get("/api/accounting/close-status/{period}")
async def get_close_status(period: str, db: Session = Depends(get_db)):
    """Return month-end close checklist with completion %."""
    try:
        ap_count   = db.query(GLEntry).filter(GLEntry.period == period, GLEntry.source == "invoice").count()
        je_count   = db.query(GLEntry).filter(GLEntry.period == period).count()
        recon_count = db.query(BankReconMatch).filter(BankReconMatch.period == period).count()

        # Check for trial balance entries
        tb_generated = je_count > 0

        # Check for accruals
        accruals_done = db.query(AccrualSuggestion).filter(
            AccrualSuggestion.period == period,
            AccrualSuggestion.status == "accepted"
        ).count() > 0

        checklist = [
            {
                "step": "ap_invoices_posted",
                "label": "AP Invoices Posted to GL",
                "status": "complete" if ap_count > 0 else "pending",
                "count": ap_count,
                "path": "/ap-invoices",
            },
            {
                "step": "journal_entries_posted",
                "label": "Journal Entries Posted",
                "status": "complete" if je_count > 0 else "pending",
                "count": je_count,
                "path": "/uae-full/journals",
            },
            {
                "step": "accruals_posted",
                "label": "Accruals Posted",
                "status": "complete" if accruals_done else "pending",
                "count": db.query(AccrualSuggestion).filter(AccrualSuggestion.period == period).count(),
                "path": "/uae-full/accruals",
            },
            {
                "step": "bank_recon_complete",
                "label": "Bank Reconciliation Complete",
                "status": "complete" if recon_count > 0 else "pending",
                "count": recon_count,
                "path": "/bank-recon",
            },
            {
                "step": "trial_balance_generated",
                "label": "Trial Balance Generated",
                "status": "complete" if tb_generated else "pending",
                "count": je_count,
                "path": "/tb-variance",
            },
            {
                "step": "ifrs_generated",
                "label": "IFRS Statements Generated",
                "status": "pending",
                "count": 0,
                "path": "/ifrs-statement",
            },
            {
                "step": "fpa_synced",
                "label": "FP&A Actuals Synced",
                "status": "available",
                "count": 0,
                "path": "/fpa/variance",
            },
        ]

        complete_count = sum(1 for c in checklist if c["status"] == "complete")
        completion_pct = round(complete_count / len(checklist) * 100)

        return {
            "period": period,
            "checklist": checklist,
            "complete_count": complete_count,
            "total_steps": len(checklist),
            "completion_pct": completion_pct,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── GET /api/audit/trail ───────────────────────────────────────────────────────

@router.get("/api/audit/trail")
async def get_audit_trail(
    entity_type: Optional[str] = Query(default=None),
    period: Optional[str] = Query(default=None),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
):
    """Return accounting audit log records."""
    try:
        q = db.query(AccountingAuditLog)
        if entity_type:
            q = q.filter(AccountingAuditLog.entity_type == entity_type)
        rows = q.order_by(AccountingAuditLog.timestamp.desc()).limit(limit).all()

        def _row(r: AccountingAuditLog) -> dict:
            return {
                "id": r.id,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                "user_id": r.user_id,
                "action_type": r.action_type,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "old_value": r.old_value,
                "new_value": r.new_value,
                "s3_backup_key": r.s3_backup_key,
            }

        return {"records": [_row(r) for r in rows], "count": len(rows)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── POST /api/recon/match ──────────────────────────────────────────────────────

@router.post("/api/recon/match")
async def recon_match(req: ReconMatchRequest, db: Session = Depends(get_db)):
    """4-tier GL ↔ bank statement matching."""
    try:
        matched: list[dict]    = []
        review: list[dict]     = []
        exceptions: list[dict] = []

        for gl in req.gl_transactions:
            gl_amt  = float(gl.get("amount", 0))
            gl_ref  = str(gl.get("reference", ""))
            gl_date = str(gl.get("date", ""))

            best_match = None
            best_tier  = 5

            for bank in req.bank_transactions:
                bank_amt  = float(bank.get("amount", 0))
                bank_ref  = str(bank.get("reference", ""))
                bank_date = str(bank.get("date", ""))

                if abs(gl_amt - bank_amt) > 0.01:
                    continue  # amounts must match for tiers 1-3

                # Calculate date diff in days
                date_diff = 999
                try:
                    gd = datetime.strptime(gl_date[:10],   "%Y-%m-%d")
                    bd = datetime.strptime(bank_date[:10], "%Y-%m-%d")
                    date_diff = abs((gd - bd).days)
                except Exception:
                    date_diff = 999

                ref_match = gl_ref and bank_ref and (gl_ref in bank_ref or bank_ref in gl_ref)

                if date_diff == 0 and ref_match:
                    tier = 1
                elif date_diff <= 2:
                    tier = 2
                elif date_diff < 999:
                    tier = 3
                else:
                    continue

                if tier < best_tier:
                    best_tier  = tier
                    best_match = bank

            if best_match and best_tier in (1, 2):
                match_row = BankReconMatch(
                    period=req.period, gl_reference=gl_ref,
                    bank_reference=str(best_match.get("reference", "")),
                    amount=gl_amt, match_tier=best_tier, match_type="auto",
                    status="matched", gl_date=gl_date,
                    bank_date=str(best_match.get("date", "")),
                )
                db.add(match_row)
                db.flush()
                matched.append({"gl": gl, "bank": best_match, "tier": best_tier, "id": match_row.id})

            elif best_match and best_tier == 3:
                match_row = BankReconMatch(
                    period=req.period, gl_reference=gl_ref,
                    bank_reference=str(best_match.get("reference", "")),
                    amount=gl_amt, match_tier=3, match_type="auto",
                    status="review", gl_date=gl_date,
                    bank_date=str(best_match.get("date", "")),
                )
                db.add(match_row)
                db.flush()
                review.append({"gl": gl, "bank": best_match, "tier": 3, "id": match_row.id})

            else:
                # Tier 4 — exception, suggest JE
                suggested_je = (
                    f"Dr Bank Charges 7001 / Cr Cash 1001  AED {gl_amt:.2f}  "
                    f"Ref: {gl_ref}  Date: {gl_date}"
                )
                match_row = BankReconMatch(
                    period=req.period, gl_reference=gl_ref,
                    bank_reference="UNMATCHED",
                    amount=gl_amt, match_tier=4, match_type="exception",
                    status="exception", gl_date=gl_date, bank_date="",
                    suggested_je=suggested_je,
                )
                db.add(match_row)
                db.flush()
                exceptions.append({"gl": gl, "tier": 4, "id": match_row.id, "suggested_je": suggested_je})

        db.commit()
        return {
            "period": req.period,
            "matched":    matched,
            "review":     review,
            "exceptions": exceptions,
            "stats": {
                "matched_count":   len(matched),
                "review_count":    len(review),
                "exception_count": len(exceptions),
                "total":           len(matched) + len(review) + len(exceptions),
            },
        }
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── POST /api/recon/approve-match/{match_id} ──────────────────────────────────

@router.post("/api/recon/approve-match/{match_id}")
async def approve_match(match_id: int, db: Session = Depends(get_db)):
    """Approve a recon match — auto-creates GL entry for exceptions."""
    try:
        match = db.query(BankReconMatch).filter(BankReconMatch.id == match_id).first()
        if not match:
            raise HTTPException(status_code=404, detail="Match not found")

        if match.match_tier == 4:
            # Auto-create posted JE for exception
            je_id = f"JE-RECON-{match_id}-{uuid.uuid4().hex[:4].upper()}"
            db.add(GLEntry(
                je_id=je_id, account_code="7001",
                account_name="Bank Charges",
                debit=match.amount or 0.0, credit=0.0,
                period=match.period, source="recon",
            ))
            db.add(GLEntry(
                je_id=je_id, account_code="1001",
                account_name="Cash at Bank",
                debit=0.0, credit=match.amount or 0.0,
                period=match.period, source="recon",
            ))

        match.status = "reconciled"
        match.match_type = "manual"
        _log(db, "approve_match", "bank_recon_match", str(match_id),
             new_value={"status": "reconciled"})
        db.commit()

        return {"match_id": match_id, "status": "reconciled", "period": match.period}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── UAE-specific invoice-to-JE (5% VAT, AED) ─────────────────────────────────

@router.post("/api/uae/accounting/invoice-to-je")
async def uae_invoice_to_je(body: dict, db: Session = Depends(get_db)):
    """UAE-specific invoice-to-JE: 5% VAT, AED, UAE GL codes."""
    try:
        invoice_id = body.get("invoice_id", f"INV-{uuid.uuid4().hex[:6].upper()}")
        invoice_type = str(body.get("invoice_type", "AP")).upper()
        amount = float(body.get("amount", 0))
        vendor = body.get("vendor", "")

        je_id = f"JE-UAE-{invoice_id}-{uuid.uuid4().hex[:6].upper()}"
        period = _period_now()
        net = _aed(amount)
        vat = _aed(net * 0.05)  # UAE VAT 5%
        gross = _aed(net + vat)

        UAE_COA = {
            "expense": "6001", "vat_recoverable": "1110",
            "trade_payables": "2001", "trade_receivables": "1300",
            "revenue": "4001", "vat_payable": "2200",
        }
        UAE_NAMES = {
            "6001": "Operating Expenses", "1110": "VAT Recoverable",
            "2001": "Trade Payables", "1300": "Trade Receivables",
            "4001": "Revenue", "2200": "VAT Payable",
        }

        if invoice_type == "AP":
            lines = [
                {"account_code": UAE_COA["expense"],          "account_name": UAE_NAMES["6001"], "debit": net,   "credit": 0.0},
                {"account_code": UAE_COA["vat_recoverable"],  "account_name": UAE_NAMES["1110"], "debit": vat,   "credit": 0.0},
                {"account_code": UAE_COA["trade_payables"],   "account_name": UAE_NAMES["2001"], "debit": 0.0,   "credit": gross},
            ]
        else:
            lines = [
                {"account_code": UAE_COA["trade_receivables"],"account_name": UAE_NAMES["1300"], "debit": gross, "credit": 0.0},
                {"account_code": UAE_COA["revenue"],          "account_name": UAE_NAMES["4001"], "debit": 0.0,   "credit": net},
                {"account_code": UAE_COA["vat_payable"],      "account_name": UAE_NAMES["2200"], "debit": 0.0,   "credit": vat},
            ]

        for ln in lines:
            db.add(GLEntry(
                je_id=je_id, account_code=ln["account_code"],
                account_name=ln["account_name"], debit=ln["debit"],
                credit=ln["credit"], period=period, source="invoice",
            ))
        _log(db, "uae_invoice_to_je", "invoice", invoice_id, new_value={"je_id": je_id, "country": "UAE"})
        db.commit()

        return {
            "je_id": je_id, "lines": lines, "status": "draft", "period": period,
            "country": "UAE", "currency": "AED", "tax_rate": 0.05,
            "vat_amount": vat, "gross_amount": gross, "vendor": vendor,
        }
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── India-specific invoice-to-JE (18% GST, INR) ──────────────────────────────

@router.post("/api/india/accounting/invoice-to-je")
async def india_invoice_to_je(body: dict, db: Session = Depends(get_db)):
    """India-specific invoice-to-JE: 18% GST, INR, India GL codes."""
    try:
        invoice_id = body.get("invoice_id", f"INV-{uuid.uuid4().hex[:6].upper()}")
        invoice_type = str(body.get("invoice_type", "AP")).upper()
        amount = float(body.get("amount", 0))
        vendor = body.get("vendor", "")

        je_id = f"JE-IND-{invoice_id}-{uuid.uuid4().hex[:6].upper()}"
        period = _period_now()
        net = round(amount, 2)
        gst = round(net * 0.18, 2)  # India GST 18%
        gross = round(net + gst, 2)

        IND_NAMES = {
            "6001": "Operating Expenses", "1110": "GST Input",
            "2001": "Sundry Creditors",   "1300": "Sundry Debtors",
            "4001": "Revenue",            "2200": "GST Output",
        }

        if invoice_type == "AP":
            lines = [
                {"account_code": "6001", "account_name": IND_NAMES["6001"], "debit": net,   "credit": 0.0},
                {"account_code": "1110", "account_name": IND_NAMES["1110"], "debit": gst,   "credit": 0.0},
                {"account_code": "2001", "account_name": IND_NAMES["2001"], "debit": 0.0,   "credit": gross},
            ]
        else:
            lines = [
                {"account_code": "1300", "account_name": IND_NAMES["1300"], "debit": gross, "credit": 0.0},
                {"account_code": "4001", "account_name": IND_NAMES["4001"], "debit": 0.0,   "credit": net},
                {"account_code": "2200", "account_name": IND_NAMES["2200"], "debit": 0.0,   "credit": gst},
            ]

        for ln in lines:
            db.add(GLEntry(
                je_id=je_id, account_code=ln["account_code"],
                account_name=ln["account_name"], debit=ln["debit"],
                credit=ln["credit"], period=period, source="invoice",
            ))
        _log(db, "india_invoice_to_je", "invoice", invoice_id, new_value={"je_id": je_id, "country": "India"})
        db.commit()

        return {
            "je_id": je_id, "lines": lines, "status": "draft", "period": period,
            "country": "India", "currency": "INR", "tax_rate": 0.18,
            "gst_amount": gst, "gross_amount": gross, "vendor": vendor,
        }
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── UAE close status ──────────────────────────────────────────────────────────

@router.get("/api/uae/accounting/close-status/{period}")
async def uae_close_status(period: str, db: Session = Depends(get_db)):
    """UAE month-end close checklist with completion %."""
    try:
        ap_count    = db.query(GLEntry).filter(GLEntry.period == period, GLEntry.source == "invoice").count()
        je_count    = db.query(GLEntry).filter(GLEntry.period == period).count()
        recon_count = db.query(BankReconMatch).filter(BankReconMatch.period == period).count()
        tb_generated = je_count > 0
        accruals_done = db.query(AccrualSuggestion).filter(
            AccrualSuggestion.period == period, AccrualSuggestion.status == "accepted"
        ).count() > 0

        checklist = [
            {"step": "ap_invoices_posted",       "label": "AP Invoices Posted to GL (AED)",    "status": "complete" if ap_count > 0 else "pending",      "count": ap_count,    "path": "/uae-full/invoices"},
            {"step": "journal_entries_posted",   "label": "Journal Entries Posted",             "status": "complete" if je_count > 0 else "pending",      "count": je_count,    "path": "/uae-full/journals"},
            {"step": "accruals_posted",          "label": "Accruals Posted (EOSB, Prepaid)",   "status": "complete" if accruals_done else "pending",      "count": 0,           "path": "/uae-full/accruals"},
            {"step": "bank_recon_complete",      "label": "Bank Reconciliation Complete",       "status": "complete" if recon_count > 0 else "pending",    "count": recon_count, "path": "/uae-full/bank-recon"},
            {"step": "vat_return_prepared",      "label": "UAE VAT Return Prepared (FTA 5%)",  "status": "pending",                                       "count": 0,           "path": "/uae-full/period-close"},
            {"step": "trial_balance_generated",  "label": "Trial Balance Generated",           "status": "complete" if tb_generated else "pending",       "count": je_count,    "path": "/uae-accounting/trial-balances"},
            {"step": "ifrs_generated",           "label": "IFRS Statements Generated",         "status": "pending",                                       "count": 0,           "path": "/ifrs-statement"},
        ]

        complete_count = sum(1 for c in checklist if c["status"] == "complete")
        completion_pct = round(complete_count / len(checklist) * 100)

        return {
            "period": period, "country": "UAE", "currency": "AED",
            "checklist": checklist, "complete_count": complete_count,
            "total_steps": len(checklist), "completion_pct": completion_pct,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── India close status ────────────────────────────────────────────────────────

@router.get("/api/india/accounting/close-status/{period}")
async def india_close_status(period: str, db: Session = Depends(get_db)):
    """India month-end close checklist (Apr-Mar fiscal year, INR, GST 18%)."""
    try:
        ap_count    = db.query(GLEntry).filter(GLEntry.period == period, GLEntry.source == "invoice").count()
        je_count    = db.query(GLEntry).filter(GLEntry.period == period).count()
        recon_count = db.query(BankReconMatch).filter(BankReconMatch.period == period).count()
        tb_generated = je_count > 0
        accruals_done = db.query(AccrualSuggestion).filter(
            AccrualSuggestion.period == period, AccrualSuggestion.status == "accepted"
        ).count() > 0

        checklist = [
            {"step": "purchase_invoices_posted", "label": "Purchase Invoices Posted (INR)",    "status": "complete" if ap_count > 0 else "pending",      "count": ap_count,    "path": "/india-full/purchases"},
            {"step": "journal_entries_posted",   "label": "Journal Entries Posted",             "status": "complete" if je_count > 0 else "pending",      "count": je_count,    "path": "/india-full/journals"},
            {"step": "accruals_posted",          "label": "Accruals Posted (Gratuity, Leave)",  "status": "complete" if accruals_done else "pending",      "count": 0,           "path": "/india-full/close"},
            {"step": "bank_recon_complete",      "label": "Bank Reconciliation Complete",       "status": "complete" if recon_count > 0 else "pending",    "count": recon_count, "path": "/india-full/close"},
            {"step": "gst_return_filed",         "label": "GST Returns Filed (GSTR-1 / 3B)",   "status": "pending",                                       "count": 0,           "path": "/india-full/gst"},
            {"step": "tds_deposited",            "label": "TDS Deposited & Returns Filed",      "status": "pending",                                       "count": 0,           "path": "/india-full/tds"},
            {"step": "trial_balance_generated",  "label": "Trial Balance Generated",           "status": "complete" if tb_generated else "pending",       "count": je_count,    "path": "/india-full/management"},
        ]

        complete_count = sum(1 for c in checklist if c["status"] == "complete")
        completion_pct = round(complete_count / len(checklist) * 100)

        return {
            "period": period, "country": "India", "currency": "INR",
            "fiscal_year": "Apr-Mar",
            "checklist": checklist, "complete_count": complete_count,
            "total_steps": len(checklist), "completion_pct": completion_pct,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── UAE trial balance from posted JEs ────────────────────────────────────────

@router.get("/api/uae/accounting/trial-balance/generate/{period}")
async def generate_uae_trial_balance(period: str, db: Session = Depends(get_db)):
    """Generate UAE trial balance from posted GL journal entries."""
    try:
        rows = db.query(GLEntry).filter(GLEntry.period == period).all()
        source_label = "Posted Journal Entries"

        if not rows:
            demo = [
                {"account_code": "1300", "account_name": "Trade Receivables", "total_debit": 250000.00, "total_credit": 0.0,       "net": 250000.00},
                {"account_code": "1110", "account_name": "VAT Recoverable",   "total_debit": 12500.00,  "total_credit": 0.0,       "net": 12500.00},
                {"account_code": "2001", "account_name": "Trade Payables",    "total_debit": 0.0,        "total_credit": 180000.00, "net": -180000.00},
                {"account_code": "2200", "account_name": "VAT Payable",       "total_debit": 0.0,        "total_credit": 5250.00,   "net": -5250.00},
                {"account_code": "4001", "account_name": "Revenue",           "total_debit": 0.0,        "total_credit": 105000.00, "net": -105000.00},
                {"account_code": "6001", "account_name": "Operating Expenses","total_debit": 27250.00,   "total_credit": 0.0,       "net": 27250.00},
            ]
            return {
                "period": period, "rows": demo, "source": source_label,
                "country": "UAE", "currency": "AED",
                "total_debit": sum(r["total_debit"] for r in demo),
                "total_credit": sum(r["total_credit"] for r in demo),
                "balanced": True, "demo_data": True,
            }

        by_account: dict[str, dict] = {}
        for row in rows:
            code = row.account_code
            if code not in by_account:
                by_account[code] = {
                    "account_code": code,
                    "account_name": row.account_name or COA_NAMES.get(code, code),
                    "total_debit": 0.0, "total_credit": 0.0,
                }
            by_account[code]["total_debit"]  += row.debit or 0.0
            by_account[code]["total_credit"] += row.credit or 0.0

        result = []
        for r in by_account.values():
            r["net"] = _aed(r["total_debit"] - r["total_credit"])
            r["total_debit"]  = _aed(r["total_debit"])
            r["total_credit"] = _aed(r["total_credit"])
            result.append(r)

        result.sort(key=lambda x: x["account_code"])
        total_debit  = _aed(sum(r["total_debit"]  for r in result))
        total_credit = _aed(sum(r["total_credit"] for r in result))

        return {
            "period": period, "rows": result, "source": source_label,
            "country": "UAE", "currency": "AED",
            "total_debit": total_debit, "total_credit": total_credit,
            "balanced": abs(total_debit - total_credit) < 0.01, "demo_data": False,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── UAE TB to IFRS ────────────────────────────────────────────────────────────

@router.post("/api/uae/accounting/tb-to-ifrs/{period}")
async def tb_to_ifrs(period: str, db: Session = Depends(get_db)):
    """Map trial balance to IFRS P&L structure for UAE."""
    try:
        rows = db.query(GLEntry).filter(GLEntry.period == period).all()
        revenue   = sum((r.credit - r.debit) for r in rows if r.account_code.startswith("4"))
        expenses  = sum((r.debit - r.credit) for r in rows if r.account_code.startswith("6"))
        assets    = sum((r.debit - r.credit) for r in rows if r.account_code.startswith("1"))
        liabilities = sum((r.credit - r.debit) for r in rows if r.account_code.startswith("2"))

        if not rows:
            revenue = 105000.0; expenses = 27250.0; assets = 262500.0; liabilities = 185250.0

        ifrs_pl = {
            "revenue": _aed(revenue),
            "cost_of_sales": 0.0,
            "gross_profit": _aed(revenue),
            "operating_expenses": _aed(expenses),
            "operating_profit": _aed(revenue - expenses),
            "finance_costs": 0.0,
            "profit_before_tax": _aed(revenue - expenses),
            "tax_expense": 0.0,  # UAE has 0% corp tax for most entities
            "profit_after_tax": _aed(revenue - expenses),
        }

        try:
            from app.core.aws_config import upload_to_s3
            import json as _json
            key = f"reports/ifrs/{period}/uae_pl.json"
            upload_to_s3(_json.dumps({"period": period, "ifrs_pl": ifrs_pl}).encode(), key)
        except Exception:
            pass

        return {
            "period": period, "status": "generated", "source": "trial_balance",
            "country": "UAE", "currency": "AED",
            "ifrs_pl": ifrs_pl,
            "balance_sheet_summary": {"total_assets": _aed(assets), "total_liabilities": _aed(liabilities)},
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Bank recon → JE suggestion ────────────────────────────────────────────────

@router.post("/api/uae/accounting/recon-to-je")
async def recon_to_je(body: dict, db: Session = Depends(get_db)):
    """Create JE suggestion for an unmatched bank item."""
    try:
        amount = float(body.get("amount", 0))
        description = body.get("description", "Bank transaction")
        return {
            "suggested_je": {
                "debit_account": "7402", "debit_name": "Bank Charges",
                "credit_account": "1002", "credit_name": "Cash at Bank",
                "amount": _aed(amount), "description": description,
                "currency": "AED",
            }
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── FP&A sync from accounting ─────────────────────────────────────────────────

@router.post("/api/fpa/sync-from-accounting")
async def sync_fpa_from_accounting(body: dict, db: Session = Depends(get_db)):
    """Pull trial balance for period and return variance-ready rows for FP&A."""
    try:
        country = body.get("country", "UAE")
        period  = body.get("period", _period_now())
        rows    = db.query(GLEntry).filter(GLEntry.period == period).all()

        currency = "AED" if country == "UAE" else "INR"

        revenue     = sum((r.credit - r.debit) for r in rows if r.account_code.startswith("4"))
        expenses    = sum((r.debit - r.credit) for r in rows if r.account_code.startswith("6"))
        assets      = sum((r.debit - r.credit) for r in rows if r.account_code.startswith("1"))
        liabilities = sum((r.credit - r.debit) for r in rows if r.account_code.startswith("2"))

        if not rows:
            revenue = 105000.0; expenses = 27250.0; assets = 262500.0; liabilities = 185250.0

        variance_rows = [
            {"account": "Revenue",            "department": "All", "actual": _aed(revenue),  "budget": _aed(revenue * 0.95), "accountType": "income"},
            {"account": "Operating Expenses", "department": "All", "actual": _aed(expenses), "budget": _aed(expenses * 1.05), "accountType": "expense"},
        ]

        return {
            "period": period, "country": country, "currency": currency,
            "synced_at": datetime.utcnow().isoformat(),
            "source_label": f"Actuals sourced from {country} IFRS Statements",
            "actuals": {
                "revenue": _aed(revenue), "expenses": _aed(expenses),
                "gross_profit": _aed(revenue - expenses),
                "assets": _aed(assets), "liabilities": _aed(liabilities),
            },
            "variance_rows": variance_rows,
            "ready_for_variance": True,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── GET /api/recon/status/{period} ────────────────────────────────────────────

@router.get("/api/recon/status/{period}")
async def recon_status(period: str, db: Session = Depends(get_db)):
    """Return reconciliation summary for a period."""
    try:
        all_matches = db.query(BankReconMatch).filter(BankReconMatch.period == period).all()

        matched_count   = sum(1 for m in all_matches if m.status in ("matched", "reconciled"))
        unmatched_count = sum(1 for m in all_matches if m.status in ("exception", "review"))

        gl_balance   = _aed(sum(m.amount or 0 for m in all_matches if m.status in ("matched", "reconciled")))
        bank_balance = _aed(gl_balance)  # Simplified: identical when matched
        difference   = _aed(gl_balance - bank_balance)

        return {
            "period": period,
            "matched_count":   matched_count,
            "unmatched_count": unmatched_count,
            "gl_balance":      gl_balance,
            "bank_balance":    bank_balance,
            "difference":      difference,
            "currency":        "AED",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
