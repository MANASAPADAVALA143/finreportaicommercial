"""
Core learning engine — builds company-specific baselines from history.
Called after every upload. More uploads = better baselines.
"""
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session
from datetime import datetime
from app.db.models import JournalHistory, CompanyProfile


def recalculate_company_baseline(company_id: str, db: Session) -> None:
    """
    Fetch ALL historical entries for this company and rebuild
    their statistical profile per account. Called after every upload.
    """
    rows = db.query(JournalHistory).filter(JournalHistory.company_id == company_id).all()
    if not rows:
        return

    df = pd.DataFrame([{
        "account": r.account,
        "amount": abs(r.amount),
        "posting_date": r.posting_date,
        "user_id": r.user_id,
        "source": r.source,
    } for r in rows])

    df["posting_date"] = pd.to_datetime(df["posting_date"], errors="coerce")
    df["is_weekend"] = df["posting_date"].dt.dayofweek >= 5
    df["is_month_end"] = df["posting_date"].dt.day >= 28
    df["is_manual"] = df["source"].astype(str).str.lower() == "manual"
    df["month"] = df["posting_date"].dt.strftime("%m")

    for account, group in df.groupby("account"):
        amounts = group["amount"].values

        profile = db.query(CompanyProfile).filter(
            CompanyProfile.company_id == company_id,
            CompanyProfile.account == account,
        ).first()

        if not profile:
            profile = CompanyProfile(company_id=company_id, account=account)
            db.add(profile)

        profile.avg_amount = float(np.mean(amounts))
        profile.std_amount = max(float(np.std(amounts)), 1000.0)  # prevents explosion on small data
        profile.median_amount = float(np.median(amounts))
        profile.p75_amount = float(np.percentile(amounts, 75))
        profile.p90_amount = float(np.percentile(amounts, 90))
        profile.p95_amount = float(np.percentile(amounts, 95))
        profile.min_amount = float(np.min(amounts))
        profile.max_amount = float(np.max(amounts))
        profile.entry_count = len(amounts)
        profile.weekend_rate = float(group["is_weekend"].mean())
        profile.manual_rate = float(group["is_manual"].mean())
        profile.month_end_rate = float(group["is_month_end"].mean())
        top_users = group["user_id"].value_counts().head(5).index.tolist()
        profile.common_users = [str(u) for u in top_users]
        monthly = group.groupby("month")["amount"].mean().round(0).to_dict()
        profile.monthly_avg = {k: float(v) for k, v in monthly.items()}
        profile.last_updated = datetime.utcnow()

    db.commit()
