"""
4-layer R2R journal anomaly engine (Isolation Forest, DBSCAN, LOF, rules, behavioural).
"""
from __future__ import annotations

import warnings
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

BENFORD_EXPECTED: dict[int, float] = {
    1: 0.301,
    2: 0.176,
    3: 0.125,
    4: 0.097,
    5: 0.079,
    6: 0.067,
    7: 0.058,
    8: 0.051,
    9: 0.046,
}


def _first_digit_amount(x: float) -> int:
    if x <= 0 or not np.isfinite(x):
        return 1
    s = str(int(round(float(x))))
    for ch in s:
        if ch.isdigit():
            return int(ch)
    return 1


def _coerce_single_date(val: Any) -> pd.Timestamp:
    """Parse dates; fix Excel serial numbers that otherwise become 1970-01-01."""
    if val is None or val == "":
        return pd.NaT
    if isinstance(val, float) and (np.isnan(val) or np.isinf(val)):
        return pd.NaT
    if isinstance(val, pd.Timestamp):
        return val
    if isinstance(val, datetime):
        return pd.Timestamp(val)

    if isinstance(val, (int, float, np.integer, np.floating)) and np.isfinite(float(val)):
        f = float(val)
        # Excel day count (modern dates ≈ 40k–50k)
        if 300 <= f < 1_000_000:
            dt = pd.Timestamp("1899-12-30") + pd.Timedelta(days=f)
            if 1980 <= dt.year <= 2040:
                return dt
        # Unix seconds / ms
        if f > 1e11:
            t = pd.to_datetime(f, unit="ms", errors="coerce")
            if pd.notna(t):
                return t
        if f > 1e9:
            t = pd.to_datetime(f, unit="s", errors="coerce")
            if pd.notna(t):
                return t
        # YYYYMMDD integer
        if f == int(f) and 19_000_101 <= int(f) <= 21_001_231:
            s = str(int(f))
            try:
                return pd.Timestamp(year=int(s[:4]), month=int(s[4:6]), day=int(s[6:8]))
            except (ValueError, OverflowError):
                pass

    s = str(val).strip()
    if not s:
        return pd.NaT
    parsed = pd.to_datetime(s, errors="coerce", dayfirst=True)
    if pd.isna(parsed):
        parsed = pd.to_datetime(s, errors="coerce", dayfirst=False)
    if pd.notna(parsed):
        y = int(parsed.year)
        if y < 1980:
            try:
                num = float(s.replace(",", ""))
                if 300 <= num < 1_000_000:
                    dt = pd.Timestamp("1899-12-30") + pd.Timedelta(days=num)
                    if 1980 <= dt.year <= 2040:
                        return dt
            except ValueError:
                pass
        return parsed
    return pd.NaT


def _coerce_date_series(series: pd.Series) -> pd.Series:
    return series.map(_coerce_single_date)


def _json_val(v: Any) -> Any:
    if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
        return None
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


INTERNAL_COLS = frozenset(
    {
        "risk_score",
        "risk_level",
        "risk_reasons",
        "amount_log",
        "is_round",
        "is_round_100",
        "first_digit",
        "benford_expected",
        "account_encoded",
        "user_encoded",
        "account_frequency",
        "user_frequency",
        "day_of_week",
        "hour",
        "is_night",
        "is_month_end",
        "is_weekend",
        "debit",
        "credit",
        "entry_type",
        "plain_english_reason",
    }
)


class R2RPatternEngine:
    WEIGHTS = {
        "isolation_forest": 30,
        "dbscan": 20,
        "z_score": 15,
        "rules": 25,
        "behavioural": 10,
    }

    HIGH_THRESHOLD = 65
    MEDIUM_THRESHOLD = 40

    def analyse(
        self,
        df: pd.DataFrame,
        client_history: dict | None = None,
        sensitivity: str = "balanced",
        materiality_amount: float = 0.0,
        materiality_pct: float = 0.0,
    ) -> dict:
        del client_history
        if len(df) < 10:
            return {"error": "Need at least 10 entries"}

        sens = (sensitivity or "balanced").strip().lower()
        if sens == "conservative":
            rank_med, rank_high = 0.82, 0.90
        elif sens == "strict":
            rank_med, rank_high = 0.91, 0.97
        else:
            rank_med, rank_high = 0.88, 0.94

        upload_count = len(df)
        df = self._prepare_features(df)
        mat_amt = max(0.0, float(materiality_amount or 0))
        mat_pct = max(0.0, float(materiality_pct or 0))
        pre_materiality_count = len(df)
        if mat_amt > 0:
            df = df.loc[df["amount"].abs() >= mat_amt].copy()
        if mat_pct > 0 and len(df) > 0:
            mx = float(df["amount"].abs().max()) or 0.0
            if mx > 0:
                thr = (mat_pct / 100.0) * mx
                df = df.loc[df["amount"].abs() >= thr].copy()
        if len(df) < 10:
            return {
                "error": (
                    "After materiality filter, fewer than 10 entries remain. "
                    "Lower materiality thresholds or upload more rows."
                )
            }

        materiality_meta = {
            "upload_row_count": upload_count,
            "rows_after_prepare": pre_materiality_count,
            "materiality_amount": mat_amt,
            "materiality_pct": mat_pct,
            "rows_analysed": len(df),
        }

        l1 = self._layer1_statistical(df)
        l2 = self._layer2_rules(df)
        l3 = self._layer3_ml(df)
        l4 = self._layer4_behavioural(df)

        df["risk_score"] = (
            l3["if_score"] * self.WEIGHTS["isolation_forest"] / 100
            + l3["dbscan_score"] * self.WEIGHTS["dbscan"] / 100
            + l1["z_score_norm"] * self.WEIGHTS["z_score"] / 100
            + l2["rules_score"] * self.WEIGHTS["rules"] / 100
            + l4["behav_score"] * self.WEIGHTS["behavioural"] / 100
        ) * 100
        df["risk_score"] = df["risk_score"].clip(0, 100)

        p85 = df["risk_score"].quantile(0.85)
        p60 = df["risk_score"].quantile(0.60)
        high_threshold = max(self.HIGH_THRESHOLD, float(p85) * 0.8)
        med_threshold = max(self.MEDIUM_THRESHOLD, float(p60) * 0.7)

        # Score-based tiers
        score_lvl = pd.Series("LOW", index=df.index, dtype=object)
        score_lvl[df["risk_score"] >= med_threshold] = "MEDIUM"
        score_lvl[df["risk_score"] >= high_threshold] = "HIGH"

        # Rank-based tiers for larger uploads (~8–15% flagged: top ~5% HIGH, next ~7% MEDIUM)
        rank_lvl = pd.Series("LOW", index=df.index, dtype=object)
        n = len(df)
        if n >= 80:
            rp = df["risk_score"].rank(method="average", pct=True)
            rank_lvl[rp >= rank_med] = "MEDIUM"
            rank_lvl[rp >= rank_high] = "HIGH"

        order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}

        def _max_lvl(a: str, b: str) -> str:
            return a if order[str(a)] >= order[str(b)] else b

        df["risk_level"] = [
            _max_lvl(score_lvl.iloc[i], rank_lvl.iloc[i]) for i in range(n)
        ]

        reasons = self._collect_reasons(df, l1, l2, l3, l4)
        df["risk_reasons"] = pd.Series(reasons, index=df.index)
        plain_list = [
            self._plain_english_for_row(df.loc[ix], reasons[pos])
            for pos, ix in enumerate(df.index)
        ]
        df["plain_english_reason"] = plain_list

        return self._build_output(df, l1, l2, l3, l4, materiality_meta=materiality_meta)

    def _prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        col_map: dict[str, str] = {}
        for col in df.columns:
            cl = col.lower().strip()
            if any(x in cl for x in ["amount", "amt", "value"]) and "account" not in cl:
                if "debit" in cl and "credit" not in cl:
                    col_map[col] = "debit"
                elif "credit" in cl and "debit" not in cl:
                    col_map[col] = "credit"
                elif any(x in cl for x in ["debit", "credit", "dr", "cr"]):
                    continue
                else:
                    col_map[col] = "amount"
            elif any(x in cl for x in ["date", "posted", "voucher_date"]):
                col_map[col] = "date"
            elif any(x in cl for x in ["account", "gl", "ledger"]) and "amount" not in cl:
                col_map[col] = "account"
            elif any(x in cl for x in ["user", "preparer", "posted_by", "created_by"]):
                col_map[col] = "user"
            elif any(x in cl for x in ["vendor", "party", "counterpart"]):
                col_map[col] = "vendor"
            elif any(x in cl for x in ["narration", "description", "memo", "ref"]):
                col_map[col] = "description"
            elif any(x in cl for x in ["type", "jetype", "voucher_type"]):
                col_map[col] = "entry_type"
            elif cl in ("id", "je_id", "entry_id", "journal_id"):
                col_map[col] = "entry_id"

        df = df.rename(columns=col_map)

        if "debit" in df.columns or "credit" in df.columns:
            d = pd.to_numeric(df.get("debit", 0), errors="coerce").fillna(0).abs()
            c = pd.to_numeric(df.get("credit", 0), errors="coerce").fillna(0).abs()
            df["amount"] = np.where(d > 0, d, c)
        elif "amount" in df.columns:
            df["amount"] = pd.to_numeric(
                df["amount"].astype(str).str.replace(",", "", regex=False),
                errors="coerce",
            ).fillna(0).abs()
        else:
            df["amount"] = 0.0

        if "date" in df.columns:
            df["date"] = _coerce_date_series(df["date"])
            df["day_of_week"] = df["date"].dt.dayofweek.fillna(3).astype(int)
            df["hour"] = df["date"].dt.hour
            df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
            df["is_month_end"] = (df["date"].dt.day >= 28).fillna(False).astype(int)
            hour_mode = float(df["hour"].eq(0).mean())
            if hour_mode > 0.85:
                df["is_night"] = 0
            else:
                df["is_night"] = df["hour"].apply(
                    lambda x: 1 if pd.notna(x) and (x >= 22 or x <= 5) else 0
                )
        else:
            df["day_of_week"] = 3
            df["is_weekend"] = 0
            df["is_month_end"] = 0
            df["is_night"] = 0

        df["amount_log"] = np.log1p(df["amount"].astype(float))
        df["is_round"] = (df["amount"] % 1000 == 0).astype(int)
        df["is_round_100"] = (df["amount"] % 100 == 0).astype(int)
        df["first_digit"] = df["amount"].apply(_first_digit_amount)
        df["benford_expected"] = df["first_digit"].map(BENFORD_EXPECTED).fillna(0.1)

        if "account" in df.columns:
            account_counts = df["account"].value_counts()
            df["account_frequency"] = df["account"].map(account_counts).fillna(1)
            df["account_encoded"] = pd.factorize(df["account"].astype(str))[0]
        else:
            df["account_frequency"] = 1
            df["account_encoded"] = 0

        if "user" in df.columns:
            user_counts = df["user"].value_counts()
            df["user_frequency"] = df["user"].map(user_counts).fillna(1)
            df["user_encoded"] = pd.factorize(df["user"].astype(str))[0]
        else:
            df["user_frequency"] = 1
            df["user_encoded"] = 0

        if "entry_id" not in df.columns:
            df["entry_id"] = [f"JE-{i+1:04d}" for i in range(len(df))]

        return df

    def _layer1_statistical(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        result["z_score"] = 0.0

        if "account" in df.columns:
            for account in df["account"].unique():
                mask = df["account"] == account
                acct_amounts = df.loc[mask, "amount"]
                if len(acct_amounts) >= 3:
                    mean = float(acct_amounts.mean())
                    std = float(acct_amounts.std())
                    if std > 0:
                        z = ((df.loc[mask, "amount"] - mean) / std).abs()
                        result.loc[mask, "z_score"] = z
        else:
            mean = float(df["amount"].mean())
            std = float(df["amount"].std())
            if std > 0:
                result["z_score"] = ((df["amount"] - mean) / std).abs()

        Q1 = df["amount"].quantile(0.25)
        Q3 = df["amount"].quantile(0.75)
        iqr = Q3 - Q1
        lower = Q1 - 1.5 * iqr
        upper = Q3 + 1.5 * iqr
        result["iqr_outlier"] = ((df["amount"] < lower) | (df["amount"] > upper)).astype(int)

        digit_counts = df["first_digit"].value_counts(normalize=True)

        def _ben_dev(d: int) -> float:
            if d not in BENFORD_EXPECTED:
                return 0.0
            return abs(float(digit_counts.get(d, 0)) - BENFORD_EXPECTED[d])

        dev = df["first_digit"].map(_ben_dev)
        result["benford_flag"] = (dev > 0.05).astype(int)

        max_z = float(result["z_score"].max()) or 0.0
        if max_z > 0:
            result["z_score_norm"] = (result["z_score"] / max_z).clip(0, 1)
        else:
            result["z_score_norm"] = 0.0

        return result

    def _layer2_rules(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        rules_score = pd.Series(0.0, index=df.index)
        flags: list[list[str]] = [[] for _ in range(len(df))]
        idx_pos = {ix: pos for pos, ix in enumerate(df.index)}

        def add_flag(ix: Any, msg: str) -> None:
            flags[idx_pos[ix]].append(msg)

        if "is_weekend" in df.columns:
            mask = df["is_weekend"] == 1
            rules_score[mask] += 15
            for ix in df.index[mask]:
                add_flag(ix, "Weekend posting")

        if "is_night" in df.columns:
            mask = df["is_night"] == 1
            rules_score[mask] += 20
            for ix in df.index[mask]:
                add_flag(ix, "Night posting")

        if "is_round" in df.columns:
            mask = (df["is_round"] == 1) & (df["amount"] >= 10000)
            rules_score[mask] += 10
            for ix in df.index[mask]:
                add_flag(ix, "Round number")

        p95 = df["amount"].quantile(0.95)
        mask = df["amount"] >= p95
        rules_score[mask] += 20
        for ix in df.index[mask]:
            add_flag(ix, "High value entry")

        p05 = df["amount"].quantile(0.05)
        if float(p05) > 0:
            mask = (df["amount"] <= p05) & (df["amount"] > 0)
            rules_score[mask] += 8
            for ix in df.index[mask]:
                add_flag(ix, "Unusually small amount")

        if "is_month_end" in df.columns and "user" in df.columns:
            mask_me = df["is_month_end"] == 1
            for user in df["user"].unique():
                user_mask = df["user"] == user
                user_total = int(user_mask.sum())
                user_month_end = int((user_mask & mask_me).sum())
                if user_total > 5 and user_month_end / user_total > 0.5:
                    hit = user_mask & mask_me
                    rules_score[hit] += 12
                    for ix in df.index[hit]:
                        add_flag(ix, "High month-end concentration")

        # Near-duplicate: same account + same amount, another posting within 3 days.
        # IMPORTANT: avoid O(n²) full-frame scans + iterrows (was freezing multi-minute on ~500+ rows).
        if "date" in df.columns and "account" in df.columns:
            df_dup = df[["account", "amount", "date"]].copy()
            df_dup = df_dup[df_dup["date"].notna()]
            if len(df_dup) >= 2:
                grp_sizes = df_dup.groupby(["account", "amount"], sort=False).size()
                multi_keys = grp_sizes[grp_sizes > 1].index
                dup_groups = df_dup.groupby(["account", "amount"], sort=False)
                for key in multi_keys:
                    grp = dup_groups.get_group(key).sort_values("date")
                    idxs = grp.index.to_numpy()
                    ts = grp["date"].tolist()
                    m = len(idxs)
                    if m < 2:
                        continue
                    if m > 200:
                        tmin = grp["date"].min()
                        tmax = grp["date"].max()
                        if pd.notna(tmin) and pd.notna(tmax) and (tmax - tmin).days <= 3:
                            rules_score.loc[idxs] = rules_score.loc[idxs] + 25
                            for ix in idxs:
                                add_flag(ix, "Potential duplicate")
                        continue
                    for i in range(m):
                        t_i = pd.Timestamp(ts[i]) if pd.notna(ts[i]) else pd.NaT
                        if pd.isna(t_i):
                            continue
                        hit = False
                        for j in range(m):
                            if i == j or pd.isna(ts[j]):
                                continue
                            t_j = pd.Timestamp(ts[j])
                            if abs((t_j - t_i).days) <= 3:
                                hit = True
                                break
                        if hit:
                            ix = idxs[i]
                            rules_score.loc[ix] += 25
                            add_flag(ix, "Potential duplicate")

        suspicious = [
            "correction",
            "reverse",
            "adj",
            "error",
            "write off",
            "writeoff",
            "test",
            "misc",
            "other",
            "sundry",
            "temp",
            "clearing",
        ]
        if "description" in df.columns:
            desc_lower = df["description"].astype(str).str.lower()
            for word in suspicious:
                mask = desc_lower.str.contains(word, na=False)
                rules_score[mask] += 8
                for ixx in df.index[mask]:
                    add_flag(ixx, f"Suspicious keyword: {word}")

        if "account_frequency" in df.columns:
            rare_threshold = df["account_frequency"].quantile(0.10)
            mask = df["account_frequency"] <= rare_threshold
            rules_score[mask] += 15
            for ix in df.index[mask]:
                add_flag(ix, "Rare GL account")

        if "user" in df.columns and "account" in df.columns:
            user_account_count = df.groupby("user")["account"].nunique()
            high_account_users = user_account_count[
                user_account_count > user_account_count.quantile(0.90)
            ].index
            mask = df["user"].isin(high_account_users)
            rules_score[mask] += 10
            for ix in df.index[mask]:
                add_flag(ix, "User posting to many accounts")

        max_rules = float(rules_score.max()) or 0.0
        if max_rules > 0:
            result["rules_score"] = (rules_score / max_rules).clip(0, 1)
        else:
            result["rules_score"] = 0.0

        result["rule_flags"] = flags
        result["rules_raw"] = rules_score
        return result

    def _layer3_ml(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        feature_cols = [
            "amount_log",
            "is_weekend",
            "is_night",
            "is_round",
            "is_month_end",
            "account_encoded",
            "user_encoded",
            "account_frequency",
        ]
        available = [c for c in feature_cols if c in df.columns]
        n = len(df)

        if len(available) < 2:
            result["if_score"] = 0.5
            result["dbscan_score"] = 0.0
            result["if_anomaly"] = 0
            result["lof_score"] = 0.0
            return result

        X = df[available].fillna(0).astype(float)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        contamination = 0.15 if n >= 50 else 0.20
        # Fewer trees = much faster on typical uploads (hundreds–few thousands of rows) with negligible quality loss.
        n_trees = 200 if n >= 5000 else (120 if n >= 2000 else 80)
        # n_jobs=1 avoids rare hangs / oversubscription on Windows + BLAS when many sklearn jobs run.
        iso = IsolationForest(
            n_estimators=n_trees,
            contamination=contamination,
            random_state=42,
            n_jobs=1,
        )
        iso.fit(X_scaled)
        iso_pred = iso.predict(X_scaled)
        iso_scores = iso.decision_function(X_scaled)
        lo = float(iso_scores.min())
        hi = float(iso_scores.max())
        denom = hi - lo + 1e-9
        iso_normalized = 1 - (iso_scores - lo) / denom
        result["if_score"] = iso_normalized
        result["if_anomaly"] = (iso_pred == -1).astype(int)

        dbscan_cols = ["amount_log", "account_encoded"]
        if "is_weekend" in df.columns:
            dbscan_cols.append("is_weekend")
        X_db = df[[c for c in dbscan_cols if c in df.columns]].fillna(0).astype(float)
        X_db_scaled = StandardScaler().fit_transform(X_db)
        eps = 0.5 if n < 100 else (0.8 if n < 500 else 1.0)
        min_samples = max(3, int(n * 0.02))
        db_labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(X_db_scaled)
        result["dbscan_score"] = (db_labels == -1).astype(float)
        result["dbscan_cluster"] = db_labels

        # LOF is O(n^2) in n; cap neighbors and skip very large uploads so the API returns reliably.
        if n >= 20 and n <= 4000:
            nn = min(15, max(5, min(20, n // 8)))
            lof = LocalOutlierFactor(
                n_neighbors=nn,
                contamination=0.15,
            )
            lof_pred = lof.fit_predict(X_scaled)
            result["lof_score"] = (lof_pred == -1).astype(float)
        else:
            result["lof_score"] = 0.0

        return result

    def _layer4_behavioural(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        behav_score = pd.Series(0.0, index=df.index)

        if "user" not in df.columns:
            result["behav_score"] = 0.0
            return result

        for user in df["user"].unique():
            user_mask = df["user"] == user
            user_entries = df[user_mask]
            n_user = len(user_entries)
            if n_user < 3:
                continue

            user_mean = float(user_entries["amount"].mean())
            user_std = float(user_entries["amount"].std())
            if user_std > 0:
                user_z = ((df.loc[user_mask, "amount"] - user_mean) / user_std).abs()
                behav_score[user_mask] += (user_z.clip(0, 5) / 5 * 0.5)

            if "hour" in df.columns:
                user_hours = user_entries["hour"].dropna()
                if len(user_hours) >= 3:
                    typical_start = user_hours.quantile(0.10)
                    typical_end = user_hours.quantile(0.90)
                    for i in user_entries.index:
                        entry_hour = df.loc[i, "hour"]
                        if pd.notna(entry_hour):
                            if entry_hour < typical_start - 2 or entry_hour > typical_end + 2:
                                behav_score.loc[i] += 0.3

            if "date" in df.columns:
                user_daily = user_entries.groupby(user_entries["date"].dt.date).size()
                if len(user_daily) >= 3:
                    avg_daily = float(user_daily.mean())
                    for date, count in user_daily.items():
                        if count > avg_daily * 3:
                            spike_mask = user_mask & (df["date"].dt.date == date)
                            behav_score[spike_mask] += 0.4

        result["behav_score"] = behav_score.clip(0, 1)
        return result

    def _plain_english_for_row(self, row: pd.Series, reason_list: list[str]) -> str:
        """Sales-friendly one-liner; avoids raw ML model names in exports."""
        n = len(reason_list) if reason_list else 1
        acc = str(row.get("account", "") or "")
        user = str(row.get("user", "") or "")
        ul = user.lower()
        al = acc.lower()
        is_we = int(row.get("is_weekend", 0) or 0) == 1
        is_night = int(row.get("is_night", 0) or 0) == 1
        amt = float(row.get("amount", 0) or 0)

        ctx: list[str] = []
        if amt >= 100_000:
            ctx.append("large amount")
        elif amt >= 25_000:
            ctx.append("notable amount")
        if "suspense" in al:
            ctx.append("posted to Suspense")
        elif any(x in al for x in ("clearing", "misc", "sundry", "temp")):
            ctx.append("posted to a clearing/misc-type account")
        if "new_user" in ul or "new user" in ul:
            ctx.append("by a new or infrequent user")
        if is_we:
            ctx.append("on a weekend")
        if is_night:
            ctx.append("outside typical business hours")

        mapped: list[str] = []
        for r in reason_list:
            rl = r.lower()
            if "isolation forest" in rl:
                mapped.append("unusual vs typical patterns in this file")
            elif "dbscan" in rl:
                mapped.append("does not match usual account/amount groupings")
            elif "local outlier" in rl:
                mapped.append("rare mix of amount, timing, and account vs peers")
            elif "amount outlier" in rl or "z=" in rl:
                mapped.append("amount is extreme for this account")
            elif "iqr" in rl:
                mapped.append("amount outside normal spread for this upload")
            elif "benford" in rl:
                mapped.append("leading-digit pattern differs from expected distribution")
            elif "behaviour" in rl or "behavior" in rl:
                mapped.append("posting behaviour differs from this user's norm")
            elif "weekend posting" in rl:
                mapped.append("weekend timing")
            elif "night posting" in rl:
                mapped.append("off-hours timing")
            elif "round number" in rl:
                mapped.append("large round-number amount")
            elif "high value" in rl:
                mapped.append("top-tier amount in this period")
            elif "duplicate" in rl:
                mapped.append("possible duplicate or near-duplicate")
            elif "suspicious keyword" in rl:
                mapped.append("sensitive wording in narration")
            elif "rare gl" in rl:
                mapped.append("uncommon GL account for this file")
            elif "many accounts" in rl:
                mapped.append("user touches many accounts")
            elif "month-end" in rl:
                mapped.append("heavy month-end concentration for this user")
            else:
                short = r.split("(")[0].strip()
                if len(short) > 90:
                    short = short[:87] + "…"
                mapped.append(short.lower())

        seen: set[str] = set()
        uniq: list[str] = []
        for p in mapped:
            if p not in seen:
                seen.add(p)
                uniq.append(p)

        ctx_s = ", ".join(ctx) if ctx else ""
        tail = "; ".join(uniq[:3])
        sig = f"{n} risk signal{'s' if n != 1 else ''}"
        if ctx_s and tail:
            return f"{ctx_s.capitalize()} — {tail} — {sig}."
        if tail:
            return f"{tail.capitalize()} — {sig}."
        if ctx_s:
            return f"{ctx_s.capitalize()} — {sig}."
        return f"Elevated composite risk — {sig}; obtain supporting documentation."

    def _collect_reasons(
        self,
        df: pd.DataFrame,
        l1: pd.DataFrame,
        l2: pd.DataFrame,
        l3: pd.DataFrame,
        l4: pd.DataFrame,
    ) -> list[list[str]]:
        reasons: list[list[str]] = []
        for pos in range(len(df)):
            entry_reasons: list[str] = []
            if "rule_flags" in l2.columns:
                entry_reasons.extend(l2["rule_flags"].iloc[pos])
            if "if_anomaly" in l3.columns and int(l3["if_anomaly"].iloc[pos]) == 1:
                if_score = float(l3["if_score"].iloc[pos])
                entry_reasons.append(f"ML Isolation Forest ({if_score:.0%} anomaly)")
            if "dbscan_score" in l3.columns and float(l3["dbscan_score"].iloc[pos]) >= 0.5:
                entry_reasons.append("DBSCAN: no cluster match")
            if "lof_score" in l3.columns and float(l3["lof_score"].iloc[pos]) >= 0.5:
                entry_reasons.append("Local Outlier Factor")
            z = float(l1["z_score"].iloc[pos])
            if z > 2.5:
                entry_reasons.append(f"Amount outlier (Z={z:.1f})")
            if "iqr_outlier" in l1.columns and int(l1["iqr_outlier"].iloc[pos]) == 1:
                entry_reasons.append("IQR outlier")
            if "benford_flag" in l1.columns and int(l1["benford_flag"].iloc[pos]) == 1:
                entry_reasons.append("Benford deviation")
            if float(l4["behav_score"].iloc[pos]) > 0.4:
                entry_reasons.append("User behaviour deviation")
            reasons.append(entry_reasons)
        return reasons

    def _row_dict(self, row: pd.Series, original_cols: list[str]) -> dict[str, Any]:
        entry: dict[str, Any] = {}
        for col in original_cols:
            if col in row.index:
                entry[col] = _json_val(row.get(col))
        entry["risk_score"] = round(float(row["risk_score"]), 1)
        entry["risk_level"] = str(row["risk_level"])
        rr = row.get("risk_reasons", [])
        entry["risk_reasons"] = list(rr) if isinstance(rr, list) else []
        per = row.get("plain_english_reason")
        if per is not None and not (isinstance(per, float) and np.isnan(per)):
            entry["plain_english_reason"] = str(per)
        return entry

    def _build_output(
        self,
        df: pd.DataFrame,
        l1: pd.DataFrame,
        l2: pd.DataFrame,
        l3: pd.DataFrame,
        l4: pd.DataFrame,
        materiality_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        total = len(df)
        high = int((df["risk_level"] == "HIGH").sum())
        medium = int((df["risk_level"] == "MEDIUM").sum())
        low = int((df["risk_level"] == "LOW").sum())

        original_cols = [c for c in df.columns if c not in INTERNAL_COLS]

        entries_scored = [self._row_dict(df.loc[ix], original_cols) for ix in df.index]

        flagged_df = df[df["risk_level"].isin(["HIGH", "MEDIUM"])].sort_values(
            "risk_score", ascending=False
        )
        flagged_entries = [self._row_dict(flagged_df.loc[ix], original_cols) for ix in flagged_df.index][:100]

        trend: list[dict[str, Any]] = []
        if "date" in df.columns:
            try:
                dfc = df.copy()
                dts = pd.to_datetime(dfc["date"], errors="coerce")
                dfc["_ds"] = dts.dt.strftime("%Y-%m-%d")
                daily = (
                    dfc.dropna(subset=["_ds"])
                    .groupby("_ds")
                    .agg(
                        total=("risk_score", "count"),
                        high=("risk_level", lambda x: int((x == "HIGH").sum())),
                        avg_score=("risk_score", "mean"),
                    )
                    .reset_index()
                    .rename(columns={"_ds": "date_str"})
                )
                trend = daily.to_dict("records")
            except Exception:
                trend = []

        score_bins = pd.cut(
            df["risk_score"],
            bins=[0, 20, 40, 60, 80, 100],
            labels=["0-20", "20-40", "40-60", "60-80", "80-100"],
        )
        dist = score_bins.value_counts().sort_index()
        score_distribution = [
            {"band": str(k), "count": int(v)} for k, v in dist.items()
        ]

        vendor_patterns: list[dict[str, Any]] = []
        if "vendor" in df.columns:
            vendor_risk = (
                df.groupby("vendor")
                .agg(
                    entries=("risk_score", "count"),
                    avg_score=("risk_score", "mean"),
                    high_count=("risk_level", lambda x: int((x == "HIGH").sum())),
                )
                .sort_values("avg_score", ascending=False)
            )
            vendor_patterns = vendor_risk.head(10).reset_index().to_dict("records")

        user_patterns: list[dict[str, Any]] = []
        if "user" in df.columns:
            user_risk = (
                df.groupby("user")
                .agg(
                    entries=("risk_score", "count"),
                    avg_score=("risk_score", "mean"),
                    high_count=("risk_level", lambda x: int((x == "HIGH").sum())),
                )
                .sort_values("avg_score", ascending=False)
            )
            user_patterns = user_risk.head(10).reset_index().to_dict("records")

        rules_flagged = int((l2["rules_raw"] > 0).sum()) if "rules_raw" in l2.columns else 0
        behavioural_flagged = int((l4["behav_score"] > 0.2).sum())

        model_breakdown = {
            "isolation_forest_detected": int(l3["if_anomaly"].sum()),
            "dbscan_noise_points": int((l3["dbscan_score"] >= 0.5).sum()),
            "local_outlier_detected": int((l3["lof_score"] >= 0.5).sum()),
            "rules_engine_flagged_rows": rules_flagged,
            "behavioural_anomalies": behavioural_flagged,
        }

        summary: dict[str, Any] = {
            "total_entries": total,
            "high_risk": high,
            "medium_risk": medium,
            "low_risk": low,
            "flagged_pct": round((high + medium) / total * 100, 1) if total else 0.0,
            "high_pct": round(high / total * 100, 1) if total else 0.0,
            "models_used": [
                "Isolation Forest",
                "DBSCAN",
                "Local Outlier Factor",
                "Z-Score (per account)",
                "IQR Outlier Detection",
                "Rules Engine (10+ rules)",
                "Behavioural Profiling",
            ],
        }
        if materiality_meta:
            summary["materiality"] = materiality_meta

        return {
            "summary": summary,
            "flagged_entries": flagged_entries,
            "entries_scored": entries_scored,
            "trend": trend,
            "score_distribution": score_distribution,
            "vendor_patterns": vendor_patterns,
            "user_patterns": user_patterns,
            "model_breakdown": model_breakdown,
        }
