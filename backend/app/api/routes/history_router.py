from __future__ import annotations

from datetime import datetime
from uuid import uuid4
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.history_models import AccountBaseline, JournalHistory

router = APIRouter()


class HistoryEntryIn(BaseModel):
    journal_id: str
    posting_date: str
    account: str
    amount: float
    user_id: str
    source: str = "ERP"
    description: str | None = None
    entity: str | None = None


class HistoryUploadIn(BaseModel):
    company_id: str
    upload_month: str
    entries: list[HistoryEntryIn]


def get_frequent(df: pd.DataFrame, col: str, min_count: int) -> list[str]:
    if col not in df.columns:
        return []
    counts = df[col].fillna("").astype(str).value_counts()
    return counts[counts >= min_count].index.tolist()


def rebuild_baseline(company_id: str, db: Session) -> dict[str, int]:
    rows = db.query(JournalHistory).filter(JournalHistory.company_id == company_id).all()
    if not rows:
        return {"months_in_baseline": 0, "total_entries_in_baseline": 0, "accounts_covered": 0}

    data = []
    for r in rows:
        data.append(
            {
                "company_id": r.company_id,
                "upload_month": r.upload_month,
                "account": r.account,
                "amount": float(r.amount or 0),
                "user_id": r.user_id or "",
                "source": r.source or "",
                "entity": r.entity or "",
                "posting_hour": int(r.posting_hour or 10),
                "posting_dow": int(r.posting_dow or 0),
                "posting_date": pd.to_datetime(r.posting_date, errors="coerce"),
            }
        )
    df = pd.DataFrame(data)
    if df.empty:
        return {"months_in_baseline": 0, "total_entries_in_baseline": 0, "accounts_covered": 0}

    for account, df_account in df.groupby("account"):
        amounts = df_account["amount"].astype(float).values
        if len(amounts) == 0:
            continue

        months_loaded = int(df_account["upload_month"].nunique() or 1)
        baseline = {
            "mean_amount": float(np.mean(amounts)),
            "std_amount": float(np.std(amounts)),
            "median_amount": float(np.median(amounts)),
            "p25_amount": float(np.percentile(amounts, 25)),
            "p75_amount": float(np.percentile(amounts, 75)),
            "min_amount": float(np.min(amounts)),
            "max_amount": float(np.max(amounts)),
            "total_entries": int(len(amounts)),
            "months_loaded": months_loaded,
            "avg_entries_month": float(len(amounts) / max(months_loaded, 1)),
            "normal_users": get_frequent(df_account, "user_id", min_count=3),
            "normal_sources": get_frequent(df_account, "source", min_count=5),
            "normal_entities": get_frequent(df_account, "entity", min_count=3),
            "weekend_pct": float((df_account["posting_dow"] >= 5).mean() * 100),
            "afterhours_pct": float((((df_account["posting_hour"] < 9) | (df_account["posting_hour"] > 18)).mean()) * 100),
            "monthend_pct": float((df_account["posting_date"].dt.day >= 28).mean() * 100),
            "manual_pct": float((df_account["source"].astype(str).str.lower() == "manual").mean() * 100),
            "round_num_pct": float(((df_account["amount"] % 1000 == 0).mean()) * 100),
            "updated_at": datetime.utcnow(),
        }

        existing = (
            db.query(AccountBaseline)
            .filter(AccountBaseline.company_id == company_id, AccountBaseline.account == str(account))
            .first()
        )
        if existing:
            for k, v in baseline.items():
                setattr(existing, k, v)
        else:
            db.add(AccountBaseline(company_id=company_id, account=str(account), **baseline))

    db.commit()
    return {
        "months_in_baseline": int(df["upload_month"].nunique()),
        "total_entries_in_baseline": int(len(df)),
        "accounts_covered": int(df["account"].nunique()),
    }


@router.post("/history/upload")
def upload_history(body: HistoryUploadIn, db: Session = Depends(get_db)):
    company_id = body.company_id.strip()
    upload_month = body.upload_month.strip()
    if not company_id or not upload_month:
        raise HTTPException(status_code=400, detail="company_id and upload_month are required.")

    upload_batch = f"{company_id}_{upload_month}_{str(uuid4())[:8]}"
    saved = 0
    skipped = 0

    for entry in body.entries:
        if (
            db.query(JournalHistory.id)
            .filter(JournalHistory.company_id == company_id, JournalHistory.journal_id == entry.journal_id)
            .first()
            is not None
        ):
            skipped += 1
            continue

        dt = pd.to_datetime(entry.posting_date, errors="coerce")
        if pd.isna(dt):
            raise HTTPException(status_code=400, detail=f"Invalid posting_date for journal_id={entry.journal_id}")
        posting_hour = int(getattr(dt, "hour", 10) if pd.notna(getattr(dt, "hour", np.nan)) else 10)
        posting_dow = int(dt.weekday())

        # ✅ FIX: derive upload_month from each row's actual posting_date
        # so a 12-month file produces 12 distinct month labels instead of 1.
        # The upload_month request field is kept as a fallback for rows with bad dates.
        try:
            row_month = dt.strftime("%Y-%m")
        except Exception:
            row_month = upload_month  # fallback

        db.add(
            JournalHistory(
                company_id=company_id,
                upload_month=row_month,
                upload_batch=upload_batch,
                journal_id=entry.journal_id,
                posting_date=dt.date(),
                posting_hour=posting_hour,
                posting_dow=posting_dow,
                account=entry.account,
                amount=float(entry.amount),
                user_id=entry.user_id,
                source=entry.source or "ERP",
                description=entry.description,
                entity=entry.entity,
            )
        )
        saved += 1

    db.commit()
    baseline_meta = rebuild_baseline(company_id, db)
    return {
        "status": "success",
        "saved": saved,
        "skipped_duplicates": skipped,
        "upload_batch": upload_batch,
        "baseline_updated": True,
        **baseline_meta,
    }


@router.get("/history/baseline-status")
def baseline_status(company_id: str = Query(...), db: Session = Depends(get_db)):
    baselines = db.query(AccountBaseline).filter(AccountBaseline.company_id == company_id).all()
    entries = db.query(JournalHistory).filter(JournalHistory.company_id == company_id).all()
    months_loaded = len({e.upload_month for e in entries})
    total_entries = len(entries)
    accounts_covered = len(baselines)
    if months_loaded >= 6:
        quality = "strong"
    elif months_loaded >= 3:
        quality = "building"
    elif months_loaded >= 1:
        quality = "weak"
    else:
        quality = "none"

    account_summary = [
        {
            "account": b.account,
            "entries": int(b.total_entries or 0),
            "mean": float(b.mean_amount or 0),
            "std": float(b.std_amount or 0),
        }
        for b in baselines[:50]
    ]
    last_updated = None
    if baselines:
        last_updated = max((b.updated_at for b in baselines if b.updated_at), default=None)
    month_breakdown: list[dict[str, Any]] = []
    if entries:
        by_month: dict[str, int] = {}
        for e in entries:
            m = str(e.upload_month or "unknown")
            by_month[m] = by_month.get(m, 0) + 1
        month_breakdown = [{"month": k, "entries": v} for k, v in sorted(by_month.items())]

    return {
        "company_id": company_id,
        "has_baseline": bool(baselines),
        "months_loaded": months_loaded,
        "total_entries": total_entries,
        "accounts_covered": accounts_covered,
        "quality": quality,
        "account_summary": account_summary,
        "month_breakdown": month_breakdown,
        "last_updated": last_updated.isoformat() if last_updated else None,
    }


@router.delete("/history/reset")
def reset_history(company_id: str = Query(...), db: Session = Depends(get_db)):
    deleted_entries = db.query(JournalHistory).filter(JournalHistory.company_id == company_id).delete()
    db.query(AccountBaseline).filter(AccountBaseline.company_id == company_id).delete()
    db.commit()
    return {"deleted_entries": int(deleted_entries), "status": "reset complete"}
