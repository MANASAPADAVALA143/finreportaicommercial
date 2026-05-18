from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.history_models import JENarrative, JournalHistory
from app.services.feedback_learner import FeedbackLearner
from app.services.je_anomaly_engine import JEAnomalyEngine
from app.services.je_data_adapter import JEDataAdapter, JEDataValidator
from app.services.je_narrative import JENarrativeService
from app.utils.plain_english import build_plain_english_summary

log = logging.getLogger(__name__)

router = APIRouter()

_engine    = JEAnomalyEngine()
_adapter   = JEDataAdapter()
_validator = JEDataValidator()
_feedback  = FeedbackLearner()
_narrative = JENarrativeService()

# Narrative cache TTL in hours — re-generate after this many hours
_NARRATIVE_TTL_HOURS = 24
# Risk levels that get LLM narratives
_NARRATIVE_RISK_LEVELS = {"CRITICAL", "HIGH"}
# Max entries sent to Claude per analysis run
_NARRATIVE_MAX_ENTRIES = 20


def _np_safe(obj: Any) -> Any:
    """Recursively convert numpy scalars → Python natives so FastAPI can serialise."""
    if isinstance(obj, dict):
        return {k: _np_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_np_safe(v) for v in obj]
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


# ── Pydantic input models ─────────────────────────────────────────────────────

class FeedbackItemIn(BaseModel):
    journal_id:    str
    auditor_label: str   # TRUE_POSITIVE | FALSE_POSITIVE | MISSED_ANOMALY | IGNORE
    layer_scores:  dict[str, float] = {}
    risk_level:    str | None = None
    notes:         str | None = None


class FeedbackIn(BaseModel):
    company_id: str
    feedback:   list[FeedbackItemIn]


class EntryIn(BaseModel):
    journal_id:   str
    posting_date: str
    account:      str
    amount:       float
    user_id:      str
    source:       str        = "ERP"
    description:  str | None = None
    entity:       str | None = None
    posting_hour: int | None = None


class HistoricalAnalysisIn(BaseModel):
    company_id:      str
    entries:         list[EntryIn]
    analysis_months: int = 6


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_date(raw: str) -> "pd.Timestamp | pd.NaT":
    """Parse a date string, including Excel serial numbers (e.g. '45000')."""
    dt = pd.to_datetime(raw, errors="coerce", dayfirst=False)
    if pd.isna(dt):
        try:
            serial = float(raw)
            if 30000 < serial < 60000:
                import datetime as _dt
                dt = pd.Timestamp(_dt.datetime(1899, 12, 30) + _dt.timedelta(days=serial))
        except (ValueError, TypeError):
            pass
    return dt


def _entries_to_df(entries: list[EntryIn]) -> pd.DataFrame:
    """Convert Pydantic EntryIn list → canonical DataFrame for JEAnomalyEngine."""
    rows = []
    skipped = 0
    for e in entries:
        dt = _parse_date(str(e.posting_date).strip())
        if pd.isna(dt):
            skipped += 1
            log.warning(
                "[HISTORICAL] Skipping journal_id=%r — unparseable date: %r",
                e.journal_id, e.posting_date,
            )
            continue
        # BUG 3 FIX — posting_hour=0 when date string has no time component
        # BEFORE: int(dt.hour) on "2024-01-15" → 0 → flagged as after-hours (0 < 9)
        # AFTER:  check for time in raw string; if absent, use 0 as sentinel
        #         (engine timing_score now treats hr==0 as "unknown" and skips timing flag)
        raw_date_str = str(e.posting_date).strip()
        has_time = len(raw_date_str) > 10 and (":" in raw_date_str[10:] or "T" in raw_date_str)
        if e.posting_hour is not None:
            hr = int(e.posting_hour)
        elif has_time:
            hr = int(dt.hour)   # real time component present
        else:
            hr = 0              # sentinel: date-only, timing unknown → engine will skip flag
        rows.append({
            "journal_id":   e.journal_id,
            "posting_date": dt,
            "posting_hour": int(hr),
            "posting_dow":  int(dt.weekday()),
            "account":      e.account,
            "amount":       abs(float(e.amount)),
            "user_id":      e.user_id,
            "source":       e.source or "ERP",
            "description":  e.description or "",
            "entity":       e.entity or "",
        })
    log.info(
        "[HISTORICAL] entries_to_df: received=%d valid=%d skipped_bad_date=%d",
        len(entries), len(rows), skipped,
    )
    return pd.DataFrame(rows)


def _hist_to_df(hist_rows: list) -> pd.DataFrame:
    """ORM JournalHistory list → canonical DataFrame."""
    if not hist_rows:
        return pd.DataFrame()
    data = []
    for r in hist_rows:
        dt = pd.to_datetime(r.posting_date, errors="coerce")
        if pd.isna(dt):
            continue
        data.append({
            "journal_id":   str(r.journal_id or ""),
            "posting_date": dt,
            "posting_hour": int(r.posting_hour or 10),
            "posting_dow":  int(r.posting_dow  or 0),
            "account":      str(r.account or ""),
            "amount":       abs(float(r.amount or 0)),
            "user_id":      str(r.user_id or ""),
            "source":       str(r.source or "ERP"),
            "description":  str(r.description or ""),
            "entity":       str(r.entity or ""),
            "upload_month": str(r.upload_month or ""),
        })
    return pd.DataFrame(data)


def _drift_summary(
    volume_drift_signed: float,
    amount_drift: float,
    manual_drift: float,
) -> str:
    """Build a human-readable drift summary using SIGNED volume drift."""
    parts = []
    if amount_drift > 30:
        parts.append(f"Amount drift +{amount_drift:.1f}%")
    # Volume drift: show signed, flag only outside ±20%
    if abs(volume_drift_signed) > 20:
        sign = "+" if volume_drift_signed > 0 else ""
        direction = "above" if volume_drift_signed > 0 else "below"
        parts.append(
            f"Volume drift {sign}{volume_drift_signed:.1f}% {direction} baseline avg"
        )
    if manual_drift > 15:
        parts.append(f"Manual drift +{manual_drift:.1f} pts")
    return " | ".join(parts) if parts else "No material drift detected"


# ── Narrative cache helpers ───────────────────────────────────────────────────

def _load_cached_narratives(
    company_id: str,
    journal_ids: list[str],
    db: Session,
) -> dict[str, str]:
    """Return cached narratives that haven't expired yet."""
    if not journal_ids:
        return {}
    cutoff = datetime.now(tz=timezone.utc).replace(tzinfo=None)
    rows = (
        db.query(JENarrative)
        .filter(
            JENarrative.company_id == company_id,
            JENarrative.journal_id.in_(journal_ids),
        )
        .all()
    )
    result: dict[str, str] = {}
    for row in rows:
        age_hours = (cutoff - (row.created_at or cutoff)).total_seconds() / 3600
        if age_hours <= _NARRATIVE_TTL_HOURS:
            result[row.journal_id] = row.narrative
    return result


def _save_narratives(
    company_id: str,
    narratives: dict[str, str],
    entries_out: list[dict[str, Any]],
    db: Session,
) -> None:
    """Upsert freshly-generated narratives into the cache table."""
    if not narratives:
        return
    # Build a quick lookup of composite metadata from entries_out
    meta: dict[str, dict[str, Any]] = {}
    for e in entries_out:
        jid  = e.get("journal_id", "")
        comp = e.get("composite", {})
        meta[jid] = {
            "risk_level":      comp.get("risk_level"),
            "composite_score": comp.get("composite_score"),
        }

    for jid, text in narratives.items():
        existing = (
            db.query(JENarrative)
            .filter(JENarrative.company_id == company_id, JENarrative.journal_id == jid)
            .first()
        )
        m = meta.get(jid, {})
        if existing:
            existing.narrative       = text
            existing.risk_level      = m.get("risk_level")
            existing.composite_score = m.get("composite_score")
            existing.created_at      = datetime.utcnow()
        else:
            db.add(JENarrative(
                company_id      = company_id,
                journal_id      = jid,
                risk_level      = m.get("risk_level"),
                composite_score = m.get("composite_score"),
                narrative       = text,
                model_used      = "claude-sonnet-4-5",
                created_at      = datetime.utcnow(),
            ))
    try:
        db.commit()
    except Exception as exc:
        log.warning("[NARRATIVE] Failed to save narrative cache: %s", exc)
        db.rollback()


# ── Main endpoint (async for narrative await) ─────────────────────────────────

@router.post("/analyze-historical")
async def analyze_historical(body: HistoricalAnalysisIn, db: Session = Depends(get_db)):
    company_id = body.company_id.strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required.")

    log.info(
        "[HISTORICAL] analyze_historical: company_id=%r entries=%d",
        company_id, len(body.entries),
    )
    if body.entries:
        s = body.entries[0]
        log.debug(
            "[HISTORICAL] First entry: journal_id=%r posting_date=%r account=%r amount=%s",
            s.journal_id, s.posting_date, s.account, s.amount,
        )

    # ── Build DataFrames ──────────────────────────────────────────────────────
    df = _entries_to_df(body.entries)
    if df.empty:
        detail = (
            f"No valid entries to analyze. Received {len(body.entries)} row(s) but all were skipped. "
            "Common causes: (1) date format not recognised — ensure posting_date is YYYY-MM-DD "
            "or DD/MM/YYYY; (2) column names don't match expected fields. "
            "Check the backend console for per-row debug output."
        )
        raise HTTPException(status_code=400, detail=detail)

    hist_rows = (
        db.query(JournalHistory)
        .filter(JournalHistory.company_id == company_id)
        .all()
    )
    hist_df = _hist_to_df(hist_rows)

    # ── Validate ──────────────────────────────────────────────────────────────
    validation = _validator.validate(df, hist_df)
    if not validation["ok"]:
        raise HTTPException(status_code=400, detail=" | ".join(validation["errors"]))

    # ── Load per-client weights and run 5-layer engine ────────────────────────
    client_weights = _feedback.load_weights(company_id, db)
    result = _engine.analyze(df, hist_df, client_weights=client_weights if client_weights else None)
    entries_out: list[dict[str, Any]] = result["entries"]
    batch_stats: dict[str, Any]       = result["batch_stats"]

    # ── Augment entries with plain-English summary ────────────────────────────
    n_hist  = len(hist_df)
    n_batch = len(df)
    for entry in entries_out:
        ld   = entry.get("layer_detail", {})
        stat = ld.get("statistical", {})
        beh  = ld.get("behavioral", {})
        comp = entry.get("composite", {})

        flags: list[str] = []
        if beh.get("new_actor", 0) >= 40:
            flags.append("new_user")
        if beh.get("timing", 0) >= 40:
            flags.append("afterhours_anomaly")
        if beh.get("monthend", 0) >= 40:
            flags.append("monthend_spike")
        pat = ld.get("pattern", {})
        if pat.get("round_number", 0) >= 45:
            flags.append("round_number")
        if pat.get("duplicate", 0) >= 80:
            flags.append("duplicate_entry")

        plain = build_plain_english_summary(
            journal_id      = entry["journal_id"],
            account         = entry["account"],
            amount          = entry["amount"],
            risk_level      = comp.get("risk_level", "LOW"),
            composite_score = comp.get("composite_score", 0.0),
            zscore_value    = float(stat.get("ctx_zscore", 0.0)),
            zscore_source   = "multi-context" if n_hist > 0 else "batch",
            isolation_score = float(ld.get("ml", {}).get("if_score", 0.0)),
            iqr_upper       = 0.0,
            iqr_lower       = 0.0,
            behaviour_flags = flags,
            compliance_score= int(pat.get("duplicate", 0) > 50) * 35,
            shap_top_features=[],
            n_history       = n_hist,
            n_batch         = n_batch,
        )
        entry["plain"] = plain

        # Compatibility shim
        entry["composite"]["score_breakdown"] = {
            "statistical":  comp.get("layer_scores", {}).get("statistical", 0),
            "ml":           comp.get("layer_scores", {}).get("ml", 0),
            "pattern":      comp.get("layer_scores", {}).get("pattern", 0),
            "behavioral":   comp.get("layer_scores", {}).get("behavioral", 0),
        }

        # Initialise narrative slot (filled below)
        entry["audit_narrative"] = None

    # ── LLM Narrative generation for CRITICAL + HIGH entries ──────────────────
    flagged_entries = [
        e for e in entries_out
        if e.get("composite", {}).get("risk_level") in _NARRATIVE_RISK_LEVELS
    ]
    # Sort by composite_score descending so top-20 are the most suspicious
    flagged_entries.sort(
        key=lambda e: e.get("composite", {}).get("composite_score", 0),
        reverse=True,
    )

    if flagged_entries:
        flagged_jids = [e["journal_id"] for e in flagged_entries]

        # Load what's already cached
        cached = _load_cached_narratives(company_id, flagged_jids, db)

        # Identify which need fresh generation
        need_generation = [
            e for e in flagged_entries
            if e["journal_id"] not in cached
        ][:_NARRATIVE_MAX_ENTRIES]

        if need_generation:
            # Build inputs for generate_batch
            batch_input = [
                {
                    "entry": {
                        "journal_id":   e["journal_id"],
                        "account":      e["account"],
                        "amount":       e["amount"],
                        "user_id":      e.get("user_id", ""),
                        "source":       e.get("source", "ERP"),
                        "posting_date": e.get("posting_date", ""),
                        "description":  e.get("description", ""),
                        "entity":       e.get("entity", ""),
                    },
                    "scores": {
                        "risk_level":      e["composite"].get("risk_level"),
                        "composite_score": e["composite"].get("composite_score", 0),
                        "top_reasons":     e["composite"].get("top_reasons", []),
                        "layer_scores":    e["composite"].get("layer_scores", {}),
                    },
                }
                for e in need_generation
            ]

            try:
                fresh = await _narrative.generate_batch(
                    batch_input, max_entries=_NARRATIVE_MAX_ENTRIES
                )
                log.info(
                    "[NARRATIVE] Generated %d new narratives for company=%r",
                    len(fresh), company_id,
                )
                # Cache them
                _save_narratives(company_id, fresh, entries_out, db)
                cached.update(fresh)
            except Exception as exc:
                log.warning("[NARRATIVE] Batch generation failed: %s", exc)

        # Merge narratives back into entries
        narrative_lookup = cached
        for entry in entries_out:
            jid = entry["journal_id"]
            if jid in narrative_lookup:
                entry["audit_narrative"] = narrative_lookup[jid]

    # ── Drift analysis (population level) ─────────────────────────────────────
    # BEFORE: used hist_part["entry_count"].mean() → divided by a per-group mean
    #         which could equal analysis_months (6) instead of actual baseline months (12),
    #         producing +50% drift when true drift is ~0%.
    # AFTER:  baseline_monthly_avg = total_baseline_entries / distinct_months_in_baseline
    #         volume_drift = SIGNED (positive = above baseline, negative = below)
    #         alert threshold: ±20% (not 40%); within ±10% = no alert shown
    drift_result: dict[str, Any]
    if not hist_df.empty and "upload_month" in hist_df.columns and hist_df["upload_month"].nunique() >= 3:
        # ── Amount & manual drift: use monthly grouped data (unchanged logic) ──
        monthly = (
            hist_df.groupby("upload_month")
            .agg(
                avg_amount = ("amount", "mean"),
                manual_pct = ("source", lambda x: float(
                    (x.astype(str).str.lower() == "manual").mean() * 100
                )),
            )
            .reset_index()
            .sort_values("upload_month")
        )
        hist_avg     = float(monthly["avg_amount"].mean() or 0)
        curr_avg     = float(df["amount"].mean() or 0)
        amount_drift = abs(curr_avg - hist_avg) / max(abs(hist_avg), 1) * 100
        hist_manual  = float(monthly["manual_pct"].mean() or 0)
        curr_manual  = float((df["source"].astype(str).str.lower() == "manual").mean() * 100)
        manual_drift = abs(curr_manual - hist_manual)

        # ── Volume drift: CORRECT formula ────────────────────────────────────
        # Count distinct YYYY-MM labels actually present in baseline
        n_baseline_months   = int(hist_df["upload_month"].nunique())
        baseline_monthly_avg = len(hist_df) / max(n_baseline_months, 1)
        curr_vol             = float(len(df))
        # Signed: positive = current batch larger than baseline avg (potentially inflated)
        #         negative = current batch smaller (normal seasonal variation)
        volume_drift_signed  = (curr_vol - baseline_monthly_avg) / max(baseline_monthly_avg, 1) * 100

        # Alert only when outside ±20%; within ±10% is silent
        volume_drift_flag = abs(volume_drift_signed) > 20

        log.info(
            "[DRIFT] baseline_entries=%d n_months=%d baseline_avg=%.1f "
            "current_entries=%d volume_drift=%.1f%%",
            len(hist_df), n_baseline_months, baseline_monthly_avg,
            int(curr_vol), volume_drift_signed,
        )

        drift_result = {
            "amount_drift_pct":       round(amount_drift, 1),
            # Signed volume drift (positive = above baseline avg, negative = below)
            "volume_drift_pct":       round(volume_drift_signed, 1),
            "volume_drift_direction": "above" if volume_drift_signed > 0 else "below",
            "volume_baseline_avg":    round(baseline_monthly_avg, 1),
            "volume_current":         int(curr_vol),
            "manual_drift_pct":       round(manual_drift, 1),
            "amount_drift_flag":      amount_drift > 30,
            "volume_drift_flag":      volume_drift_flag,
            "manual_drift_flag":      manual_drift > 15,
            "overall_drift_flag":     (
                amount_drift > 30 or volume_drift_flag or manual_drift > 15
            ),
            "months_compared":        n_baseline_months,
            "summary":                _drift_summary(volume_drift_signed, amount_drift, manual_drift),
        }
    else:
        drift_result = {
            "overall_drift_flag": False,
            "message": "Need 3+ months of history for drift detection",
        }

    # ── Baseline quality ──────────────────────────────────────────────────────
    months_loaded = (
        int(hist_df["upload_month"].nunique())
        if not hist_df.empty and "upload_month" in hist_df.columns
        else 0
    )
    if months_loaded >= 6:
        baseline_quality = "strong"
    elif months_loaded >= 3:
        baseline_quality = "building"
    elif months_loaded >= 1:
        baseline_quality = "weak"
    else:
        baseline_quality = "none"

    flagged_count = batch_stats["critical"] + batch_stats["high"] + batch_stats["medium"]

    payload = _np_safe({
        "company_id":       company_id,
        "analysis_months":  int(body.analysis_months),
        "baseline_quality": baseline_quality,
        "training_source":  (
            f"history ({n_hist} rows) + batch ({n_batch} rows)"
            if n_hist > 0 else f"batch only ({n_batch} rows)"
        ),
        "validation":       validation,
        "population_analysis": {
            "benford":                batch_stats["benford"],
            "drift":                  drift_result,
            "total_entries_analysed": int(len(df)),
            "flagged_count":          int(flagged_count),
            "flag_rate_pct":          round((flagged_count / max(len(df), 1)) * 100, 1),
        },
        "batch_stats": {
            "total":    batch_stats["total"],
            "critical": batch_stats["critical"],
            "high":     batch_stats["high"],
            "medium":   batch_stats["medium"],
            "low":      batch_stats["low"],
        },
        "entries":      entries_out,
        "layer_weights": client_weights,
    })
    return JSONResponse(content=payload)


# ── Standalone narrative endpoint ─────────────────────────────────────────────

class NarrativeIn(BaseModel):
    company_id:      str
    journal_id:      str
    account:         str
    amount:          float
    user_id:         str
    source:          str = "ERP"
    posting_date:    str = ""
    description:     str | None = None
    entity:          str | None = None
    risk_level:      str = "HIGH"
    composite_score: float = 0.0
    top_reasons:     list[str] = []
    layer_scores:    dict[str, float] = {}


@router.post("/narrative/{journal_id}")
async def get_narrative(journal_id: str, body: NarrativeIn, db: Session = Depends(get_db)):
    """
    Generate (or return cached) an LLM audit narrative for a single entry.

    Useful for on-demand regeneration from the frontend detail panel.
    """
    company_id = body.company_id.strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required.")

    # Check cache first
    cached = _load_cached_narratives(company_id, [journal_id], db)
    if cached.get(journal_id):
        return {"journal_id": journal_id, "narrative": cached[journal_id], "cached": True}

    entry = {
        "journal_id":   journal_id,
        "account":      body.account,
        "amount":       body.amount,
        "user_id":      body.user_id,
        "source":       body.source,
        "posting_date": body.posting_date,
        "description":  body.description or "",
        "entity":       body.entity or "",
    }
    scores = {
        "risk_level":      body.risk_level,
        "composite_score": body.composite_score,
        "top_reasons":     body.top_reasons,
        "layer_scores":    body.layer_scores,
    }

    try:
        text = await _narrative.generate_narrative(entry, scores)
    except Exception as exc:
        log.warning("[NARRATIVE] Standalone generation failed for %s: %s", journal_id, exc)
        raise HTTPException(status_code=500, detail=f"Narrative generation failed: {exc}")

    # Cache it
    _save_narratives(
        company_id,
        {journal_id: text},
        [{"journal_id": journal_id, "composite": {"risk_level": body.risk_level, "composite_score": body.composite_score}}],
        db,
    )

    return {"journal_id": journal_id, "narrative": text, "cached": False}


# ── Auditor feedback endpoint ─────────────────────────────────────────────────

@router.post("/feedback")
def submit_auditor_feedback(body: FeedbackIn, db: Session = Depends(get_db)):
    """
    Accept auditor accept/reject decisions and retune per-client layer weights.
    """
    company_id = body.company_id.strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required.")
    if not body.feedback:
        raise HTTPException(status_code=400, detail="feedback list is empty.")

    feedback_dicts = [f.model_dump() for f in body.feedback]

    update_result = _feedback.process_feedback(company_id, feedback_dicts, db)
    pr = _feedback.precision_recall(feedback_dicts)

    log.info(
        "[FEEDBACK] company_id=%s processed=%d skipped=%d precision=%s recall=%s",
        company_id,
        update_result["processed"],
        update_result["skipped"],
        pr.get("precision_pct"),
        pr.get("recall_pct"),
    )

    return {
        "company_id":      company_id,
        "processed":       update_result["processed"],
        "skipped":         update_result["skipped"],
        "new_weights":     update_result["new_weights"],
        "weight_delta":    update_result["weight_delta"],
        "precision_recall": pr,
    }


@router.get("/feedback/weights/{company_id}")
def get_client_weights(company_id: str, db: Session = Depends(get_db)):
    """Return the current ensemble layer weights for a client."""
    weights = _feedback.load_weights(company_id.strip(), db)
    return {
        "company_id": company_id,
        "layer_weights": weights,
    }
