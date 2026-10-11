from __future__ import annotations

from datetime import datetime
from uuid import uuid4
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.history_scope import history_key
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.history_models import AccountBaseline, AccountMonthlyStat, JournalHistory

router = APIRouter()

MAX_ENTRIES_PER_UPLOAD = 20000
RECOMMENDED_MIN_MONTHS = 6
RECOMMENDED_MAX_MONTHS = 24
Z_THRESHOLD = 2.0


class HistoryEntryIn(BaseModel):
    journal_id: str
    posting_date: str
    account: str
    account_name: str | None = None
    amount: float
    user_id: str = ""
    source: str = "ERP"
    description: str | None = None
    entity: str | None = None


class HistoryUploadIn(BaseModel):
    company_id: str
    upload_month: str
    entries: list[HistoryEntryIn] = Field(..., max_length=MAX_ENTRIES_PER_UPLOAD)
    rebuild: bool = True


def get_frequent(df: pd.DataFrame, col: str, min_count: int) -> list[str]:
    if col not in df.columns:
        return []
    counts = df[col].fillna("").astype(str).value_counts()
    return counts[counts >= min_count].index.tolist()


def _line_key(journal_id: str, account: str, amount: float) -> tuple[str, str, float]:
    return (str(journal_id), str(account), round(abs(float(amount or 0)), 2))


def _rebuild_monthly_stats(company_id: str, df: pd.DataFrame, db: Session) -> None:
    db.query(AccountMonthlyStat).filter(AccountMonthlyStat.company_id == company_id).delete()
    names = (
        df.dropna(subset=["account_name"])
        .groupby("account")["account_name"]
        .last()
        .to_dict()
        if "account_name" in df.columns
        else {}
    )
    grouped = df.groupby(["account", "upload_month"])["amount"].agg(
        ["sum", "mean", "std", "min", "max", "count"]
    )
    now = datetime.utcnow()
    db.add_all(
        AccountMonthlyStat(
            company_id=company_id,
            account=str(account),
            account_name=names.get(account),
            month=str(month),
            total_amount=float(row["sum"]),
            avg_amount=float(row["mean"]),
            std_dev=0.0 if pd.isna(row["std"]) else float(row["std"]),
            min_amount=float(row["min"]),
            max_amount=float(row["max"]),
            entry_count=int(row["count"]),
            updated_at=now,
        )
        for (account, month), row in grouped.iterrows()
    )


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
                "account_name": r.account_name,
                "amount": abs(float(r.amount or 0)),
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

    existing_by_account = {
        b.account: b
        for b in db.query(AccountBaseline).filter(AccountBaseline.company_id == company_id).all()
    }
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

        existing = existing_by_account.get(str(account))
        if existing:
            for k, v in baseline.items():
                setattr(existing, k, v)
        else:
            db.add(AccountBaseline(company_id=company_id, account=str(account), **baseline))

    _rebuild_monthly_stats(company_id, df, db)
    db.commit()
    return {
        "months_in_baseline": int(df["upload_month"].nunique()),
        "total_entries_in_baseline": int(len(df)),
        "accounts_covered": int(df["account"].nunique()),
    }


def _existing_line_keys(company_id: str, journal_ids: list[str], db: Session) -> set[tuple[str, str, float]]:
    keys: set[tuple[str, str, float]] = set()
    for i in range(0, len(journal_ids), 500):
        chunk = journal_ids[i:i + 500]
        rows = (
            db.query(JournalHistory.journal_id, JournalHistory.account, JournalHistory.amount)
            .filter(JournalHistory.company_id == company_id, JournalHistory.journal_id.in_(chunk))
            .all()
        )
        keys.update(_line_key(j, a, amt) for j, a, amt in rows)
    return keys


@router.post("/history/upload")
def upload_history(
    body: HistoryUploadIn,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    upload_month = body.upload_month.strip()
    if not upload_month:
        raise HTTPException(status_code=400, detail="upload_month is required.")
    company_id = history_key(db, ctx, body.company_id, "write")

    upload_batch = f"{upload_month}_{str(uuid4())[:8]}"
    saved = 0
    skipped = 0
    seen = _existing_line_keys(company_id, sorted({e.journal_id for e in body.entries}), db)

    for entry in body.entries:
        key = _line_key(entry.journal_id, entry.account, entry.amount)
        if key in seen:
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
                account_name=(entry.account_name or "").strip()[:200] or None,
                amount=float(entry.amount),
                user_id=entry.user_id,
                source=entry.source or "ERP",
                description=entry.description,
                entity=entry.entity,
            )
        )
        seen.add(key)
        saved += 1

    db.commit()
    baseline_meta = rebuild_baseline(company_id, db) if body.rebuild else {}
    return {
        "status": "success",
        "saved": saved,
        "skipped_duplicates": skipped,
        "upload_batch": upload_batch,
        "baseline_updated": body.rebuild,
        **baseline_meta,
    }


def _quality(months_loaded: int) -> str:
    if months_loaded >= 6:
        return "strong"
    if months_loaded >= 3:
        return "building"
    if months_loaded >= 1:
        return "weak"
    return "none"


@router.get("/history/baseline-status")
def baseline_status(
    company_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    requested = company_id.strip()
    key = history_key(db, ctx, company_id, "read")
    baselines = db.query(AccountBaseline).filter(AccountBaseline.company_id == key).all()
    by_month: dict[str, int] = {}
    for (month,) in db.query(JournalHistory.upload_month).filter(JournalHistory.company_id == key).all():
        m = str(month or "unknown")
        by_month[m] = by_month.get(m, 0) + 1
    months_loaded = len(by_month)

    account_summary = [
        {
            "account": b.account,
            "entries": int(b.total_entries or 0),
            "mean": float(b.mean_amount or 0),
            "std": float(b.std_amount or 0),
        }
        for b in baselines[:50]
    ]
    last_updated = max((b.updated_at for b in baselines if b.updated_at), default=None)

    return {
        "company_id": requested,
        "has_baseline": bool(baselines),
        "months_loaded": months_loaded,
        "total_entries": sum(by_month.values()),
        "accounts_covered": len(baselines),
        "quality": _quality(months_loaded),
        "account_summary": account_summary,
        "month_breakdown": [{"month": k, "entries": v} for k, v in sorted(by_month.items())],
        "last_updated": last_updated.isoformat() if last_updated else None,
    }


@router.get("/history/account-baseline")
def account_baseline(
    company_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """Per-account monthly baseline: average monthly total, spread and the 2σ alert threshold."""
    requested = company_id.strip()
    key = history_key(db, ctx, company_id, "read")
    stats = (
        db.query(AccountMonthlyStat)
        .filter(AccountMonthlyStat.company_id == key)
        .order_by(AccountMonthlyStat.account, AccountMonthlyStat.month)
        .all()
    )
    entry_baselines = {
        b.account: b
        for b in db.query(AccountBaseline).filter(AccountBaseline.company_id == key).all()
    }

    by_account: dict[str, list[AccountMonthlyStat]] = {}
    for s in stats:
        by_account.setdefault(s.account, []).append(s)

    accounts: list[dict[str, Any]] = []
    for account, rows in by_account.items():
        totals = np.array([float(r.total_amount or 0) for r in rows])
        avg = float(totals.mean())
        std = float(totals.std(ddof=1)) if len(totals) > 1 else 0.0
        entry_base = entry_baselines.get(account)
        accounts.append({
            "account": account,
            "account_name": next((r.account_name for r in reversed(rows) if r.account_name), None),
            "months": len(rows),
            "entry_count": int(sum(int(r.entry_count or 0) for r in rows)),
            "avg_monthly_total": round(avg, 2),
            "std_monthly_total": round(std, 2),
            "min_monthly_total": round(float(totals.min()), 2),
            "max_monthly_total": round(float(totals.max()), 2),
            "alert_threshold": round(avg + Z_THRESHOLD * std, 2),
            "avg_entry_amount": round(float(entry_base.mean_amount or 0), 2) if entry_base else None,
            "std_entry_amount": round(float(entry_base.std_amount or 0), 2) if entry_base else None,
            "monthly": [
                {"month": r.month, "total": round(float(r.total_amount or 0), 2), "count": int(r.entry_count or 0)}
                for r in rows
            ],
        })
    accounts.sort(key=lambda a: a["avg_monthly_total"], reverse=True)

    months = sorted({s.month for s in stats})
    warnings: list[str] = []
    if months and len(months) < RECOMMENDED_MIN_MONTHS:
        warnings.append(
            f"Only {len(months)} month(s) loaded. Load at least {RECOMMENDED_MIN_MONTHS} months for a reliable baseline."
        )
    if len(months) > RECOMMENDED_MAX_MONTHS:
        warnings.append(
            f"{len(months)} months loaded. Baselines older than {RECOMMENDED_MAX_MONTHS} months may no longer reflect current activity."
        )

    return {
        "company_id": requested,
        "accounts_count": len(accounts),
        "months_count": len(months),
        "months": months,
        "z_threshold": Z_THRESHOLD,
        "quality": _quality(len(months)),
        "warnings": warnings,
        "accounts": accounts,
    }


@router.delete("/history/reset")
def reset_history(
    company_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    key = history_key(db, ctx, company_id, "manage")
    deleted_entries = db.query(JournalHistory).filter(JournalHistory.company_id == key).delete()
    db.query(AccountBaseline).filter(AccountBaseline.company_id == key).delete()
    db.query(AccountMonthlyStat).filter(AccountMonthlyStat.company_id == key).delete()
    db.commit()
    return {"deleted_entries": int(deleted_entries), "status": "reset complete"}
