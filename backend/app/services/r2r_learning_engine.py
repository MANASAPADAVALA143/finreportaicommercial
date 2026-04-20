"""Client-specific learning from R2R human feedback (threshold nudges + baselines)."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.models.r2r_learning import ClientProfile, JournalEntryFeedback, LearningEvent


def _reasons_blob(reasons: Any) -> str:
    if reasons is None:
        return ""
    if isinstance(reasons, list):
        return json.dumps(reasons, default=str)
    return str(reasons)


def _reasons_has_weekend(reasons: Any) -> bool:
    b = _reasons_blob(reasons).lower()
    return "weekend" in b or "wknd" in b


def _reasons_has_amount_outlier(reasons: Any) -> bool:
    b = _reasons_blob(reasons).lower()
    return "amount outlier" in b or "iqr outlier" in b or "high value" in b or "z=" in b


def _reasons_has_round_number(reasons: Any) -> bool:
    b = _reasons_blob(reasons).lower()
    return "round" in b or "benford" in b


def _normalize_historical_df(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    rename: dict[str, str] = {}
    for c in out.columns:
        rename[c] = str(c).strip().lower().replace(" ", "_").replace("/", "_")
    out = out.rename(columns=rename)
    for src, dst in [
        ("gl_account", "account"),
        ("ledger", "account"),
        ("account_code", "account"),
        ("acct", "account"),
        ("posted_by", "user"),
        ("user_id", "user"),
        ("created_by", "user"),
        ("posting_date", "date"),
        ("txn_date", "date"),
        ("value", "amount"),
        ("debit", "amount"),
    ]:
        if src in out.columns and dst not in out.columns:
            out = out.rename(columns={src: dst})
    return out


def build_improvement_story(profile: ClientProfile, events: list[LearningEvent]) -> dict[str, Any]:
    total = max(profile.total_entries_analysed or 0, 1)
    approved = profile.total_approved or 0
    denom = max(int(total * 0.15), 1)
    fp_proxy = approved / denom if denom else 0.0
    before_alerts = int(total * 0.15) or 15
    after_alerts = max(int(before_alerts * (1 - min(fp_proxy * 0.5, 0.7))), int(before_alerts * 0.3))
    months = profile.months_of_data or 1
    reduction_pct = round((before_alerts - after_alerts) / before_alerts * 100) if before_alerts else 0
    return {
        "before_alerts": before_alerts,
        "after_alerts": after_alerts,
        "reduction_pct": reduction_pct,
        "months_to_here": months,
        "message": (
            f"After {months} month(s) of feedback, illustrative alert load reduced from "
            f"{before_alerts} to {after_alerts} ({reduction_pct}% fewer in this model). "
            "Tune thresholds with approvals/rejections."
        ),
    }


class R2RLearningEngine:
    MIN_FEEDBACK_TO_LEARN = 5
    FALSE_POSITIVE_TRIGGER = 0.7

    def get_or_create_profile(self, db: Session, client_id: str, client_name: str = "") -> ClientProfile:
        p = db.query(ClientProfile).filter(ClientProfile.client_id == client_id).first()
        if p:
            if client_name and not (p.client_name or "").strip():
                p.client_name = client_name
                p.updated_at = datetime.utcnow()
                db.commit()
                db.refresh(p)
            return p
        display_name = (client_name or "").strip() or client_id
        p = ClientProfile(client_id=client_id, client_name=display_name)
        db.add(p)
        db.commit()
        db.refresh(p)
        return p

    def build_baseline(
        self,
        client_id: str,
        client_name: str,
        historical_df: pd.DataFrame,
        db: Session,
        industry: str | None = None,
        fiscal_year_end: str | None = None,
    ) -> ClientProfile:
        df = _normalize_historical_df(historical_df)
        profile = self.get_or_create_profile(db, client_id, client_name)
        if industry:
            profile.industry = industry
        if fiscal_year_end:
            profile.fiscal_year_end = fiscal_year_end

        account_stats: dict[str, Any] = {}
        if "account" in df.columns:
            for acct in df["account"].dropna().unique():
                acct_data = pd.to_numeric(df.loc[df["account"] == acct, "amount"], errors="coerce").dropna()
                if len(acct_data) < 1:
                    continue
                account_stats[str(acct)] = {
                    "mean": float(acct_data.mean()),
                    "std": float(acct_data.std() or 1.0),
                    "p95": float(acct_data.quantile(0.95)),
                    "count": int(len(acct_data)),
                }
        profile.account_baselines = account_stats or {}

        user_stats: dict[str, Any] = {}
        if "user" in df.columns and "date" in df.columns:
            df_dates = pd.to_datetime(df["date"], errors="coerce")
            n_months = max(df_dates.dt.to_period("M").nunique(), 1)
            for user in df["user"].dropna().unique():
                umask = df["user"] == user
                user_data = df.loc[umask]
                typical_accounts: list[str] = []
                if "account" in user_data.columns:
                    typical_accounts = [
                        str(x) for x in user_data["account"].value_counts().head(5).index.tolist()
                    ]
                uh = 10.0
                if "date" in user_data.columns:
                    hrs = pd.to_datetime(user_data["date"], errors="coerce").dt.hour
                    if hrs.notna().any():
                        uh = float(hrs.mean())
                user_stats[str(user)] = {
                    "avg_entries_per_month": float(len(user_data) / n_months),
                    "typical_accounts": typical_accounts,
                    "typical_hours": int(round(uh)) % 24,
                }
        profile.user_baselines = user_stats or {}

        vendor_stats: dict[str, Any] = {}
        if "vendor" in df.columns and "amount" in df.columns:
            for v in df["vendor"].dropna().unique():
                vals = pd.to_numeric(df.loc[df["vendor"] == v, "amount"], errors="coerce").dropna()
                if len(vals) < 1:
                    continue
                vendor_stats[str(v)] = {"mean": float(vals.mean()), "std": float(vals.std() or 1.0), "count": int(len(vals))}
        profile.vendor_baselines = vendor_stats or {}

        if "date" in df.columns:
            dts = pd.to_datetime(df["date"], errors="coerce")
            valid = dts.notna()
            if valid.any():
                weekend_rate = float(dts.dt.dayofweek.isin([5, 6])[valid].mean())
                month_end_rate = float((dts.dt.day >= 25)[valid].mean())
                profile.timing_baselines = {
                    "weekend_rate": weekend_rate,
                    "peak_hours": [9, 10, 11, 14, 15, 16],
                    "month_end_rate": month_end_rate,
                }
            else:
                profile.timing_baselines = {}
        else:
            profile.timing_baselines = {}

        months = 1
        if "date" in df.columns:
            dts = pd.to_datetime(df["date"], errors="coerce")
            if dts.notna().any():
                months = max(int(dts.dt.to_period("M").nunique()), 1)
        profile.months_of_data = months
        profile.total_entries_analysed = int(len(df))
        if months >= 6:
            profile.learning_status = "optimised"
        elif months >= 3:
            profile.learning_status = "calibrated"
        elif months >= 1:
            profile.learning_status = "learning"
        else:
            profile.learning_status = "initialising"
        profile.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(profile)
        return profile

    def record_feedback(
        self,
        client_id: str,
        entry_data: dict[str, Any],
        feedback: str,
        comment: str,
        reviewed_by: str,
        db: Session,
    ) -> dict[str, Any]:
        fb_norm = (feedback or "").strip().lower()
        if fb_norm not in ("approved", "rejected", "needs_review"):
            raise ValueError("feedback must be approved, rejected, or needs_review")

        profile = self.get_or_create_profile(db, client_id, "")

        reasons = entry_data.get("risk_reasons")
        if isinstance(reasons, str):
            try:
                reasons = json.loads(reasons)
            except json.JSONDecodeError:
                reasons = [reasons]

        posting_date = entry_data.get("date")
        pd_dt: datetime | None = None
        if posting_date is not None:
            parsed = pd.to_datetime(posting_date, errors="coerce")
            if pd.notna(parsed):
                pd_dt = parsed.to_pydatetime()

        fb = JournalEntryFeedback(
            client_id=client_id,
            entry_id=str(entry_data.get("entry_id", "")),
            gl_account=str(entry_data.get("account", entry_data.get("gl_account", ""))),
            amount=float(entry_data.get("amount", 0) or 0),
            posted_by=str(entry_data.get("user", entry_data.get("posted_by", ""))),
            posting_date=pd_dt,
            description=str(entry_data.get("description", "") or "")[:4000],
            original_risk_score=float(entry_data.get("risk_score", 0) or 0),
            original_risk_level=str(entry_data.get("risk_level", "") or ""),
            original_risk_reasons=reasons if isinstance(reasons, list) else ([reasons] if reasons else []),
            feedback=fb_norm,
            feedback_comment=(comment or None),
            reviewed_by=reviewed_by or "analyst",
            reviewed_at=datetime.utcnow(),
        )
        db.add(fb)
        db.flush()

        if fb_norm == "approved":
            profile.total_approved = (profile.total_approved or 0) + 1
        elif fb_norm == "rejected":
            profile.total_rejected = (profile.total_rejected or 0) + 1
        ar = (profile.total_approved or 0) + (profile.total_rejected or 0)
        if ar > 0:
            profile.false_positive_rate = (profile.total_approved or 0) / ar
        profile.updated_at = datetime.utcnow()
        db.commit()

        learning_result = self._check_and_learn(client_id, db, fb.id)
        return {
            "feedback_saved": True,
            "feedback_id": fb.id,
            "learning_triggered": bool(learning_result.get("adjusted")),
            "adjustments": learning_result.get("changes", []),
        }

    def _check_and_learn(self, client_id: str, db: Session, new_feedback_id: int | None) -> dict[str, Any]:
        profile = db.query(ClientProfile).filter(ClientProfile.client_id == client_id).first()
        if not profile:
            return {"adjusted": False, "reason": "no profile"}

        recent_feedback = (
            db.query(JournalEntryFeedback)
            .filter(JournalEntryFeedback.client_id == client_id)
            .order_by(JournalEntryFeedback.reviewed_at.desc())
            .limit(50)
            .all()
        )
        if len(recent_feedback) < self.MIN_FEEDBACK_TO_LEARN:
            return {"adjusted": False, "reason": "not enough feedback yet", "feedback_count": len(recent_feedback)}

        changes: list[str] = []
        adjusted_any = False

        weekend_fb = [f for f in recent_feedback if _reasons_has_weekend(f.original_risk_reasons)]
        if len(weekend_fb) >= 3:
            approved_weekend = sum(1 for f in weekend_fb if f.feedback == "approved")
            fp_rate = approved_weekend / len(weekend_fb)
            if fp_rate >= self.FALSE_POSITIVE_TRIGGER:
                old_val = float(profile.weekend_penalty_score or 15.0)
                new_val = max(old_val - 3.0, 5.0)
                if new_val < old_val - 0.01:
                    profile.weekend_penalty_score = new_val
                    ev = LearningEvent(
                        client_id=client_id,
                        event_type="threshold_adjusted",
                        description=(
                            f"Weekend penalty reduced {old_val:.0f}→{new_val:.0f}. "
                            f"{len(weekend_fb)} weekend-tagged reviews, {fp_rate * 100:.0f}% approved."
                        ),
                        old_value=str(int(old_val)),
                        new_value=str(int(new_val)),
                        triggered_by_feedback_id=new_feedback_id,
                    )
                    db.add(ev)
                    changes.append(f"Weekend penalty: {old_val:.0f}→{new_val:.0f}")
                    adjusted_any = True
                    for f in weekend_fb[-5:]:
                        if f.feedback == "approved":
                            f.threshold_adjusted = True
                            f.adjustment_note = "weekend_penalty_reduced"

        high_amount_fb = [f for f in recent_feedback if _reasons_has_amount_outlier(f.original_risk_reasons)]
        if len(high_amount_fb) >= 3:
            approved_high = sum(1 for f in high_amount_fb if f.feedback == "approved")
            fp_rate_amt = approved_high / len(high_amount_fb)
            if fp_rate_amt >= self.FALSE_POSITIVE_TRIGGER:
                old_mult = float(profile.amount_threshold_multiplier or 2.0)
                new_mult = min(old_mult + 0.3, 5.0)
                if new_mult > old_mult + 0.01:
                    profile.amount_threshold_multiplier = new_mult
                    db.add(
                        LearningEvent(
                            client_id=client_id,
                            event_type="threshold_adjusted",
                            description=(
                                f"Amount multiplier raised {old_mult:.1f}x→{new_mult:.1f}x "
                                f"({len(high_amount_fb)} amount-outlier reviews, {fp_rate_amt * 100:.0f}% approved)."
                            ),
                            old_value=str(round(old_mult, 2)),
                            new_value=str(round(new_mult, 2)),
                            triggered_by_feedback_id=new_feedback_id,
                        )
                    )
                    changes.append(f"Amount threshold: {old_mult:.1f}x→{new_mult:.1f}x")
                    adjusted_any = True

        round_fb = [f for f in recent_feedback if _reasons_has_round_number(f.original_risk_reasons)]
        if len(round_fb) >= 3:
            approved_r = sum(1 for f in round_fb if f.feedback == "approved")
            fp_r = approved_r / len(round_fb)
            if fp_r >= self.FALSE_POSITIVE_TRIGGER:
                old_rp = float(profile.round_number_penalty or 10.0)
                new_rp = max(old_rp - 2.0, 3.0)
                if new_rp < old_rp - 0.01:
                    profile.round_number_penalty = new_rp
                    db.add(
                        LearningEvent(
                            client_id=client_id,
                            event_type="threshold_adjusted",
                            description=f"Round-number / Benford-style penalty relaxed {old_rp:.0f}→{new_rp:.0f}.",
                            old_value=str(int(old_rp)),
                            new_value=str(int(new_rp)),
                            triggered_by_feedback_id=new_feedback_id,
                        )
                    )
                    changes.append(f"Round-number penalty: {old_rp:.0f}→{new_rp:.0f}")
                    adjusted_any = True

        profile.updated_at = datetime.utcnow()
        db.commit()
        return {
            "adjusted": adjusted_any,
            "changes": changes,
            "current_false_positive_rate": profile.false_positive_rate,
            "feedback_count": len(recent_feedback),
        }

    def get_learning_progress(self, client_id: str, db: Session) -> dict[str, Any]:
        profile = db.query(ClientProfile).filter(ClientProfile.client_id == client_id).first()
        if not profile:
            return {"status": "no_profile", "client_id": client_id}

        events = (
            db.query(LearningEvent)
            .filter(LearningEvent.client_id == client_id)
            .order_by(LearningEvent.created_at.desc())
            .limit(100)
            .all()
        )
        fp_rate = float(profile.false_positive_rate or 0.0)
        acct_n = len(profile.account_baselines or {})
        user_n = len(profile.user_baselines or {})
        story = build_improvement_story(profile, events)
        return {
            "client_id": client_id,
            "client_name": profile.client_name,
            "learning_status": profile.learning_status,
            "months_of_data": profile.months_of_data or 0,
            "total_analysed": profile.total_entries_analysed or 0,
            "total_feedback": (profile.total_approved or 0) + (profile.total_rejected or 0),
            "total_approved": profile.total_approved or 0,
            "total_rejected": profile.total_rejected or 0,
            "false_positive_rate_pct": round(fp_rate * 100, 1),
            "accuracy_estimate_pct": round((1 - fp_rate) * 100, 1) if fp_rate <= 1 else 0.0,
            "adjustments_made": len(events),
            "recent_adjustments": [{"description": e.description, "date": str(e.created_at)[:10]} for e in events[:5]],
            "baseline_accounts": acct_n,
            "baseline_users": user_n,
            "thresholds": {
                "amount_threshold_multiplier": profile.amount_threshold_multiplier,
                "weekend_penalty_score": profile.weekend_penalty_score,
                "round_number_penalty": profile.round_number_penalty,
                "new_vendor_penalty": profile.new_vendor_penalty,
            },
            "improvement_story": story,
        }

    def list_feedback_history(
        self, client_id: str, db: Session, status: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        q = db.query(JournalEntryFeedback).filter(JournalEntryFeedback.client_id == client_id)
        if status and status.lower() in ("approved", "rejected", "needs_review"):
            q = q.filter(JournalEntryFeedback.feedback == status.lower())
        rows = q.order_by(JournalEntryFeedback.reviewed_at.desc()).limit(limit).all()
        out: list[dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "id": r.id,
                    "entry_id": r.entry_id,
                    "gl_account": r.gl_account,
                    "amount": r.amount,
                    "posted_by": r.posted_by,
                    "posting_date": r.posting_date.isoformat() if r.posting_date else None,
                    "feedback": r.feedback,
                    "comment": r.feedback_comment,
                    "reviewed_by": r.reviewed_by,
                    "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                    "original_risk_score": r.original_risk_score,
                    "original_risk_level": r.original_risk_level,
                    "original_risk_reasons": r.original_risk_reasons,
                    "threshold_adjusted": r.threshold_adjusted,
                }
            )
        return out
