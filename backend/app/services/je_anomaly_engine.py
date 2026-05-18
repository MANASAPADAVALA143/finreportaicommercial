"""
Enterprise-Grade JE Anomaly Detection Engine — Phase 2
Modeled on: MindBridge AI, HighRadius, Genpact Cora, ACL/Arbutus

5-Layer Architecture:
  1. StatisticalLayer   — Benford chi-square, multi-context Z-score, IQR, modified Z-score (MAD)
  2. MLAnomalyLayer     — Isolation Forest + LOF + XGBoost anomaly ranker  [Phase-2: XGB replaces AE]
  3. PatternLayer       — Fuzzy duplicates, round numbers, velocity, sequences, splitting
  4. BehavioralLayer    — New actors, off-hours timing, month-end clustering
  5. EnsembleScorer     — Dynamic calibrated thresholds + agreement bonus

Phase-2 fixes applied
─────────────────────
Fix 1  Frequency encoding leakage   — freq maps built from history only
Fix 2  AutoEncoder → XGBoost        — more stable, faster, better calibrated
Fix 3  Dynamic threshold calibration — percentile-based, industry-agnostic
Fix 4  Fuzzy duplicate detection     — catches near-amounts + similar narrations
Fix 5  False-positive feedback loop  — see feedback_learner.py
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import chisquare

logger = logging.getLogger(__name__)

# ── Default weights (overridable per client via feedback loop) ─────────────────
# BEFORE: statistical=25, ml=35, pattern=20, behavioral=20
# AFTER:  statistical=30, ml=25, pattern=30, behavioral=15
# Mapping: user-specified "controls=10" is folded into pattern layer,
# which already covers duplicates / round-numbers / velocity (compliance signals).
# behavioral drops from 25→15 to reduce false positives from pure timing signals.
DEFAULT_WEIGHTS: dict[str, float] = {
    "statistical": 30.0,  # Benford, Z-score, IQR, MAD
    "ml":          25.0,  # Isolation Forest, LOF, XGBoost
    "pattern":     30.0,  # duplicates, round numbers, velocity, splitting + controls (10%)
    "behavioral":  15.0,  # new actors, off-hours, month-end clustering
}

# ── Default hardcoded thresholds (overridden by ThresholdCalibrator) ──────────
# BEFORE: Critical>=50, High>=40, Medium>=30
# AFTER:  Critical>=80, High>=65, Medium>=45
# Target distribution: Critical<5%, High 5-10%, Medium 10-20%
DEFAULT_THRESHOLDS: dict[str, float] = {
    "CRITICAL": 80.0,
    "HIGH":     65.0,
    "MEDIUM":   45.0,
}


# ══════════════════════════════════════════════════════════════════════════════
# Fix 3 — Dynamic Threshold Calibrator
# ══════════════════════════════════════════════════════════════════════════════

class ThresholdCalibrator:
    """
    Computes dynamic risk thresholds from the history score distribution.
    Guarantees ~2% CRITICAL / ~8% HIGH / ~15% MEDIUM on ANY client dataset.
    Percentile-based — industry-agnostic (banking ≠ SaaS ≠ manufacturing).
    """

    TARGET_CRITICAL_PCT = 2.0
    TARGET_HIGH_PCT     = 8.0
    TARGET_MEDIUM_PCT   = 15.0

    def calibrate(
        self,
        history_scores:  list[float],
        target_critical: float | None = None,
        target_high:     float | None = None,
        target_medium:   float | None = None,
    ) -> dict[str, Any]:
        """
        Parameters
        ----------
        history_scores : composite scores computed on a sample of history entries
        Returns calibrated threshold dict (always includes 'calibrated' bool flag).
        """
        tc = target_critical or self.TARGET_CRITICAL_PCT
        th = target_high     or self.TARGET_HIGH_PCT
        tm = target_medium   or self.TARGET_MEDIUM_PCT

        if len(history_scores) < 20:
            return {
                "CRITICAL":   DEFAULT_THRESHOLDS["CRITICAL"],
                "HIGH":       DEFAULT_THRESHOLDS["HIGH"],
                "MEDIUM":     DEFAULT_THRESHOLDS["MEDIUM"],
                "calibrated": False,
                "note":       "Default thresholds — insufficient history to calibrate",
            }

        arr = np.array(history_scores, dtype=float)
        crit = float(np.percentile(arr, 100 - tc))
        high = float(np.percentile(arr, 100 - th))
        med  = float(np.percentile(arr, 100 - tm))

        # Monotonically decreasing guard
        crit = max(crit, high + 5.0)
        high = max(high, med  + 3.0)

        return {
            "CRITICAL":         round(crit, 1),
            "HIGH":             round(high, 1),
            "MEDIUM":           round(med,  1),
            "calibrated":       True,
            "calibrated_from":  len(history_scores),
            "note": (
                f"Calibrated from {len(history_scores)} history scores. "
                f"Top {tc}% → CRITICAL | top {th}% → HIGH | top {tm}% → MEDIUM"
            ),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Layer 1 — Statistical
# ══════════════════════════════════════════════════════════════════════════════

class StatisticalLayer:
    """
    Four independent statistical tests.
    All return scores in the same 0–100 range for ensemble blending.
    """

    # ── 1a. Benford's Law ────────────────────────────────────────────────────

    @staticmethod
    def benford_chi_square(amounts: pd.Series) -> dict[str, Any]:
        """
        Compare leading-digit distribution against Benford's Law.
        Both observed and expected expressed in % (same units).
        """
        expected_pct = {d: np.log10(1 + 1 / d) * 100 for d in range(1, 10)}

        digits: list[int] = []
        for v in amounts:
            a = abs(float(v))
            if a < 10:
                continue
            ds = re.sub(r"[^0-9]", "", str(a))
            if ds:
                digits.append(int(ds[0]))

        n = len(digits)
        observed = Counter(digits)

        digit_scores: dict[str, dict] = {}
        for d in range(1, 10):
            obs_count = observed.get(d, 0)
            obs_pct   = (obs_count / n * 100) if n > 0 else 0.0
            exp_pct   = expected_pct[d]
            digit_scores[str(d)] = {
                "observed_count": obs_count,
                "observed_pct":   round(obs_pct, 2),
                "expected_pct":   round(exp_pct, 2),
                "deviation_pct":  round(abs(obs_pct - exp_pct), 2),
                "flagged":        bool(abs(obs_pct - exp_pct) > 5.0),
            }

        if n >= 50:
            obs_freq = [observed.get(d, 0)         for d in range(1, 10)]
            exp_freq = [expected_pct[d] / 100 * n  for d in range(1, 10)]
            chi2, p_value = chisquare(obs_freq, exp_freq)
        else:
            chi2, p_value = 0.0, 1.0

        if n >= 50:
            if   p_value < 0.001: risk_score = 95.0
            elif p_value < 0.01:  risk_score = 80.0
            elif p_value < 0.05:  risk_score = 60.0
            elif p_value < 0.10:  risk_score = 35.0
            else:                  risk_score =  0.0
        else:
            risk_score = 0.0

        return {
            "chi2":            round(float(chi2), 3),
            "p_value":         round(float(p_value), 4),
            "n_digits":        n,
            "population_flag": bool(p_value < 0.05),
            "severity":        ("critical" if p_value < 0.01 else
                                "high" if p_value < 0.05 else "normal"),
            "digit_scores":    digit_scores,
            "risk_score":      round(risk_score, 1),
            "interpretation": (
                "Significant Benford deviation — possible fabrication or manipulation"
                if p_value < 0.05
                else "Distribution follows expected Benford pattern — normal"
            ),
        }

    # ── 1b. Multi-Context Z-Score (history-only reference) ───────────────────

    @staticmethod
    def multi_context_zscore(df: pd.DataFrame, hist_df: pd.DataFrame) -> pd.Series:
        """
        Z-score in 4 contexts: account / user / entity / account×user.
        Reference population is history only (no data leakage from current batch).
        Returns worst-case Z-score per entry.
        """
        ref = hist_df if not hist_df.empty else df  # history preferred

        def _z(value: float, col: str, key: Any) -> float:
            grp = ref.loc[ref[col] == key, "amount"].astype(float)
            if len(grp) < 5:
                return 0.0
            mean, std = grp.mean(), grp.std()
            return float(abs((value - mean) / std)) if std > 1e-9 else 0.0

        zscores: list[float] = []
        for _, row in df.iterrows():
            amt = float(row["amount"])
            z_acc = _z(amt, "account", row["account"])
            z_usr = _z(amt, "user_id", row["user_id"]) if "user_id" in ref.columns else 0.0
            z_ent = _z(amt, "entity",  row.get("entity", "")) if "entity" in ref.columns else 0.0

            # Account × User combo
            z_pair = 0.0
            if "user_id" in ref.columns:
                ref2 = ref.copy()
                ref2["_pair"] = ref2["account"].astype(str) + "||" + ref2["user_id"].astype(str)
                pair_key = str(row["account"]) + "||" + str(row["user_id"])
                grp2 = ref2.loc[ref2["_pair"] == pair_key, "amount"].astype(float)
                if len(grp2) >= 5:
                    m2, s2 = grp2.mean(), grp2.std()
                    if s2 > 1e-9:
                        z_pair = float(abs((amt - m2) / s2))

            zscores.append(max(z_acc, z_usr, z_ent, z_pair))

        return pd.Series(zscores, index=df.index)

    # ── 1c. IQR Outlier ──────────────────────────────────────────────────────

    @staticmethod
    def iqr_outlier(amounts: pd.Series) -> pd.Series:
        vals = amounts.astype(float).values
        if len(vals) < 4:
            return pd.Series(np.zeros(len(amounts)), index=amounts.index)
        p25, p75 = np.percentile(vals, 25), np.percentile(vals, 75)
        iqr = p75 - p25
        lower, upper    = p25 - 1.5 * iqr, p75 + 3.0 * iqr
        extreme_l, extreme_u = p25 - 3.0 * iqr, p75 + 6.0 * iqr
        scores = [
            90.0 if (v < extreme_l or v > extreme_u)
            else 55.0 if (v < lower or v > upper)
            else 0.0
            for v in vals
        ]
        return pd.Series(scores, index=amounts.index)

    # ── 1d. Modified Z-Score (Iglewicz-Hoaglin / MAD) ────────────────────────

    @staticmethod
    def modified_zscore(amounts: pd.Series) -> pd.Series:
        """M = 0.6745 * |xi − median| / MAD ; threshold 3.5 → flag."""
        vals = amounts.astype(float).values
        if len(vals) < 4:
            return pd.Series(np.zeros(len(amounts)), index=amounts.index)
        median = np.median(vals)
        mad = np.median(np.abs(vals - median))
        if mad < 1e-9:
            return pd.Series(np.zeros(len(amounts)), index=amounts.index)
        m_scores = 0.6745 * np.abs(vals - median) / mad
        risk = np.where(
            m_scores > 3.5,
            np.minimum((m_scores - 3.5) / 3.5 * 60 + 40, 95),
            0.0,
        )
        return pd.Series(risk, index=amounts.index)

    # ── Aggregate ────────────────────────────────────────────────────────────

    def score(self, df: pd.DataFrame, hist_df: pd.DataFrame) -> dict[str, Any]:
        benford    = self.benford_chi_square(df["amount"])
        ctx_z      = self.multi_context_zscore(df, hist_df)
        iqr_scores = self.iqr_outlier(df["amount"])
        mad_scores = self.modified_zscore(df["amount"])

        z_norm = (ctx_z / 5 * 100).clip(0, 100)
        per_entry = np.maximum.reduce([
            z_norm.values,
            iqr_scores.values,
            mad_scores.values,
        ])
        per_entry = np.clip(per_entry, 0, 100)

        return {
            "benford":    benford,
            "ctx_zscore": ctx_z.round(2).tolist(),
            "iqr_score":  iqr_scores.round(1).tolist(),
            "mad_score":  mad_scores.round(1).tolist(),
            "per_entry":  per_entry.round(1).tolist(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Layer 2 — ML Anomaly  (Phase-2: XGBoost replaces AutoEncoder)
# ══════════════════════════════════════════════════════════════════════════════

class MLAnomalyLayer:
    """
    Three ML models trained on history, scored on current batch.

    A) Isolation Forest — global outlier isolation
    B) LOF (novelty)   — local density anomaly
    C) XGBoost ranker  — learned normal boundary (replaced MLP AutoEncoder in Phase 2)

    Fix 1: freq maps built from history only (no leakage).
    Fix 2: XGBoost pseudo-label trick replaces unstable MLP AutoEncoder.
    """

    # ── Fix 1: Feature matrix — history_df as frequency reference ─────────────

    @staticmethod
    def _build_features(df: pd.DataFrame, history_df: pd.DataFrame) -> np.ndarray:
        """
        Build numerical feature matrix.
        Frequency encodings use history_df as reference so unseen values in the
        current batch correctly receive freq=0 (genuinely rare/new).
        """
        feats = pd.DataFrame(index=df.index)
        feats["amount_log"]    = np.log1p(df["amount"].abs().astype(float))
        feats["is_weekend"]    = (df["posting_dow"].astype(int) >= 5).astype(float)
        feats["is_afterhours"] = ((df["posting_hour"].astype(int) < 9) |
                                  (df["posting_hour"].astype(int) > 18)).astype(float)
        feats["is_round"]      = (df["amount"].astype(float) % 1000 == 0).astype(float)
        feats["is_manual"]     = (df["source"].astype(str).str.lower() == "manual").astype(float)
        feats["is_monthend"]   = (df["posting_date"].dt.day >= 28).astype(float)

        # Fix 1: build freq maps from HISTORY only → no leakage
        ref = history_df if not history_df.empty else df
        for col in ("account", "user_id"):
            if col in df.columns and col in ref.columns:
                freq = ref[col].astype(str).value_counts(normalize=True)
                # Unseen values → 0.0 (correctly flagged as rare/new)
                feats[f"{col}_freq"] = df[col].astype(str).map(freq).fillna(0.0).astype(float)
            else:
                feats[f"{col}_freq"] = 0.0

        if "entity" in df.columns and "entity" in ref.columns:
            freq_e = ref["entity"].astype(str).value_counts(normalize=True)
            feats["entity_freq"] = df["entity"].astype(str).map(freq_e).fillna(0.0).astype(float)
        else:
            feats["entity_freq"] = 0.0

        return feats.values.astype(np.float32)

    @staticmethod
    def _norm(scores: np.ndarray) -> np.ndarray:
        """Normalize scores to 0–100, higher = more anomalous."""
        lo, hi = scores.min(), scores.max()
        denom = (hi - lo) if (hi - lo) > 1e-9 else 1.0
        return np.clip((1 - (scores - lo) / denom) * 100, 0, 100)

    # ── A: Isolation Forest ──────────────────────────────────────────────────

    def _isolation_forest(self, X_hist: np.ndarray, X_curr: np.ndarray) -> np.ndarray:
        from sklearn.ensemble import IsolationForest
        X_train = np.vstack([X_hist, X_curr]) if len(X_hist) >= 20 else X_curr
        iso = IsolationForest(
            n_estimators=200,
            contamination=0.08,
            max_features=0.8,
            random_state=42,
        )
        iso.fit(X_train)
        return self._norm(iso.score_samples(X_curr))

    # ── B: Local Outlier Factor ──────────────────────────────────────────────

    def _lof(self, X_hist: np.ndarray, X_curr: np.ndarray) -> np.ndarray:
        from sklearn.neighbors import LocalOutlierFactor
        if len(X_hist) < 20:
            return np.zeros(len(X_curr))
        n_neighbors = min(20, len(X_hist) - 1)
        lof = LocalOutlierFactor(
            n_neighbors=n_neighbors,
            novelty=True,
            contamination=0.05,
        )
        lof.fit(X_hist)
        return self._norm(lof.score_samples(X_curr))

    # ── C: XGBoost Anomaly Ranker (Fix 2) ────────────────────────────────────

    def _xgboost_anomaly(self, X_hist: np.ndarray, X_curr: np.ndarray) -> np.ndarray:
        """
        One-class anomaly scorer using XGBoost with pseudo-label trick.

        Training:
          - History rows               → label 1 (normal)
          - Column-permuted history    → label 0 (synthetic anomaly)

        Scoring:
          - predict_proba(X_curr)[:, 1] = P(normal)
          - anomaly_score = (1 − P(normal)) × 100

        Advantages over MLP AutoEncoder:
          ✓ Stable with 50–500 rows
          ✓ Robust to sparse categoricals
          ✓ Interpretable feature importance
          ✓ No hyperparameter sensitivity
        """
        if len(X_hist) < 20:
            return np.zeros(len(X_curr))
        try:
            from xgboost import XGBClassifier
        except ImportError:
            logger.warning("[MLLayer] xgboost not installed — XGB layer returns zeros")
            return np.zeros(len(X_curr))

        rng = np.random.RandomState(42)
        X_synthetic = X_hist.copy()
        for col_idx in range(X_synthetic.shape[1]):
            X_synthetic[:, col_idx] = rng.permutation(X_synthetic[:, col_idx])

        X_train = np.vstack([X_hist, X_synthetic])
        y_train = np.array([1] * len(X_hist) + [0] * len(X_hist), dtype=np.int8)

        xgb = XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric="logloss",
            random_state=42,
            verbosity=0,
        )
        try:
            xgb.fit(X_train, y_train)
        except Exception as exc:
            logger.warning("[MLLayer] XGB training failed (%s) — layer returns zeros", exc)
            return np.zeros(len(X_curr))

        normal_prob = xgb.predict_proba(X_curr)[:, 1]
        return np.clip((1 - normal_prob) * 100, 0, 100).astype(np.float64)

    # ── Ensemble ─────────────────────────────────────────────────────────────

    def score(self, df: pd.DataFrame, hist_df: pd.DataFrame) -> dict[str, Any]:
        # Fix 1: pass hist_df as reference for frequency encoding
        X_curr = self._build_features(df, hist_df)
        X_hist = (self._build_features(hist_df, hist_df)
                  if not hist_df.empty else np.empty((0, X_curr.shape[1])))

        if_scores  = self._isolation_forest(X_hist, X_curr)
        lof_scores = self._lof(X_hist, X_curr)
        xgb_scores = self._xgboost_anomaly(X_hist, X_curr)   # Fix 2

        if len(X_hist) < 20:
            per_entry = if_scores
        else:
            per_entry = (0.40 * if_scores + 0.30 * lof_scores + 0.30 * xgb_scores)

        return {
            "if_scores":  if_scores.round(1).tolist(),
            "lof_scores": lof_scores.round(1).tolist(),
            "xgb_scores": xgb_scores.round(1).tolist(),
            "ae_scores":  xgb_scores.round(1).tolist(),   # compat alias
            "per_entry":  per_entry.round(1).tolist(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Layer 3 — Pattern  (Phase-2: fuzzy duplicate detection)
# ══════════════════════════════════════════════════════════════════════════════

class PatternLayer:
    """
    Structural posting-pattern detection.
    Fix 4: duplicate_score now uses fuzzy matching (rapidfuzz) to catch
    near-amounts (±2%) and similar narrations (≥85% similarity).
    """

    # ── Fix 4: Fuzzy Duplicate Detection ─────────────────────────────────────

    @staticmethod
    def duplicate_score(df: pd.DataFrame) -> np.ndarray:
        """
        Three-tier fuzzy duplicate detection:
        1. Exact duplicate    — same account + amount + date (±3 days)  → 90 pts
        2. Near-amount        — same account, within 2% tolerance (±5 d) → 60 pts
           (threshold-splitting indicator: ₹49,900 vs ₹50,000)
        3. Near-narration     — same user, description ≥85% similar (±7 d) → 40 pts
        """
        try:
            from rapidfuzz import fuzz as rfuzz
            has_rapidfuzz = True
        except ImportError:
            has_rapidfuzz = False
            logger.warning("[PatternLayer] rapidfuzz not installed — narration matching disabled")

        has_desc = "description" in df.columns
        scores = np.zeros(len(df))

        for i, (idx, row) in enumerate(df.iterrows()):
            date    = pd.Timestamp(row["posting_date"])
            amount  = float(row["amount"])
            account = str(row["account"])
            user_id = str(row.get("user_id", ""))

            others       = df[df.index != idx]
            if others.empty:
                continue
            others_dates = pd.to_datetime(others["posting_date"])
            score        = 0.0

            # 1 — Exact duplicate (±3 days)
            w3 = (others_dates >= date - pd.Timedelta(days=3)) & \
                 (others_dates <= date + pd.Timedelta(days=3))
            exact = others[
                w3 &
                (others["amount"].astype(float) == amount) &
                (others["account"].astype(str) == account)
            ]
            if len(exact) > 0:
                score = 90.0

            # 2 — Near-amount (±2% tolerance, ±5 days) — threshold splitting
            if amount != 0 and score < 90:
                tol = abs(amount) * 0.02
                w5  = (others_dates >= date - pd.Timedelta(days=5)) & \
                      (others_dates <= date + pd.Timedelta(days=5))
                near_amt = others[
                    w5 &
                    (others["account"].astype(str) == account) &
                    (others["amount"].astype(float) != amount) &
                    (np.abs(others["amount"].astype(float) - amount) <= tol)
                ]
                if len(near_amt) > 0:
                    score = max(score, 60.0)

            # 3 — Near-narration (same user, ≥85% similarity, ±7 days)
            if has_desc and has_rapidfuzz and score < 60 and user_id:
                entry_desc = str(row.get("description", "")).strip()
                if entry_desc and len(entry_desc) > 3:
                    w7 = (others_dates >= date - pd.Timedelta(days=7)) & \
                         (others_dates <= date + pd.Timedelta(days=7))
                    same_user = others[
                        w7 & (others["user_id"].astype(str) == user_id)
                    ]
                    for _, orow in same_user.iterrows():
                        other_desc = str(orow.get("description", "")).strip()
                        if other_desc and len(other_desc) > 3:
                            sim = rfuzz.token_sort_ratio(entry_desc, other_desc)
                            if sim >= 85:
                                score = max(score, 40.0)
                                break

            scores[i] = score

        return scores

    @staticmethod
    def round_number_score(amounts: pd.Series) -> np.ndarray:
        """Round-number amounts are a classic fraud indicator."""
        scores = []
        for v in amounts.astype(float):
            if   v % 10_000 == 0 and v > 0: scores.append(70.0)
            elif v % 1_000  == 0 and v > 0: scores.append(45.0)
            elif v % 100    == 0 and v > 0: scores.append(20.0)
            else:                            scores.append(0.0)
        return np.array(scores)

    @staticmethod
    def velocity_score(df: pd.DataFrame) -> np.ndarray:
        """Many postings by same user in same hour → velocity risk."""
        scores = np.zeros(len(df))
        df2 = df.copy()
        df2["_hour"] = (df2["posting_date"].dt.floor("h").astype(str) +
                        "||" + df2["user_id"].astype(str))
        counts = df2["_hour"].value_counts()
        for i, (_, row) in enumerate(df2.iterrows()):
            c = counts.get(row["_hour"], 0)
            if   c >= 10: scores[i] = 80.0
            elif c >= 5:  scores[i] = 50.0
            elif c >= 3:  scores[i] = 25.0
        return scores

    @staticmethod
    def rapid_sequence_score(df: pd.DataFrame) -> np.ndarray:
        """Entries within 60 seconds of each other by same user."""
        scores = np.zeros(len(df))
        df2    = df.sort_values("posting_date")
        times  = df2["posting_date"].values
        users  = df2["user_id"].astype(str).values
        for i in range(1, len(df2)):
            if users[i] == users[i - 1]:
                diff = (pd.Timestamp(times[i]) - pd.Timestamp(times[i - 1])).total_seconds()
                if 0 < diff < 60:
                    scores[df.index.get_loc(df2.index[i])] = 65.0
        return scores

    @staticmethod
    def splitting_score(df: pd.DataFrame) -> np.ndarray:
        """Amounts clustered within 5% by same user (count ≥ 3) → splitting."""
        scores = np.zeros(len(df))
        for _, grp in df.groupby("user_id"):
            if len(grp) < 3:
                continue
            amounts = grp["amount"].astype(float).values
            for i, a in enumerate(amounts):
                close = np.sum(np.abs(amounts - a) / max(abs(a), 1) < 0.05)
                if close >= 3:
                    scores[df.index.get_loc(grp.index[i])] = max(
                        scores[df.index.get_loc(grp.index[i])], 60.0
                    )
        return scores

    def score(self, df: pd.DataFrame) -> dict[str, Any]:
        dupe  = self.duplicate_score(df)
        rnum  = self.round_number_score(df["amount"])
        vel   = self.velocity_score(df)
        seq   = self.rapid_sequence_score(df)
        spl   = self.splitting_score(df)
        per_entry = np.maximum.reduce([dupe, rnum * 0.6, vel, seq, spl])
        per_entry = np.clip(per_entry, 0, 100)
        return {
            "duplicate":    dupe.round(1).tolist(),
            "round_number": rnum.round(1).tolist(),
            "velocity":     vel.round(1).tolist(),
            "sequence":     seq.round(1).tolist(),
            "splitting":    spl.round(1).tolist(),
            "per_entry":    per_entry.round(1).tolist(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Layer 4 — Behavioral
# ══════════════════════════════════════════════════════════════════════════════

class BehavioralLayer:
    """Compares current batch actors/timing against historical baseline."""

    @staticmethod
    def new_actor_score(df: pd.DataFrame, hist_df: pd.DataFrame) -> np.ndarray:
        scores = np.zeros(len(df))
        if hist_df.empty:
            return scores
        known_users    = set(hist_df["user_id"].astype(str))
        known_accounts = set(hist_df["account"].astype(str))
        known_entities = (set(hist_df["entity"].astype(str))
                         if "entity" in hist_df.columns else set())

        # Also track known account×user combos
        known_combos: set[tuple[str, str]] = set()
        if "user_id" in hist_df.columns:
            known_combos = set(
                zip(hist_df["user_id"].astype(str), hist_df["account"].astype(str))
            )

        for i, (_, row) in enumerate(df.iterrows()):
            s = 0.0
            uid = str(row["user_id"])
            acc = str(row["account"])
            if uid not in known_users:
                s += 50.0
            if acc not in known_accounts:
                s += 30.0
            if known_entities and str(row.get("entity", "")) not in known_entities:
                s += 20.0
            # New account×user combination (known user, unfamiliar account)
            if uid in known_users and acc in known_accounts and (uid, acc) not in known_combos:
                s += 15.0
            scores[i] = min(s, 90.0)
        return scores

    @staticmethod
    def timing_score(df: pd.DataFrame, hist_df: pd.DataFrame) -> np.ndarray:
        scores = np.zeros(len(df))
        hist_afterhours_pct = hist_weekend_pct = 0.0
        if not hist_df.empty:
            h = hist_df["posting_hour"].astype(int)
            hist_afterhours_pct = float(((h < 9) | (h > 18)).mean() * 100)
            hist_weekend_pct    = float((hist_df["posting_dow"].astype(int) >= 5).mean() * 100)
        for i, (_, row) in enumerate(df.iterrows()):
            s = 0.0
            if int(row["posting_hour"]) < 9 or int(row["posting_hour"]) > 18:
                if hist_afterhours_pct < 10.0:
                    s += 40.0
            if int(row["posting_dow"]) >= 5:
                if hist_weekend_pct < 5.0:
                    s += 40.0
            scores[i] = min(s, 80.0)
        return scores

    @staticmethod
    def monthend_cluster_score(df: pd.DataFrame, hist_df: pd.DataFrame) -> np.ndarray:
        scores = np.zeros(len(df))
        hist_me_pct = 0.0
        if not hist_df.empty:
            hist_me_pct = float((hist_df["posting_date"].dt.day >= 28).mean() * 100)
        curr_me_pct = float((df["posting_date"].dt.day >= 28).mean() * 100)
        spike = curr_me_pct > hist_me_pct + 20
        for i, (_, row) in enumerate(df.iterrows()):
            if spike and pd.Timestamp(row["posting_date"]).day >= 28:
                scores[i] = 55.0
        return scores

    def score(self, df: pd.DataFrame, hist_df: pd.DataFrame) -> dict[str, Any]:
        new_act  = self.new_actor_score(df, hist_df)
        timing   = self.timing_score(df, hist_df)
        monthend = self.monthend_cluster_score(df, hist_df)
        per_entry = np.maximum.reduce([new_act, timing, monthend])
        per_entry = np.clip(per_entry, 0, 100)
        return {
            "new_actor":  new_act.round(1).tolist(),
            "timing":     timing.round(1).tolist(),
            "monthend":   monthend.round(1).tolist(),
            "per_entry":  per_entry.round(1).tolist(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# Ensemble Scorer  (Fix 3: instance-level thresholds for dynamic calibration)
# ══════════════════════════════════════════════════════════════════════════════

class EnsembleScorer:
    """
    Weighted composite with agreement bonus.
    Fix 3: thresholds and weights are instance-level (can be calibrated
    per client by ThresholdCalibrator / FeedbackLearner).
    """

    def __init__(
        self,
        weights:    dict[str, float] | None = None,
        thresholds: dict[str, float] | None = None,
    ) -> None:
        self.weights    = dict(weights    or DEFAULT_WEIGHTS)
        self.thresholds = dict(thresholds or DEFAULT_THRESHOLDS)

    def risk_level(self, score: float) -> str:
        if score >= self.thresholds["CRITICAL"]: return "CRITICAL"
        if score >= self.thresholds["HIGH"]:     return "HIGH"
        if score >= self.thresholds["MEDIUM"]:   return "MEDIUM"
        return "LOW"

    def composite(
        self,
        stat_scores: list[float],
        ml_scores:   list[float],
        pat_scores:  list[float],
        beh_scores:  list[float],
    ) -> list[dict[str, Any]]:
        w = self.weights
        results = []
        for s, m, p, b in zip(stat_scores, ml_scores, pat_scores, beh_scores):
            weighted = (
                w["statistical"] / 100 * s +
                w["ml"]          / 100 * m +
                w["pattern"]     / 100 * p +
                w["behavioral"]  / 100 * b
            )
            flagging = sum(1 for x in [s, m, p, b] if x >= 40)
            bonus    = 5.0 if flagging >= 3 else 0.0
            composite = min(weighted + bonus, 100.0)
            results.append({
                "composite_score":  round(composite, 1),
                "risk_level":       self.risk_level(composite),
                "layer_scores": {
                    "statistical": round(s, 1),
                    "ml":          round(m, 1),
                    "pattern":     round(p, 1),
                    "behavioral":  round(b, 1),
                },
                "flagging_layers": flagging,
                "agreement_bonus": round(bonus, 1),
            })
        return results


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

def _zscore_to_plain(z: float) -> str:
    if z > 5:  return f"Amount is {z:.1f}× above account norm (extreme outlier)"
    if z > 3:  return f"Amount is {z:.1f}× above account norm (significant)"
    if z > 2:  return f"Amount is {z:.1f}× above account norm (watch)"
    return f"Amount within normal range (Z={z:.2f})"


# ══════════════════════════════════════════════════════════════════════════════
# Main Engine
# ══════════════════════════════════════════════════════════════════════════════

class JEAnomalyEngine:
    """
    Orchestrates all 5 layers.

    Usage
    -----
    engine = JEAnomalyEngine()
    result = engine.analyze(df_current, df_history)
    # result["entries"]       — list[dict], one per entry
    # result["batch_stats"]   — population-level metrics
    # result["thresholds"]    — calibrated (or default) thresholds used
    """

    def __init__(
        self,
        weights:    dict[str, float] | None = None,
        thresholds: dict[str, float] | None = None,
    ) -> None:
        self._stat = StatisticalLayer()
        self._ml   = MLAnomalyLayer()
        self._pat  = PatternLayer()
        self._beh  = BehavioralLayer()
        self._ens  = EnsembleScorer(weights=weights, thresholds=thresholds)
        self._cal  = ThresholdCalibrator()

    def analyze(
        self,
        df:      pd.DataFrame,
        hist_df: pd.DataFrame,
        *,
        client_weights:    dict[str, float] | None = None,
        skip_calibration:  bool = False,
    ) -> dict[str, Any]:
        """
        Parameters
        ----------
        df               : current batch (canonical schema)
        hist_df          : historical baseline (same schema; may be empty)
        client_weights   : per-client learned weights from FeedbackLearner (Fix 5)
        skip_calibration : set True in unit tests to avoid slow history scoring

        Returns
        -------
        dict with keys: entries, batch_stats, thresholds
        """
        if df.empty:
            return {"entries": [], "batch_stats": {}, "thresholds": {}}

        logger.info(
            "[JEEngine] Analyzing %d entries, %d history rows",
            len(df), len(hist_df),
        )

        # Apply client-specific learned weights (Fix 5)
        if client_weights:
            self._ens.weights = dict(client_weights)

        # Fix 3: Dynamic threshold calibration from history distribution
        calibration_info: dict[str, Any] = {}
        if not skip_calibration and len(hist_df) >= 50:
            hist_scores = self._score_history_sample(hist_df)
            cal = self._cal.calibrate(hist_scores)
            self._ens.thresholds = {
                "CRITICAL": cal["CRITICAL"],
                "HIGH":     cal["HIGH"],
                "MEDIUM":   cal["MEDIUM"],
            }
            calibration_info = cal
            logger.info("[JEEngine] Calibrated thresholds: %s", cal)
        else:
            calibration_info = {
                "calibrated": False,
                "note": "Default thresholds used (< 50 history rows)",
            }

        # Run all layers
        stat_out = self._stat.score(df, hist_df)
        ml_out   = self._ml.score(df, hist_df)
        pat_out  = self._pat.score(df)
        beh_out  = self._beh.score(df, hist_df)

        composites = self._ens.composite(
            stat_scores=stat_out["per_entry"],
            ml_scores=ml_out["per_entry"],
            pat_scores=pat_out["per_entry"],
            beh_scores=beh_out["per_entry"],
        )

        entries: list[dict[str, Any]] = []
        for i, (_, row) in enumerate(df.iterrows()):
            comp = composites[i]
            z    = float(stat_out["ctx_zscore"][i])

            reasons: list[str] = []
            if stat_out["per_entry"][i] >= 40:
                reasons.append(_zscore_to_plain(z))
            if beh_out["new_actor"][i] >= 40:
                reasons.append("Posting actor (user/account) not seen in history")
            if pat_out["duplicate"][i] >= 50:
                reasons.append("Duplicate / near-duplicate entry detected")
            if beh_out["timing"][i] >= 40:
                reasons.append("Off-hours or weekend posting vs normal business pattern")
            if pat_out["splitting"][i] >= 40:
                reasons.append("Potential amount-splitting pattern detected")
            if pat_out["velocity"][i] >= 40:
                reasons.append("High posting velocity by same user in short window")
            if ml_out["per_entry"][i] >= 60:
                reasons.append("ML models flag as structurally anomalous")

            entries.append({
                "journal_id":   str(row["journal_id"]),
                "account":      str(row["account"]),
                "amount":       float(row["amount"]),
                "user_id":      str(row["user_id"]),
                "source":       str(row["source"]),
                "posting_date": pd.Timestamp(row["posting_date"]).strftime("%Y-%m-%d"),
                "description":  str(row.get("description", "")),
                "entity":       str(row.get("entity", "")),
                "composite": {
                    **comp,
                    "top_reasons": reasons[:4],
                },
                "layer_detail": {
                    "statistical": {
                        "score":      stat_out["per_entry"][i],
                        "ctx_zscore": round(z, 2),
                        "iqr_score":  stat_out["iqr_score"][i],
                        "mad_score":  stat_out["mad_score"][i],
                    },
                    "ml": {
                        "score":      ml_out["per_entry"][i],
                        "if_score":   ml_out["if_scores"][i],
                        "lof_score":  ml_out["lof_scores"][i],
                        "xgb_score":  ml_out["xgb_scores"][i],   # Fix 2
                        "ae_score":   ml_out["ae_scores"][i],     # compat alias
                    },
                    "pattern": {
                        "score":        pat_out["per_entry"][i],
                        "duplicate":    pat_out["duplicate"][i],
                        "round_number": pat_out["round_number"][i],
                        "velocity":     pat_out["velocity"][i],
                        "sequence":     pat_out["sequence"][i],
                        "splitting":    pat_out["splitting"][i],
                    },
                    "behavioral": {
                        "score":     beh_out["per_entry"][i],
                        "new_actor": beh_out["new_actor"][i],
                        "timing":    beh_out["timing"][i],
                        "monthend":  beh_out["monthend"][i],
                    },
                },
            })

        entries.sort(key=lambda e: e["composite"]["composite_score"], reverse=True)

        by_risk: Counter = Counter(e["composite"]["risk_level"] for e in entries)
        batch_stats: dict[str, Any] = {
            "total":             len(entries),
            "critical":          by_risk.get("CRITICAL", 0),
            "high":              by_risk.get("HIGH",     0),
            "medium":            by_risk.get("MEDIUM",   0),
            "low":               by_risk.get("LOW",      0),
            "benford":           stat_out["benford"],
            "history_rows_used": len(hist_df),
        }

        return {
            "entries":     entries,
            "batch_stats": batch_stats,
            "thresholds":  {
                **self._ens.thresholds,
                "calibration": calibration_info,
            },
        }

    def _score_history_sample(
        self,
        hist_df: pd.DataFrame,
        sample_size: int = 200,
    ) -> list[float]:
        """
        Fast statistical scoring of a history sample to calibrate thresholds.
        Uses statistical layer only (no ML retraining).
        """
        sample = hist_df.sample(min(sample_size, len(hist_df)), random_state=42)
        scores: list[float] = []
        for _, row in sample.iterrows():
            # Z-score against full history (row itself is in history — slight bias
            # but acceptable for threshold calibration)
            ref = hist_df
            amt = float(row["amount"])
            grp = ref.loc[ref["account"] == row["account"], "amount"].astype(float)
            if len(grp) >= 5:
                m, s = grp.mean(), grp.std()
                z = abs((amt - m) / s) if s > 1e-9 else 0.0
            else:
                z = 0.0
            stat_approx = min(z / 5 * 100, 100)
            scores.append(float(stat_approx))
        return scores
