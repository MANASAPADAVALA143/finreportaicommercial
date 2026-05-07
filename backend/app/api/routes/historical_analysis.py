from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from scipy.stats import chisquare
from sklearn.ensemble import IsolationForest
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.history_models import AccountBaseline, JournalHistory

try:
    import shap  # type: ignore
except Exception:  # noqa: BLE001
    shap = None

router = APIRouter()


class EntryIn(BaseModel):
    journal_id: str
    posting_date: str
    account: str
    amount: float
    user_id: str
    source: str = "ERP"
    description: str | None = None
    entity: str | None = None
    posting_hour: int | None = None


class HistoricalAnalysisIn(BaseModel):
    company_id: str
    entries: list[EntryIn]
    analysis_months: int = 6


def _normalize_rows(entries: list[EntryIn]) -> pd.DataFrame:
    rows = []
    for e in entries:
        dt = pd.to_datetime(e.posting_date, errors="coerce")
        if pd.isna(dt):
            continue
        hr = e.posting_hour if e.posting_hour is not None else (int(dt.hour) if pd.notna(getattr(dt, "hour", np.nan)) else 10)
        rows.append(
            {
                "journal_id": e.journal_id,
                "posting_date": dt,
                "posting_hour": int(hr),
                "posting_dow": int(dt.weekday()),
                "account": e.account,
                "amount": float(e.amount),
                "user_id": e.user_id,
                "source": e.source or "ERP",
                "description": e.description or "",
                "entity": e.entity or "",
            }
        )
    return pd.DataFrame(rows)


def _if_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["amount_log"] = np.log1p(out["amount"].abs())
    out["is_weekend"] = (out["posting_dow"] >= 5).astype(int)
    out["is_afterhours"] = ((out["posting_hour"] < 9) | (out["posting_hour"] > 18)).astype(int)
    out["is_round"] = (out["amount"] % 1000 == 0).astype(int)
    out["is_manual"] = (out["source"].astype(str).str.lower() == "manual").astype(int)
    out["is_monthend"] = (out["posting_date"].dt.day >= 28).astype(int)
    out["account_encoded"] = out["account"].astype(str).map(lambda x: hash(x) % 500)
    out["user_encoded"] = out["user_id"].astype(str).map(lambda x: hash(x) % 200)
    return out


def _normalize_if_score(decision_scores: np.ndarray) -> np.ndarray:
    if len(decision_scores) == 0:
        return np.array([])
    lo = float(np.min(decision_scores))
    hi = float(np.max(decision_scores))
    denom = (hi - lo) if (hi - lo) != 0 else 1.0
    norm = 1 - ((decision_scores - lo) / denom)
    return np.clip(norm * 100, 0, 100)


def _drift_summary(amount_drift: float, volume_drift: float, manual_drift: float) -> str:
    parts = []
    if amount_drift > 30:
        parts.append(f"Amount drift +{amount_drift:.1f}%")
    if volume_drift > 40:
        parts.append(f"Volume drift +{volume_drift:.1f}%")
    if manual_drift > 15:
        parts.append(f"Manual drift +{manual_drift:.1f} pts")
    return " | ".join(parts) if parts else "No material drift detected"


@router.post("/analyze-historical")
def analyze_historical(body: HistoricalAnalysisIn, db: Session = Depends(get_db)):
    company_id = body.company_id.strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required.")
    df = _normalize_rows(body.entries)
    if df.empty:
        raise HTTPException(status_code=400, detail="No valid entries to analyze.")

    baselines = {
        b.account: b
        for b in db.query(AccountBaseline).filter(AccountBaseline.company_id == company_id).all()
    }

    hist_rows = db.query(JournalHistory).filter(JournalHistory.company_id == company_id).all()
    hist_df = pd.DataFrame(
        [
            {
                "journal_id": r.journal_id,
                "posting_date": pd.to_datetime(r.posting_date),
                "posting_hour": int(r.posting_hour or 10),
                "posting_dow": int(r.posting_dow or 0),
                "account": r.account,
                "amount": float(r.amount or 0),
                "user_id": r.user_id or "",
                "source": r.source or "ERP",
                "description": r.description or "",
                "entity": r.entity or "",
                "upload_month": r.upload_month or "",
            }
            for r in hist_rows
        ]
    )

    # Model 4: Benford (population)
    benford_expected = {1: 30.1, 2: 17.6, 3: 12.5, 4: 9.7, 5: 7.9, 6: 6.7, 7: 5.8, 8: 5.1, 9: 4.6}
    leading_digits = []
    for amt in df["amount"].tolist():
        if abs(float(amt)) < 10:
            continue
        ds = "".join(ch for ch in str(abs(float(amt))) if ch.isdigit())
        if ds:
            leading_digits.append(int(ds[0]))
    observed = Counter(leading_digits)
    n = len(leading_digits)
    if n >= 50:
        obs_freq = [observed.get(d, 0) for d in range(1, 10)]
        exp_freq = [benford_expected[d] / 100 * n for d in range(1, 10)]
        chi2, p_value = chisquare(obs_freq, exp_freq)
    else:
        chi2, p_value = 0.0, 1.0
    benford_result = {
        "chi2": round(float(chi2), 3),
        "p_value": round(float(p_value), 4),
        "population_flag": bool(p_value < 0.05),
        "severity": "critical" if p_value < 0.01 else ("high" if p_value < 0.05 else "normal"),
        "observed_distribution": {str(d): observed.get(d, 0) for d in range(1, 10)},
        "expected_distribution": {str(d): round(benford_expected[d], 1) for d in range(1, 10)},
        "interpretation": (
            "Population shows significant Benford deviation — possible manipulation"
            if p_value < 0.05
            else "Population follows expected Benford distribution — normal"
        ),
    }

    # Model 7: Drift (population)
    drift_result: dict[str, Any]
    if not hist_df.empty and hist_df["upload_month"].nunique() >= 3:
        monthly = (
            hist_df.groupby("upload_month")
            .agg(
                avg_amount=("amount", "mean"),
                entry_count=("amount", "count"),
                manual_pct=("source", lambda x: float((x.astype(str).str.lower() == "manual").mean() * 100)),
            )
            .reset_index()
            .sort_values("upload_month")
        )
        hist_part = monthly.iloc[:-1] if len(monthly) > 1 else monthly
        hist_avg = float(hist_part["avg_amount"].mean() or 0)
        curr_avg = float(df["amount"].mean() or 0)
        amount_drift_pct = abs(curr_avg - hist_avg) / max(abs(hist_avg), 1) * 100
        hist_vol = float(hist_part["entry_count"].mean() or 0)
        curr_vol = float(len(df))
        volume_drift_pct = abs(curr_vol - hist_vol) / max(hist_vol, 1) * 100
        hist_manual = float(hist_part["manual_pct"].mean() or 0)
        curr_manual = float((df["source"].astype(str).str.lower() == "manual").mean() * 100)
        manual_drift_pct = abs(curr_manual - hist_manual)
        drift_result = {
            "amount_drift_pct": round(amount_drift_pct, 1),
            "volume_drift_pct": round(volume_drift_pct, 1),
            "manual_drift_pct": round(manual_drift_pct, 1),
            "amount_drift_flag": amount_drift_pct > 30,
            "volume_drift_flag": volume_drift_pct > 40,
            "manual_drift_flag": manual_drift_pct > 15,
            "overall_drift_flag": (amount_drift_pct > 30 or volume_drift_pct > 40 or manual_drift_pct > 15),
            "months_compared": int(monthly["upload_month"].nunique()),
            "summary": _drift_summary(amount_drift_pct, volume_drift_pct, manual_drift_pct),
        }
    else:
        drift_result = {"overall_drift_flag": False, "message": "Need 3+ months of history for drift detection"}

    # Model 3: Isolation Forest
    curr_df = _if_features(df)
    if not hist_df.empty and len(hist_df) >= 100:
        train_df = pd.concat([_if_features(hist_df), curr_df], ignore_index=True)
        training_source = f"history+batch ({len(hist_df)}+{len(curr_df)} rows)"
    else:
        train_df = curr_df.copy()
        training_source = f"batch only ({len(curr_df)} rows)"
    feature_cols = ["amount_log", "is_weekend", "is_afterhours", "is_round", "is_manual", "is_monthend", "account_encoded", "user_encoded"]
    iso = IsolationForest(n_estimators=200, contamination=0.08, max_features=0.8, random_state=42)
    iso.fit(train_df[feature_cols])
    curr_scores = iso.decision_function(curr_df[feature_cols])
    if_risks = _normalize_if_score(curr_scores)
    shap_map: dict[int, list[str]] = {}
    if shap is not None and len(curr_df) > 0:
        try:
            explainer = shap.TreeExplainer(iso)
            sv = explainer.shap_values(curr_df[feature_cols])
            sv_arr = np.array(sv)
            for i in range(len(curr_df)):
                vals = sv_arr[i]
                idxs = np.argsort(np.abs(vals))[::-1][:3]
                shap_map[i] = [feature_cols[j] for j in idxs]
        except Exception:  # noqa: BLE001
            shap_map = {}

    # Per-entry models + composite
    entries_out = []
    for i, row in df.reset_index(drop=True).iterrows():
        baseline = baselines.get(str(row["account"]))

        # Model 1: zscore
        if baseline and int(baseline.total_entries or 0) >= 30:
            mean = float(baseline.mean_amount or 0)
            std = max(float(baseline.std_amount or 1), 1.0)
            source = f"history ({int(baseline.months_loaded or 0)} months)"
        else:
            acct_amounts = df.loc[df["account"] == row["account"], "amount"].astype(float)
            mean = float(acct_amounts.mean() if len(acct_amounts) else 0)
            std = max(float(acct_amounts.std() if len(acct_amounts) else 1), 1.0)
            source = "batch only"
        zscore = abs((float(row["amount"]) - mean) / std)
        zres = {
            "zscore": round(zscore, 2),
            "mean_used": round(mean, 2),
            "std_used": round(std, 2),
            "baseline_source": source,
            "flag": zscore > 3,
            "severity": "critical" if zscore > 5 else ("high" if zscore > 3 else ("watch" if zscore > 2 else "normal")),
        }

        # Model 2: IQR
        if baseline and baseline.p25_amount is not None and baseline.p75_amount is not None:
            p25, p75 = float(baseline.p25_amount), float(baseline.p75_amount)
            iqr_source = "history"
        else:
            acct_amounts = df.loc[df["account"] == row["account"], "amount"].astype(float).values
            p25 = float(np.percentile(acct_amounts, 25)) if len(acct_amounts) else float(row["amount"])
            p75 = float(np.percentile(acct_amounts, 75)) if len(acct_amounts) else float(row["amount"])
            iqr_source = "batch"
        iqr = p75 - p25
        lower_fence = p25 - (1.5 * iqr)
        upper_fence = p75 + (3.0 * iqr)
        amt = float(row["amount"])
        iqr_flag = amt < lower_fence or amt > upper_fence
        iqr_extreme = amt < (p25 - 3 * iqr) or amt > (p75 + 3 * iqr)
        iqr_res = {
            "flag": bool(iqr_flag),
            "extreme": bool(iqr_extreme),
            "lower_fence": round(float(lower_fence), 2),
            "upper_fence": round(float(upper_fence), 2),
            "baseline_source": iqr_source,
        }

        # Model 5: Behaviour
        checks: dict[str, bool] = {}
        if baseline and baseline.normal_users:
            checks["new_user"] = str(row["user_id"]) not in list(baseline.normal_users or [])
        else:
            checks["new_user"] = False
        if baseline and baseline.normal_sources:
            checks["unusual_source"] = str(row["source"]) not in list(baseline.normal_sources or [])
        else:
            checks["unusual_source"] = str(row["source"]).lower() == "manual"
        is_weekend = int(row["posting_dow"]) >= 5
        checks["weekend_anomaly"] = bool(is_weekend and baseline and float(baseline.weekend_pct or 0) < 5.0) if baseline else bool(is_weekend)
        is_afterhours = int(row["posting_hour"]) < 9 or int(row["posting_hour"]) > 18
        checks["afterhours_anomaly"] = bool(is_afterhours and baseline and float(baseline.afterhours_pct or 0) < 10.0) if baseline else bool(is_afterhours)
        is_monthend = pd.Timestamp(row["posting_date"]).day >= 28
        checks["monthend_spike"] = bool(is_monthend and baseline and float(baseline.monthend_pct or 0) < 15.0) if baseline else bool(is_monthend)
        if baseline and baseline.normal_entities:
            checks["unusual_entity"] = bool(row.get("entity") and str(row["entity"]) not in list(baseline.normal_entities or []))
        else:
            checks["unusual_entity"] = False
        is_round = (float(row["amount"]) % 1000) == 0
        checks["round_number"] = bool(is_round and baseline and float(baseline.round_num_pct or 0) < 10.0) if baseline else bool(is_round)
        flags_triggered = [k for k, v in checks.items() if v]
        behaviour_score = min(len(flags_triggered) * 15, 100)
        behaviour_res = {
            "flags": checks,
            "flags_triggered": flags_triggered,
            "behaviour_score": behaviour_score,
            "flag": len(flags_triggered) >= 2,
            "baseline_used": baseline is not None,
        }

        # Model 6: Compliance
        sod_flag = str(row["source"]).lower() == "manual" and str(row["user_id"]).lower() == "new_user"
        duplicates = df[
            (df["account"] == row["account"])
            & (df["amount"] == row["amount"])
            & (df["posting_date"] == row["posting_date"])
            & (df["journal_id"] != row["journal_id"])
        ]
        duplicate_flag = len(duplicates) > 0
        missing_desc = not str(row.get("description") or "").strip()
        no_reference = str(row.get("description") or "").strip().lower() in {"", "nan", "none"}
        if baseline and baseline.p75_amount is not None:
            large_manual = str(row["source"]).lower() == "manual" and float(row["amount"]) > float(baseline.p75_amount) * 2
        else:
            large_manual = str(row["source"]).lower() == "manual" and float(row["amount"]) > 100000
        compliance_score = int(sod_flag) * 40 + int(duplicate_flag) * 35 + int(missing_desc) * 10 + int(no_reference) * 10 + int(large_manual) * 25
        compliance_res = {
            "sod_violation": sod_flag,
            "duplicate_entry": duplicate_flag,
            "missing_desc": missing_desc,
            "no_reference": no_reference,
            "large_manual": large_manual,
            "compliance_score": compliance_score,
            "flag": bool(sod_flag or duplicate_flag or large_manual),
        }

        # Model 3 output
        if_score = float(if_risks[i]) if i < len(if_risks) else 0.0
        isolation_res = {
            "risk_score": round(if_score, 1),
            "decision_score": float(curr_scores[i]) if i < len(curr_scores) else 0.0,
            "flag": if_score > 65,
            "severity": "critical" if if_score > 85 else ("high" if if_score > 65 else ("watch" if if_score > 45 else "normal")),
            "shap_top_features": shap_map.get(i, []),
            "training_source": training_source,
        }

        # composite
        zscore_norm = min((zres["zscore"] / 5) * 100, 100)
        iqr_norm = 100 if iqr_res["extreme"] else (60 if iqr_res["flag"] else 0)
        behaviour_norm = float(behaviour_res["behaviour_score"])
        compliance_norm = float(compliance_res["compliance_score"])
        composite = 0.25 * zscore_norm + 0.10 * iqr_norm + 0.30 * if_score + 0.20 * behaviour_norm + 0.15 * compliance_norm
        risk_level = "CRITICAL" if composite >= 80 else ("HIGH" if composite >= 60 else ("MEDIUM" if composite >= 40 else "LOW"))
        score_breakdown = {
            "z_score_contribution": round(0.25 * zscore_norm, 1),
            "iqr_contribution": round(0.10 * iqr_norm, 1),
            "isolation_forest": round(0.30 * if_score, 1),
            "behaviour_pattern": round(0.20 * behaviour_norm, 1),
            "compliance": round(0.15 * compliance_norm, 1),
        }
        top_reasons = []
        if zres["zscore"] > 3:
            top_reasons.append(f"Z-Score {zres['zscore']}x above account historical mean")
        if "new_user" in behaviour_res["flags_triggered"]:
            top_reasons.append("New user not seen in historical baseline")
        if compliance_res["large_manual"]:
            top_reasons.append("Large manual entry above account baseline range")
        if isolation_res["shap_top_features"]:
            top_reasons.append(f"Top contributors: {', '.join(isolation_res['shap_top_features'])}")
        if len(top_reasons) < 3 and compliance_res["duplicate_entry"]:
            top_reasons.append("Duplicate posting pattern detected in same day/account/amount")

        entries_out.append(
            {
                "journal_id": row["journal_id"],
                "account": row["account"],
                "amount": float(row["amount"]),
                "user_id": row["user_id"],
                "source": row["source"],
                "posting_date": pd.Timestamp(row["posting_date"]).strftime("%Y-%m-%d"),
                "models": {
                    "zscore": zres,
                    "iqr": iqr_res,
                    "isolation": isolation_res,
                    "behaviour": behaviour_res,
                    "compliance": compliance_res,
                },
                "composite": {
                    "composite_score": round(composite, 1),
                    "risk_level": risk_level,
                    "score_breakdown": score_breakdown,
                    "top_reasons": top_reasons[:3],
                },
            }
        )

    entries_out = sorted(entries_out, key=lambda x: x["composite"]["composite_score"], reverse=True)
    flagged_count = sum(1 for e in entries_out if e["composite"]["risk_level"] in {"CRITICAL", "HIGH", "MEDIUM"})
    months_loaded = int(hist_df["upload_month"].nunique()) if not hist_df.empty else 0
    if months_loaded >= 6:
        baseline_quality = "strong"
    elif months_loaded >= 3:
        baseline_quality = "building"
    elif months_loaded >= 1:
        baseline_quality = "weak"
    else:
        baseline_quality = "none"

    return {
        "company_id": company_id,
        "analysis_months": int(body.analysis_months),
        "baseline_quality": baseline_quality,
        "training_source": training_source,
        "population_analysis": {
            "benford": benford_result,
            "drift": drift_result,
            "total_entries_analysed": int(len(df)),
            "flagged_count": int(flagged_count),
            "flag_rate_pct": round((flagged_count / max(len(df), 1)) * 100, 1),
        },
        "entries": entries_out,
    }
