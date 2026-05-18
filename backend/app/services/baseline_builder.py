"""
Baseline builder — computes per-account statistical baselines from historical data
and upserts them into the AccountBaseline table.

Called by POST /api/r2r/upload-history.  Does NOT score entries.
"""
from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.db.models import AccountBaseline

logger = logging.getLogger(__name__)


def build_and_store_baseline(
    client_id: str,
    df: pd.DataFrame,
    db: Session,
) -> dict:
    """
    Compute per-account statistical baselines from historical journal data
    and store / update them in AccountBaseline table.

    df must have columns (case-insensitive flexible matching):
        amount, account, posting_date, user_id

    Returns a summary dict.
    """
    df = df.copy()

    # ── flexible column normalisation ────────────────────────────────────────
    col_lower = {c.lower().strip(): c for c in df.columns}
    rename: dict[str, str] = {}
    for key, target in [
        (["amount", "amt", "value", "debit", "credit"], "amount"),
        (["account", "gl_account", "ledger", "gl"], "account"),
        (["posting_date", "date", "posted_date", "voucher_date", "entry_date"], "posting_date"),
        (["user_id", "user", "posted_by", "preparer", "created_by"], "user_id"),
    ]:
        for k in key:
            if k in col_lower and target not in df.columns:
                rename[col_lower[k]] = target
                break
    if rename:
        df = df.rename(columns=rename)

    required = {"amount", "account", "posting_date", "user_id"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns after normalisation: {missing}")

    df["amount"] = pd.to_numeric(
        df["amount"].astype(str).str.replace(",", "", regex=False), errors="coerce"
    ).fillna(0)
    df["abs_amount"] = df["amount"].abs()

    df["posting_date"] = pd.to_datetime(df["posting_date"], errors="coerce")
    df = df[df["posting_date"].notna()].copy()

    df["is_weekend"] = df["posting_date"].dt.dayofweek >= 5
    months_covered = int(df["posting_date"].dt.to_period("M").nunique())

    results: list[dict] = []

    for account, grp in df.groupby("account"):
        amounts = grp["abs_amount"].dropna()
        if len(amounts) < 5:
            logger.debug("Skipping account %r — only %d rows", account, len(amounts))
            continue

        q1 = float(amounts.quantile(0.25))
        q3 = float(amounts.quantile(0.75))
        iqr = q3 - q1

        known_users = sorted(set(str(u) for u in grp["user_id"].dropna() if str(u).strip()))

        baseline_data = {
            "client_id":      client_id,
            "account":        str(account),
            "mean_amount":    float(amounts.mean()),
            "std_amount":     float(amounts.std()) if len(amounts) > 1 else 0.0,
            "median_amount":  float(amounts.median()),
            "p10_amount":     float(amounts.quantile(0.10)),
            "p90_amount":     float(amounts.quantile(0.90)),
            "lower_fence":    float(q1 - 1.5 * iqr),
            "upper_fence":    float(q3 + 3.0 * iqr),
            "weekend_rate":   float(grp["is_weekend"].mean()),
            "known_users":    known_users,
            "entry_count":    int(len(grp)),
            "months_covered": months_covered,
            "updated_at":     datetime.utcnow(),
        }

        existing = (
            db.query(AccountBaseline)
            .filter_by(client_id=client_id, account=str(account))
            .first()
        )
        if existing:
            for k, v in baseline_data.items():
                setattr(existing, k, v)
        else:
            db.add(AccountBaseline(**baseline_data))

        results.append(baseline_data)

    db.commit()
    logger.info(
        "build_and_store_baseline: client=%s accounts=%d months=%d total_rows=%d",
        client_id,
        len(results),
        months_covered,
        len(df),
    )

    return {
        "client_id":           client_id,
        "accounts_baselined":  len(results),
        "months_covered":      months_covered,
        "total_rows":          len(df),
        "accounts":            [r["account"] for r in results],
        "weekend_rates":       {r["account"]: round(r["weekend_rate"], 3) for r in results},
    }
