"""
R2R Historical Baseline
=======================
Syncs posted accounting JEs into a company-specific baseline.
R2R ML models read from this baseline for anomaly detection.

company_id + country → completely separate baseline
e.g. "demo" + "UAE"   → UAE baseline
     "demo" + "India" → India baseline (INR)
"""
from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def add_to_company_baseline(
    company_id: str,
    journal_entries: List[Dict[str, Any]],
    country: str = "UAE",
    db: Optional[Session] = None,
) -> int:
    """
    Add posted JEs to company's R2R historical baseline.
    Idempotent — skips je_id already present.
    Returns count of newly added entries.
    """
    if not db or not journal_entries:
        return 0

    from app.models.r2r_learning import R2RHistoricalEntry

    added = 0
    existing_ids = set()
    try:
        rows = db.query(R2RHistoricalEntry.je_id).filter_by(
            company_id=company_id, country=country
        ).all()
        existing_ids = {r.je_id for r in rows if r.je_id}
    except Exception:
        pass

    for je in journal_entries:
        try:
            je_id = str(je.get("je_id") or "")
            if je_id and je_id in existing_ids:
                continue

            amount = float(je.get("debit") or je.get("credit") or je.get("amount") or 0)
            date_str = str(je.get("date") or "")
            day_of_week: Optional[int] = None
            try:
                day_of_week = datetime.fromisoformat(date_str[:10]).weekday()
            except Exception:
                pass

            entry = R2RHistoricalEntry(
                company_id=company_id,
                country=country,
                je_id=je_id or None,
                je_number=str(je.get("je_number") or "")[:64],
                date=date_str[:20],
                period=str(je.get("period") or "")[:7],
                description=str(je.get("description") or "")[:500],
                account_code=str(je.get("account_code") or "")[:20],
                account_name=str(je.get("account_name") or "")[:200],
                debit=float(je.get("debit") or 0),
                credit=float(je.get("credit") or 0),
                amount=amount,
                source=str(je.get("source") or "manual")[:50],
                posted_by=str(je.get("posted_by") or "")[:100],
                day_of_week=day_of_week,
                synced_from="accounting",
            )
            db.add(entry)
            if je_id:
                existing_ids.add(je_id)
            added += 1
        except Exception as exc:
            logger.warning("R2R baseline add error: %s", exc)

    try:
        if added > 0:
            db.commit()
            _update_client_profile(company_id, country, db)
    except Exception as exc:
        logger.warning("R2R baseline commit error: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass

    return added


def _update_client_profile(company_id: str, country: str, db: Session) -> None:
    """Rebuild ClientProfile.account_baselines from all historical entries."""
    try:
        from app.models.r2r_learning import R2RHistoricalEntry, ClientProfile

        entries = db.query(R2RHistoricalEntry).filter_by(
            company_id=company_id, country=country
        ).all()
        if not entries:
            return

        acct_amounts: Dict[str, List[float]] = defaultdict(list)
        acct_names: Dict[str, str] = {}
        periods: set = set()

        for e in entries:
            if e.account_code and e.amount > 0:
                acct_amounts[e.account_code].append(e.amount)
                if e.account_name:
                    acct_names[e.account_code] = e.account_name
            if e.period:
                periods.add(e.period)

        account_baselines: Dict[str, Any] = {}
        for code, amounts in acct_amounts.items():
            account_baselines[code] = {
                "account_name": acct_names.get(code, code),
                "entry_count": len(amounts),
                "avg_amount": round(sum(amounts) / len(amounts), 2),
                "std_dev": round(statistics.stdev(amounts), 2) if len(amounts) > 1 else 0.0,
                "min": min(amounts),
                "max": max(amounts),
            }

        months = len(periods)
        client_id = f"{company_id}_{country.lower()}"

        profile = db.query(ClientProfile).filter_by(client_id=client_id).first()
        if not profile:
            profile = ClientProfile(
                client_id=client_id,
                client_name=f"{company_id} ({country})",
                learning_status="building",
            )
            db.add(profile)

        profile.account_baselines = account_baselines
        profile.months_of_data = months
        profile.total_entries_analysed = len(entries)
        profile.learning_status = "strong" if months >= 3 else "building"
        db.commit()
    except Exception as exc:
        logger.warning("ClientProfile update error: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


def get_baseline_status(company_id: str, country: str, db: Session) -> Dict[str, Any]:
    """Return baseline status dict for the Historical Intelligence tab."""
    try:
        from app.models.r2r_learning import R2RHistoricalEntry, ClientProfile

        client_id = f"{company_id}_{country.lower()}"
        profile = db.query(ClientProfile).filter_by(client_id=client_id).first()
        entries = db.query(R2RHistoricalEntry).filter_by(
            company_id=company_id, country=country
        ).all()

        periods = sorted({e.period for e in entries if e.period})
        accounts = {e.account_code for e in entries if e.account_code}
        total_amount = sum(e.amount for e in entries)

        account_baselines = []
        if profile and profile.account_baselines:
            for code, stats in profile.account_baselines.items():
                account_baselines.append({"account_code": code, **stats})
            account_baselines.sort(key=lambda x: x.get("avg_amount", 0), reverse=True)

        return {
            "company_id": company_id,
            "country": country,
            "baseline_strength": (profile.learning_status if profile else "empty"),
            "months_of_data": len(periods),
            "total_entries": len(entries),
            "accounts": len(accounts),
            "total_amount": round(total_amount, 2),
            "period_from": periods[0] if periods else None,
            "period_to": periods[-1] if periods else None,
            "account_baselines": account_baselines[:20],
        }
    except Exception as exc:
        logger.warning("get_baseline_status error: %s", exc)
        return {
            "company_id": company_id,
            "country": country,
            "baseline_strength": "empty",
            "total_entries": 0,
            "months_of_data": 0,
        }


def load_entries_for_analysis(
    company_id: str,
    country: str,
    period: Optional[str] = None,
    db: Optional[Session] = None,
) -> List[Dict[str, Any]]:
    """Load historical entries as rows ready for the R2R analysis engine."""
    if not db:
        return []
    try:
        from app.models.r2r_learning import R2RHistoricalEntry

        q = db.query(R2RHistoricalEntry).filter_by(
            company_id=company_id, country=country
        )
        if period:
            q = q.filter(R2RHistoricalEntry.period == period)
        entries = q.order_by(R2RHistoricalEntry.date).all()

        return [
            {
                "id": e.je_id or str(e.id),
                "je_number": e.je_number or "",
                "date": e.date or "",
                "description": e.description or "",
                "account": e.account_code or "",
                "account_name": e.account_name or "",
                "debit": e.debit or 0,
                "credit": e.credit or 0,
                "amount": e.amount or 0,
                "source": e.source or "manual",
                "preparer": e.posted_by or "",
                "period": e.period or "",
            }
            for e in entries
        ]
    except Exception as exc:
        logger.warning("load_entries_for_analysis error: %s", exc)
        return []
