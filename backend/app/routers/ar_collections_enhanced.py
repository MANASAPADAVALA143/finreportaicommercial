"""
AR Collections Enhanced
=======================
Full AR module: aging table, payment prediction, AI dunning emails,
credit limit tracking, AR-bank reconciliation, AI portfolio insight.

Routes prefix: /api/ar
"""
from __future__ import annotations

import os
from io import StringIO
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

router = APIRouter()


def _claude():
    import anthropic
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not set — add it to backend/.env")
    return anthropic.Anthropic(api_key=key)


def _read_csv(file_bytes: bytes) -> pd.DataFrame:
    try:
        return pd.read_csv(StringIO(file_bytes.decode("utf-8")))
    except Exception:
        return pd.read_csv(StringIO(file_bytes.decode("latin-1")))


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series([0.0] * len(df))
    return pd.to_numeric(df[col], errors="coerce").fillna(0.0)


# ── 1. Invoice Aging Table ─────────────────────────────────────────────────────

@router.post("/invoice-aging", summary="Per-customer AR aging table")
async def invoice_aging(file: UploadFile = File(...)):
    """
    Upload AR invoice CSV → per-customer aging table + summary buckets.
    Required columns: invoice_id, customer_name, outstanding_aed, days_overdue,
                      aging_bucket, credit_limit_aed, credit_utilisation_pct,
                      account_manager, contact_email
    """
    raw = await file.read()
    df = _read_csv(raw)

    df["outstanding_aed"]        = _num(df, "outstanding_aed")
    df["days_overdue"]           = _num(df, "days_overdue")
    df["payment_probability"]    = _num(df, "payment_probability")
    df["credit_limit_aed"]       = _num(df, "credit_limit_aed")
    df["credit_utilisation_pct"] = _num(df, "credit_utilisation_pct")

    def bucket(row: pd.Series) -> str:
        if "aging_bucket" in df.columns and row.get("aging_bucket"):
            return str(row["aging_bucket"])
        d = row["days_overdue"]
        if d <= 0:   return "Current"
        if d <= 30:  return "1-30 days"
        if d <= 60:  return "31-60 days"
        if d <= 90:  return "61-90 days"
        return "90+ days"

    df["aging_bucket"] = df.apply(bucket, axis=1)

    aging_summary = {
        "current":     float(df[df["aging_bucket"] == "Current"]["outstanding_aed"].sum()),
        "days_1_30":   float(df[df["aging_bucket"] == "1-30 days"]["outstanding_aed"].sum()),
        "days_31_60":  float(df[df["aging_bucket"] == "31-60 days"]["outstanding_aed"].sum()),
        "days_61_90":  float(df[df["aging_bucket"] == "61-90 days"]["outstanding_aed"].sum()),
        "days_90_plus":float(df[df["aging_bucket"] == "90+ days"]["outstanding_aed"].sum()),
    }

    agg_cols = {
        "total_outstanding": ("outstanding_aed", "sum"),
        "invoice_count":     ("invoice_id", "count"),
        "max_days_overdue":  ("days_overdue", "max"),
        "avg_payment_prob":  ("payment_probability", "mean"),
    }
    for extra_col, alias in [("credit_limit_aed", "credit_limit"),
                              ("credit_utilisation_pct", "credit_utilisation"),
                              ("account_manager", "account_manager"),
                              ("contact_email", "contact_email")]:
        if extra_col in df.columns:
            agg_cols[alias] = (extra_col, "first")

    cust = df.groupby("customer_name").agg(**agg_cols).reset_index()

    def risk(row: pd.Series) -> str:
        d = row["max_days_overdue"]
        return ("🔴 Critical" if d > 90 else "🟠 High" if d > 60
                else "🟡 Medium" if d > 30 else "🟢 Good")

    cust["risk_flag"] = cust.apply(risk, axis=1)

    total_ar  = float(df["outstanding_aed"].sum())
    overdue   = float(df[df["days_overdue"] > 0]["outstanding_aed"].sum())

    return {
        "total_ar_aed":      total_ar,
        "overdue_ar_aed":    overdue,
        "overdue_pct":       round(overdue / total_ar * 100, 1) if total_ar else 0,
        "aging_summary":     aging_summary,
        "customer_summary":  cust.to_dict(orient="records"),
        "invoice_detail":    df.to_dict(orient="records"),
    }


# ── 2. Payment Prediction ─────────────────────────────────────────────────────

@router.post("/payment-prediction", summary="ML-style payment risk scoring")
async def payment_prediction(file: UploadFile = File(...)):
    raw = await file.read()
    df  = _read_csv(raw)

    df["outstanding_aed"]        = _num(df, "outstanding_aed")
    df["days_overdue"]           = _num(df, "days_overdue")
    df["credit_utilisation_pct"] = _num(df, "credit_utilisation_pct")

    predictions = []
    for _, row in df.iterrows():
        score = 100
        d = row["days_overdue"]
        if d > 90: score -= 60
        elif d > 60: score -= 40
        elif d > 30: score -= 20
        elif d > 0:  score -= 10

        u = row["credit_utilisation_pct"]
        if u > 80: score -= 20
        elif u > 50: score -= 10

        amt = row["outstanding_aed"]
        if amt > 500_000: score -= 10
        elif amt > 200_000: score -= 5

        name_lower = str(row.get("customer_name", "")).lower()
        if any(w in name_lower for w in ["dewa", "adnoc", "police", "municipality", "authority", "rta", "government"]):
            score += 5   # government: reliable but slow

        score = max(0, min(100, score))
        risk  = ("Critical" if score < 30 else "High" if score < 50
                 else "Medium" if score < 70 else "Low")
        days_fc = (90 if score < 30 else 60 if score < 50
                   else 30 if score < 70 else 14)
        action  = (
            "Escalate to legal / senior management"      if score < 20 else
            "Issue final notice + CFO call"              if score < 40 else
            "Send firm reminder + offer payment plan"    if score < 60 else
            "Standard follow-up reminder"                if score < 80 else
            "No action needed"
        )
        predictions.append({
            "invoice_id":                row.get("invoice_id"),
            "customer_name":             row.get("customer_name"),
            "outstanding_aed":           float(amt),
            "days_overdue":              int(d),
            "payment_probability_pct":   score,
            "risk_level":                risk,
            "predicted_collection_days": days_fc,
            "recommended_action":        action,
        })

    predictions.sort(key=lambda x: x["payment_probability_pct"])
    at_risk = sum(p["outstanding_aed"] for p in predictions if p["risk_level"] in ("Critical", "High"))

    return {
        "predictions":             predictions,
        "at_risk_amount_aed":      at_risk,
        "at_risk_count":           sum(1 for p in predictions if p["risk_level"] in ("Critical", "High")),
        "expected_collection_30d": sum(p["outstanding_aed"] for p in predictions if p["predicted_collection_days"] <= 30),
    }


# ── 3. Dunning Email Generator ────────────────────────────────────────────────

class DunningRequest(BaseModel):
    customer_name:    str
    invoice_id:       str
    outstanding_aed:  float
    days_overdue:     int
    contact_name:     Optional[str] = "Finance Team"
    our_company:      Optional[str] = "Al Futtaim Digital Services"
    dunning_level:    int  # 1 = polite, 2 = firm, 3 = final notice


@router.post("/dunning-email", summary="AI-generated dunning email (3 levels)")
async def dunning_email(req: DunningRequest):
    tone_map = {
        1: "polite and friendly, assuming it may be an oversight",
        2: "firm but professional, noting this is a follow-up",
        3: "urgent and formal, indicating this is a final notice before escalation",
    }
    prompt = f"""Write a {tone_map.get(req.dunning_level, tone_map[1])} payment reminder email for:

Company: {req.our_company}
To: {req.contact_name} at {req.customer_name}
Invoice: {req.invoice_id}
Amount Outstanding: AED {req.outstanding_aed:,.2f}
Days Overdue: {req.days_overdue} days

Requirements:
- UAE business context (professional Dubai tone)
- Reference the invoice number and exact AED amount
- Include clear call to action
- Subject line on first line prefixed with "Subject:"
- Keep under 150 words
- If Level 3, mention potential escalation steps

Return ONLY the email (subject line first, then body). No preamble."""

    msg = _claude().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    text  = msg.content[0].text.strip()
    lines = text.split("\n")
    subject = lines[0].replace("Subject:", "").strip() if lines else "Payment Reminder"
    body    = "\n".join(lines[1:]).strip()

    return {
        "subject":         subject,
        "body":            body,
        "dunning_level":   req.dunning_level,
        "level_label":     {1: "Polite Reminder", 2: "Firm Follow-up", 3: "Final Notice"}.get(req.dunning_level, ""),
        "invoice_id":      req.invoice_id,
        "customer_name":   req.customer_name,
        "outstanding_aed": req.outstanding_aed,
    }


# ── 4. Credit Limit Tracker ───────────────────────────────────────────────────

@router.post("/credit-limits", summary="Credit utilisation per customer with alerts")
async def credit_limits(file: UploadFile = File(...)):
    raw = await file.read()
    df  = _read_csv(raw)

    df["outstanding_aed"] = _num(df, "outstanding_aed")
    df["credit_limit_aed"] = _num(df, "credit_limit_aed")

    grp = df.groupby("customer_name").agg(
        total_outstanding=("outstanding_aed", "sum"),
        credit_limit=("credit_limit_aed", "first"),
        account_manager=("account_manager", "first") if "account_manager" in df.columns else ("outstanding_aed", "count"),
    ).reset_index()

    grp["utilisation_pct"] = (grp["total_outstanding"] / grp["credit_limit"].replace(0, 1) * 100).round(1)
    grp["available_credit"] = grp["credit_limit"] - grp["total_outstanding"]
    grp["credit_status"] = grp["utilisation_pct"].apply(
        lambda x: "🔴 Exceeded" if x > 100
        else "🟠 Critical (>80%)" if x > 80
        else "🟡 Warning (>60%)" if x > 60
        else "🟢 Healthy"
    )

    total_limit = float(grp["credit_limit"].sum())
    total_used  = float(grp["total_outstanding"].sum())

    return {
        "credit_summary":           grp.to_dict(orient="records"),
        "exceeded_count":           int((grp["utilisation_pct"] > 100).sum()),
        "warning_count":            int((grp["utilisation_pct"] > 80).sum()),
        "total_credit_extended":    total_limit,
        "total_utilised":           total_used,
        "overall_utilisation_pct":  round(total_used / total_limit * 100, 1) if total_limit else 0,
    }


# ── 5. AR vs Bank Reconciliation ─────────────────────────────────────────────

@router.post("/ar-bank-recon", summary="Match AR payments against bank receipts")
async def ar_bank_recon(
    file_ar:   UploadFile = File(...),
    file_bank: UploadFile = File(...),
):
    ar_df   = _read_csv(await file_ar.read())
    bank_df = _read_csv(await file_bank.read())

    ar_df["paid_amount_aed"]  = _num(ar_df,   "paid_amount_aed")
    ar_df["outstanding_aed"]  = _num(ar_df,   "outstanding_aed")
    bank_df["amount"] = _num(bank_df, "credit_aed") if "credit_aed" in bank_df.columns else _num(bank_df, "amount")

    receipts = bank_df[bank_df["amount"] > 0].copy()
    matched, unmatched_ar = [], []
    unmatched_bank = receipts.copy()

    for _, ar_row in ar_df[ar_df["paid_amount_aed"] > 0].iterrows():
        found = False
        for idx, b_row in unmatched_bank.iterrows():
            if abs(b_row["amount"] - ar_row["paid_amount_aed"]) <= 100:
                matched.append({
                    "invoice_id":   ar_row.get("invoice_id"),
                    "customer":     ar_row.get("customer_name"),
                    "ar_amount":    float(ar_row["paid_amount_aed"]),
                    "bank_amount":  float(b_row["amount"]),
                    "bank_ref":     b_row.get("bank_reference", b_row.get("bank_ref", "")),
                    "difference":   round(float(b_row["amount"] - ar_row["paid_amount_aed"]), 2),
                    "match_type":   "Exact" if b_row["amount"] == ar_row["paid_amount_aed"] else "Near Match",
                })
                unmatched_bank = unmatched_bank.drop(idx)
                found = True
                break
        if not found:
            unmatched_ar.append({
                "invoice_id": ar_row.get("invoice_id"),
                "customer":   ar_row.get("customer_name"),
                "amount":     float(ar_row["paid_amount_aed"]),
                "issue":      "Payment in AR but not found in bank statement",
            })

    paid_count = int((ar_df["paid_amount_aed"] > 0).sum())
    return {
        "matched":               matched,
        "matched_count":         len(matched),
        "matched_amount":        sum(m["ar_amount"] for m in matched),
        "unmatched_ar":          unmatched_ar,
        "unmatched_bank":        unmatched_bank.to_dict(orient="records"),
        "reconciliation_rate_pct": round(len(matched) / max(paid_count, 1) * 100, 1),
    }


# ── 6. AI Dunning Insight (portfolio-level) ────────────────────────────────────

@router.post("/ai-dunning-insight", summary="Claude AI analysis of full AR portfolio")
async def ai_dunning_insight(file: UploadFile = File(...)):
    raw = await file.read()
    df  = _read_csv(raw)

    df["outstanding_aed"] = _num(df, "outstanding_aed")
    df["days_overdue"]    = _num(df, "days_overdue")

    total_ar   = float(df["outstanding_aed"].sum())
    overdue_60 = float(df[df["days_overdue"] > 60]["outstanding_aed"].sum())
    critical   = df[df["days_overdue"] > 60][["customer_name", "outstanding_aed", "days_overdue"]].to_dict(orient="records")

    prompt = f"""You are a UAE collections advisor for a Dubai B2B technology company.

AR Portfolio Summary:
- Total Outstanding: AED {total_ar:,.0f}
- Overdue 60+ days: AED {overdue_60:,.0f} ({overdue_60/total_ar*100:.1f}% of total)
- Critical accounts (60+ days): {critical}

Provide:
1. TOP PRIORITY: Which account to call TODAY and exact opening script (2 sentences)
2. CASH FORECAST: Realistic 30-day collection estimate in AED
3. RISK ALERT: Which account is most at risk of becoming bad debt and why
4. STRATEGY: One specific action to improve DSO this month

Keep each point under 3 sentences. AED amounts only. UAE business context."""

    msg = _claude().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )

    return {
        "ai_insight":          msg.content[0].text,
        "total_ar_aed":        total_ar,
        "critical_amount_aed": overdue_60,
        "critical_accounts":   len(critical),
    }


# ── 7. Summary health check ────────────────────────────────────────────────────

@router.get("/summary", summary="AR portfolio health (uses last uploaded data)")
async def ar_summary():
    """Lightweight health check — returns mock summary when no file uploaded."""
    return {
        "status": "AR Enhanced module online",
        "endpoints": [
            "POST /api/ar/invoice-aging",
            "POST /api/ar/payment-prediction",
            "POST /api/ar/dunning-email",
            "POST /api/ar/credit-limits",
            "POST /api/ar/ar-bank-recon",
            "POST /api/ar/ai-dunning-insight",
        ],
        "sample_data": "Upload gnanova_ar_invoices.csv to any endpoint",
    }
