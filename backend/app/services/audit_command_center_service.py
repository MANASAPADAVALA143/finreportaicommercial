"""Unified Audit Command Center — composite JE + AP + VAT scoring."""
from __future__ import annotations

import logging
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

NARRATIVE_SYSTEM = (
    "You are a senior external auditor writing formal audit findings for a "
    "UAE-based company. Write exactly 3 paragraphs in professional audit "
    "language. Paragraph 1: Journal entry anomaly findings. Paragraph 2: "
    "AP/procurement anomaly findings. Paragraph 3: VAT compliance findings. "
    "Be specific about the flags provided. Do not use bullet points. "
    "Do not use headings. Write as if this is an official audit memo."
)


def parse_period_dates(period: str) -> tuple[date, date]:
    from app.modules.gulftax.vat_return_service import parse_period

    return parse_period(period)


def _risk_label(score: float) -> str:
    s = float(score or 0)
    if s >= 80:
        return "critical"
    if s >= 60:
        return "high"
    if s >= 40:
        return "medium"
    return "low"


def _resolve_ported_company_id(ported_db: Session, finreport_company_id: str, workspace_id: str) -> str | None:
    from app.modules.gulftax.ported_mount import _alias_ported_orm_modules

    _alias_ported_orm_modules()
    from models import Company

    cid = (finreport_company_id or "").strip()
    if cid and ported_db.query(Company).filter(Company.id == cid).first():
        return cid
    if cid:
        row = ported_db.query(Company).filter(Company.external_id == cid).first()
        if row:
            return row.id
    ws = (workspace_id or "").strip()
    if ws:
        row = ported_db.query(Company).filter(Company.workspace_id == ws).first()
        if row:
            return row.id
    return None


def summarize_je_pattern(
    db: Session,
    *,
    period: str,
    workspace_id: str,
    company_id: str | None = None,
) -> dict[str, Any]:
    """Run R2RPatternEngine on posted UAE journal lines for the period."""
    from app.models.uae_accounting_full import UAEJournalEntry
    from app.services.r2r_pattern_engine import R2RPatternEngine

    start, end = parse_period_dates(period)

    def _load(entries) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for je in entries:
            for line in je.lines or []:
                debit = float(line.debit or 0)
                credit = float(line.credit or 0)
                amount = debit if debit > 0 else credit
                if amount <= 0:
                    continue
                rows.append({
                    "date": je.entry_date.isoformat() if je.entry_date else start.isoformat(),
                    "account": line.account_name or line.account_code or "Unknown",
                    "amount": amount,
                    "debit": debit,
                    "credit": credit,
                    "description": line.description or je.description or "",
                    "reference": (je.entry_number or je.reference or "") or None,
                    "entry_number": je.entry_number or None,
                    "user": je.approved_by or je.source or "system",
                    "entry_id": je.id,
                })
        return rows

    base = db.query(UAEJournalEntry).filter(
        UAEJournalEntry.tenant_id == workspace_id,
        UAEJournalEntry.entry_date >= start,
        UAEJournalEntry.entry_date <= end,
        UAEJournalEntry.status.in_(("posted", "approved")),
    )
    scope = "company"
    entries = base
    if company_id:
        entries = base.filter(
            (UAEJournalEntry.company_id == company_id) | (UAEJournalEntry.company_id.is_(None))
        )
    rows = _load(entries.all())
    # Fall back to full workspace books when company slice is too thin for R2R (≥10).
    if len(rows) < 10:
        rows = _load(base.all())
        scope = "workspace"

    if len(rows) < 10:
        return {
            "risk_score": 0.0,
            "high_count": 0,
            "medium_count": 0,
            "top_flags": [
                f"Insufficient journal lines for R2R analysis ({len(rows)} rows; need ≥10)"
            ],
            "entry_count": len(rows),
            "period": period,
            "scope": scope,
        }

    df = pd.DataFrame(rows)
    engine = R2RPatternEngine()
    result = engine.analyse(df, sensitivity="balanced", db=db, client_id=company_id or "")
    if isinstance(result, dict) and result.get("error"):
        return {
            "risk_score": 0.0,
            "high_count": 0,
            "medium_count": 0,
            "top_flags": [str(result["error"])],
            "entry_count": len(rows),
            "period": period,
            "scope": scope,
        }

    summary = result.get("summary") or {}
    high = int(summary.get("high_risk") or 0)
    medium = int(summary.get("medium_risk") or 0)
    total = int(summary.get("total_entries") or len(rows)) or 1
    high_pct = (high / total) * 100
    flagged_pct = float(summary.get("flagged_pct") or ((high + medium) / total * 100))
    risk_score = round(min(100.0, high_pct * 1.5 + flagged_pct * 0.35), 1)

    top_flags: list[str] = []
    if scope == "workspace" and company_id:
        top_flags.append(
            "JE population expanded to workspace books (company slice <10 lines)"
        )
    for fe in (result.get("flagged_entries") or [])[:8]:
        reasons = fe.get("plain_english_reason") or ", ".join(fe.get("risk_reasons") or [])
        ref = (
            fe.get("entry_number")
            or fe.get("reference")
            or (str(fe.get("entry_id") or "")[:8] + "…" if fe.get("entry_id") else None)
            or fe.get("account")
            or "JE"
        )
        # Avoid dumping raw UUIDs as the primary label
        ref_s = str(ref)
        if len(ref_s) == 36 and ref_s.count("-") == 4:
            ref_s = fe.get("entry_number") or fe.get("account") or "JE entry"
        score = fe.get("risk_score")
        label = f"{ref_s}: {reasons}" if reasons else f"{ref_s} risk {score}"
        if label not in top_flags:
            top_flags.append(label[:180])
        if len(top_flags) >= 5:
            break
    if len(top_flags) <= 1:
        top_flags.append(f"{high} high / {medium} medium risk journal lines in period")

    return {
        "risk_score": risk_score,
        "high_count": high,
        "medium_count": medium,
        "top_flags": top_flags[:5],
        "entry_count": total,
        "period": period,
        "scope": scope,
    }


def _benford_deviation_count(amounts: list[float]) -> int:
    """Count leading digits that deviate strongly from Benford expectation."""
    from app.services.r2r_pattern_engine import BENFORD_EXPECTED

    digits: list[int] = []
    for a in amounts:
        s = f"{abs(float(a)):.0f}".lstrip("0")
        if s and s[0].isdigit() and s[0] != "0":
            digits.append(int(s[0]))
    if len(digits) < 20:
        return 0
    counts = Counter(digits)
    n = len(digits)
    deviations = 0
    for d, expected in BENFORD_EXPECTED.items():
        actual = counts.get(d, 0) / n
        if abs(actual - expected) > 0.08:
            deviations += 1
    return deviations


def summarize_ap_anomaly(
    db: Session | None = None,
    *,
    period: str,
    workspace_id: str,
    company_id: str,
) -> dict[str, Any]:
    """Run ap_anomaly_engine across AP invoices linked to this GulfTax company/period.

    Invoices may live under a different Supabase company_id than the UAE profile
    used on gulftax_transactions — resolve via gulftax ap_invoice_id first.
    """
    from app.services.ap_anomaly_engine import detect_invoice_anomalies

    start, end = parse_period_dates(period)
    invoices: list[dict[str, Any]] = []
    invoice_ids: list[str] = []

    # 1) Prefer invoices already synced into gulftax_transactions for this company
    try:
        from app.core.database import SessionLocal
        from app.models.client_data import GulftaxTransaction

        own_db = db or SessionLocal()
        close_own = db is None
        try:
            gt_rows = (
                own_db.query(GulftaxTransaction)
                .filter(
                    GulftaxTransaction.company_id == company_id,
                    GulftaxTransaction.tax_period == period,
                    GulftaxTransaction.source == "ap_invoiceflow",
                    GulftaxTransaction.status == "posted",
                )
                .all()
            )
            if not gt_rows:
                # Date window fallback when tax_period stamp differs
                gt_rows = (
                    own_db.query(GulftaxTransaction)
                    .filter(
                        GulftaxTransaction.company_id == company_id,
                        GulftaxTransaction.source == "ap_invoiceflow",
                        GulftaxTransaction.status == "posted",
                        GulftaxTransaction.transaction_date >= start,
                        GulftaxTransaction.transaction_date <= end,
                    )
                    .all()
                )
            invoice_ids = [r.ap_invoice_id for r in gt_rows if r.ap_invoice_id]
        finally:
            if close_own:
                own_db.close()
    except Exception:
        logger.exception("AP anomaly: gulftax invoice id lookup failed")

    try:
        from app.core.supabase import get_supabase

        sb = get_supabase()
        by_id: dict[str, dict[str, Any]] = {}
        if invoice_ids:
            for iid in invoice_ids:
                res = sb.table("invoices").select("*").eq("id", iid).limit(1).execute()
                for row in res.data or []:
                    by_id[str(row.get("id"))] = row
        # 2) Also include direct company_id matches
        res = sb.table("invoices").select("*").eq("company_id", company_id).execute()
        for row in res.data or []:
            by_id[str(row.get("id"))] = row
        invoices = list(by_id.values())
    except Exception:
        logger.exception("AP anomaly summary: failed to load Supabase invoices")
        invoices = []

    in_period: list[dict[str, Any]] = []
    for inv in invoices:
        raw = str(inv.get("invoice_date") or inv.get("created_at") or "")[:10]
        try:
            d = date.fromisoformat(raw)
        except ValueError:
            continue
        if start <= d <= end:
            in_period.append(inv)

    if not in_period:
        return {
            "risk_score": 0.0,
            "benford_deviations": 0,
            "duplicate_count": 0,
            "round_number_count": 0,
            "top_flags": ["No AP invoices in period for anomaly scan"],
            "invoice_count": 0,
            "period": period,
        }

    scores: list[float] = []
    top_flags: list[str] = []
    duplicate_count = 0
    round_number_count = 0
    amounts = [float(i.get("total_amount") or 0) for i in in_period]

    for inv in in_period:
        vendor = (inv.get("vendor_name") or "").strip()
        history = [
            h for h in invoices
            if h.get("id") != inv.get("id")
            and (h.get("vendor_name") or "").strip().lower() == vendor.lower()
        ]
        result = detect_invoice_anomalies(inv, history, {"name": vendor})
        score = float(result.get("overall_risk_score") or 0)
        if score > 0:
            scores.append(score)
        for flag in result.get("flags") or []:
            ftype = str(flag.get("type") or flag.get("code") or "").lower()
            msg = str(flag.get("message") or flag.get("description") or ftype)
            if "duplicate" in ftype or "near_duplicate" in ftype:
                duplicate_count += 1
            if "round" in ftype:
                round_number_count += 1
            if score >= 40 and msg and msg not in top_flags:
                top_flags.append(f"{inv.get('invoice_number') or inv.get('id')}: {msg}"[:180])

    risk_score = round(max(scores), 1) if scores else 0.0
    if scores:
        top3 = sorted(scores, reverse=True)[:3]
        risk_score = round(0.6 * max(scores) + 0.4 * (sum(top3) / len(top3)), 1)

    benford = _benford_deviation_count(amounts)
    if not top_flags:
        top_flags = [f"Scanned {len(in_period)} AP invoices — no high-risk flags"]

    return {
        "risk_score": min(100.0, risk_score),
        "benford_deviations": benford,
        "duplicate_count": duplicate_count,
        "round_number_count": round_number_count,
        "top_flags": top_flags[:5],
        "invoice_count": len(in_period),
        "period": period,
        "workspace_id": workspace_id,
    }


def summarize_vat_checklist(
    ported_db: Session,
    *,
    period: str,
    finreport_company_id: str,
    workspace_id: str,
) -> dict[str, Any]:
    from app.modules.gulftax.ported_mount import _alias_ported_orm_modules
    from app.services.fta_audit_checklist_service import build_fta_audit_checklist

    _alias_ported_orm_modules()
    start, end = parse_period_dates(period)
    ported_cid = _resolve_ported_company_id(ported_db, finreport_company_id, workspace_id)
    if not ported_cid:
        return {
            "overall_score_pct": 0,
            "overall_risk": "high",
            "vat_flags": ["GulfTax company not provisioned for this workspace"],
            "items": [],
        }
    checklist = build_fta_audit_checklist(ported_db, ported_cid, start, end)
    flags = [
        f"{i.get('title')}: {i.get('detail')}"
        for i in (checklist.get("items") or [])
        if i.get("status") in ("warning", "fail")
    ][:3]
    return {
        "overall_score_pct": int(checklist.get("overall_score_pct") or 0),
        "overall_risk": checklist.get("overall_risk") or "low",
        "vat_flags": flags or ["No VAT compliance warnings for period"],
        "items": checklist.get("items") or [],
        "company_name": checklist.get("company_name"),
    }


def compute_command_center_score(
    db: Session,
    ported_db: Session,
    *,
    period: str,
    workspace_id: str,
    company_id: str,
    company_name: str | None = None,
) -> dict[str, Any]:
    je = summarize_je_pattern(db, period=period, workspace_id=workspace_id, company_id=company_id)
    ap = summarize_ap_anomaly(
        db, period=period, workspace_id=workspace_id, company_id=company_id
    )
    vat = summarize_vat_checklist(
        ported_db,
        period=period,
        finreport_company_id=company_id,
        workspace_id=workspace_id,
    )

    je_score = float(je.get("risk_score") or 0)
    ap_score = float(ap.get("risk_score") or 0)
    vat_score = float(vat.get("overall_score_pct") or 0)

    composite_score = round(
        (je_score * 0.40) + (ap_score * 0.30) + (vat_score * 0.30),
        1,
    )
    composite_risk = _risk_label(composite_score)

    vat_risk = str(vat.get("overall_risk") or "low")
    if vat_risk not in ("low", "medium", "high", "critical"):
        vat_risk = _risk_label(vat_score)

    name = company_name or vat.get("company_name") or "the Company"

    return {
        "composite_score": composite_score,
        "composite_risk": composite_risk,
        "je_score": round(je_score, 1),
        "je_risk": _risk_label(je_score),
        "je_flags": list(je.get("top_flags") or [])[:5],
        "ap_score": round(ap_score, 1),
        "ap_risk": _risk_label(ap_score),
        "ap_flags": list(ap.get("top_flags") or [])[:5],
        "vat_score": round(vat_score, 1),
        "vat_risk": vat_risk,
        "vat_flags": list(vat.get("vat_flags") or [])[:3],
        "last_run": datetime.now(timezone.utc).isoformat(),
        "period": period,
        "workspace_id": workspace_id,
        "company_id": company_id,
        "company_name": name,
        "weights": {"je": 0.40, "ap": 0.30, "vat": 0.30},
    }


def generate_audit_narrative(payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.llm_service import LLMNotConfiguredError, LLMRateLimitError, invoke

    period = payload.get("period") or ""
    company = payload.get("company_name") or "the Company"
    user_prompt = (
        f"Company name: {company}\n"
        f"Audit period: {period}\n"
        f"Composite risk score: {payload.get('composite_score')}\n\n"
        f"Journal entry risk score: {payload.get('je_score')}\n"
        f"JE flags: {'; '.join(payload.get('je_flags') or ['none'])}\n\n"
        f"AP anomaly risk score: {payload.get('ap_score')}\n"
        f"AP flags: {'; '.join(payload.get('ap_flags') or ['none'])}\n\n"
        f"VAT compliance score (higher is better): {payload.get('vat_score')}\n"
        f"VAT flags: {'; '.join(payload.get('vat_flags') or ['none'])}\n\n"
        "Requirements: Use the real company name above. Do not use placeholders "
        "like [Company Name] or [Audit Date]. Do not add a letter header, "
        "subject line, or salutation — output exactly three body paragraphs only."
    )
    try:
        text = invoke(
            user_prompt,
            max_tokens=1200,
            temperature=0.3,
            system=NARRATIVE_SYSTEM,
            model_id=None,
        )
    except (LLMNotConfiguredError, LLMRateLimitError):
        raise
    except Exception as exc:
        logger.exception("Audit narrative generation failed")
        raise RuntimeError(str(exc)) from exc

    narrative = (text or "").strip()
    return {
        "narrative": narrative,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": period,
        "company_name": company,
        "model": "ANTHROPIC_MODEL",
    }
