"""
ML-based bank transaction classifier.

Workflow
--------
1. train_model(org_id, account_id, transactions)
   - Accepts list[dict] with keys: description, ledger_name
   - Trains TF-IDF + Voting(LogReg, RandomForest) pipeline
   - Saves model + metadata to disk via joblib

2. classify_transactions(org_id, account_id, transactions)
   - Returns each transaction enriched with:
       predicted_ledger, confidence, tier
   - Tier logic: auto ≥ 0.90 | review 0.70–0.89 | manual < 0.70

3. model_status(org_id, account_id)
   - Returns metadata about the trained model
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np

logger = logging.getLogger(__name__)

# ── Bank-specific narration column map ───────────────────────────────────────
# Used by extract_narration() as a first-priority lookup before generic fallbacks.

BANK_COLUMN_MAP: dict[str, dict[str, str]] = {
    "HDFC":     {"narration": "Narration"},
    "ICICI":    {"narration": "Transaction Remarks"},
    "SBI":      {"narration": "Description"},
    "AXIS":     {"narration": "PARTICULARS"},
    "KOTAK":    {"narration": "Description"},
    "KOTAK_CURRENT": {"narration": "Description"},
    "YES":      {"narration": "Particulars"},
    "INDUSIND": {"narration": "Narration"},
    "FEDERAL":  {"narration": "Particulars"},
    "PNB":      {"narration": "Narration"},
}

# All column names that might hold the narration/description, in priority order
_NARRATION_COLS = [
    "narration", "description", "particulars",
    "Narration", "Description", "Particulars",
    "Transaction Remarks", "PARTICULARS", "Details",
    "transaction_remarks", "details", "remarks", "memo",
]


def extract_narration(row: dict, bank: str = "") -> str:
    """
    Extract narration from a parsed bank row using bank-specific column mapping.
    Falls back through common column names if the bank-specific column is missing.
    Never returns None — always returns a string (empty at worst).
    """
    bank_key = bank.upper().strip()

    # 1. Bank-specific column first
    bank_map = BANK_COLUMN_MAP.get(bank_key, {})
    narration_col = bank_map.get("narration", "")
    if narration_col:
        value = row.get(narration_col) or row.get(narration_col.lower()) or ""
        if value:
            return str(value).strip()

    # 2. Generic fallback chain
    for col in _NARRATION_COLS:
        value = row.get(col, "")
        if value:
            return str(value).strip()

    return ""


# ── Model storage path ────────────────────────────────────────────────────────

_MODEL_DIR = Path(os.getenv("BANK_ML_MODEL_DIR", "/tmp/bank_ml_models"))
_MODEL_DIR.mkdir(parents=True, exist_ok=True)

_AUTO_THRESHOLD   = float(os.getenv("BANK_ML_AUTO_THRESHOLD",   "0.90"))
_REVIEW_THRESHOLD = float(os.getenv("BANK_ML_REVIEW_THRESHOLD", "0.70"))


def _model_path(org_id: str, account_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", f"{org_id}__{account_id}")
    return _MODEL_DIR / f"{safe}.joblib"


def _meta_path(org_id: str, account_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", f"{org_id}__{account_id}")
    return _MODEL_DIR / f"{safe}_meta.json"


# ── Text normalisation ────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    """Lower-case, strip digits/special chars, collapse spaces."""
    t = str(text).lower()
    t = re.sub(r"[/\-_]", " ", t)           # slashes / dashes → spaces
    t = re.sub(r"\d{6,}", " ", t)           # long ref numbers → strip
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


# ── Training ──────────────────────────────────────────────────────────────────

def train_model(
    org_id: str,
    account_id: str,
    transactions: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Train a Voting(LogReg, RandomForest) classifier on historical bank transactions.

    Parameters
    ----------
    transactions : list[dict]
        Each dict must contain at minimum:
        - ``description`` (str)  — bank narration / transaction remarks
        - ``ledger_name``  (str) — confirmed Tally ledger

    Returns
    -------
    dict  with keys: status, classes, n_samples, accuracy, model_path
    """
    from sklearn.ensemble import RandomForestClassifier, VotingClassifier
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import LabelEncoder

    if not transactions:
        raise ValueError("No training transactions provided.")

    texts  = [
        _clean(t.get("description") or extract_narration(t, t.get("bank", "")))
        for t in transactions
    ]
    labels = [str(t.get("ledger_name", "Unclassified")).strip() for t in transactions]

    # Need ≥ 2 classes and ≥ 2 samples per class for CV
    from collections import Counter
    counts = Counter(labels)
    valid_labels = {k for k, v in counts.items() if v >= 1}
    filtered = [(x, y) for x, y in zip(texts, labels) if y in valid_labels]
    if len(filtered) < 4:
        raise ValueError(
            f"Need at least 4 labelled transactions to train a model (got {len(filtered)})."
        )
    texts, labels = zip(*filtered)
    texts  = list(texts)
    labels = list(labels)

    le = LabelEncoder()
    y  = le.fit_transform(labels)

    tfidf = TfidfVectorizer(
        analyzer="word",
        ngram_range=(1, 3),
        min_df=1,
        max_features=10_000,
        sublinear_tf=True,
    )

    logreg = LogisticRegression(
        max_iter=1000,
        C=1.0,
        class_weight="balanced",
        solver="lbfgs",
        multi_class="auto",
    )
    rf = RandomForestClassifier(
        n_estimators=200,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )

    # Voting (soft if both support predict_proba)
    estimators = [("lr", logreg), ("rf", rf)]
    voter = VotingClassifier(estimators=estimators, voting="soft")

    pipeline = Pipeline([("tfidf", tfidf), ("clf", voter)])

    # Cross-validation accuracy (only when enough samples)
    accuracy = None
    n_splits = min(5, len(set(labels)))
    if n_splits >= 2 and len(texts) >= n_splits * 2:
        try:
            scores = cross_val_score(pipeline, texts, y, cv=n_splits, scoring="accuracy")
            accuracy = float(np.mean(scores))
        except Exception as cv_err:
            logger.warning("CV failed (non-fatal): %s", cv_err)

    pipeline.fit(texts, y)

    # Persist
    mp = _model_path(org_id, account_id)
    joblib.dump({"pipeline": pipeline, "label_encoder": le}, mp)

    meta = {
        "org_id":      org_id,
        "account_id":  account_id,
        "n_samples":   len(texts),
        "classes":     list(le.classes_),
        "accuracy":    accuracy,
        "trained_at":  datetime.utcnow().isoformat(),
        "model_path":  str(mp),
        "thresholds":  {"auto": _AUTO_THRESHOLD, "review": _REVIEW_THRESHOLD},
    }
    with open(_meta_path(org_id, account_id), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    logger.info(
        "Model trained: org=%s acc=%s classes=%d n=%d",
        org_id, account_id, len(le.classes_), len(texts),
    )
    return meta


# ── Inference ─────────────────────────────────────────────────────────────────

def _tier(conf: float) -> str:
    if conf >= _AUTO_THRESHOLD:
        return "auto"
    if conf >= _REVIEW_THRESHOLD:
        return "review"
    return "manual"


def classify_transactions(
    org_id: str,
    account_id: str,
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Classify bank transactions using a previously trained model.

    Returns the input list enriched with:
    - ``predicted_ledger`` (str)
    - ``confidence``        (float  0–1)
    - ``tier``              ('auto' | 'review' | 'manual')
    - ``top_suggestions``   (list[dict] — top-3 alternatives)
    """
    mp = _model_path(org_id, account_id)
    if not mp.exists():
        raise FileNotFoundError(
            f"No trained model found for org={org_id} account={account_id}. "
            "Please train the model first."
        )

    bundle  = joblib.load(mp)
    pipe    = bundle["pipeline"]
    le      = bundle["label_encoder"]

    texts   = [
        _clean(t.get("description") or extract_narration(t, t.get("bank", "")))
        for t in transactions
    ]
    proba   = pipe.predict_proba(texts)   # shape (n, n_classes)
    preds   = np.argmax(proba, axis=1)

    results = []
    for txn, prob_row, pred_idx in zip(transactions, proba, preds):
        conf    = float(prob_row[pred_idx])
        label   = le.inverse_transform([pred_idx])[0]
        tier    = _tier(conf)

        # Top-3 suggestions
        top_idx = np.argsort(prob_row)[::-1][:3]
        top_sug = [
            {"ledger": le.inverse_transform([i])[0], "confidence": float(prob_row[i])}
            for i in top_idx
        ]

        results.append({
            **txn,
            "predicted_ledger": label,
            "confidence":       round(conf, 4),
            "tier":             tier,
            "top_suggestions":  top_sug,
            # Editable field (populated from ledger_name if already known, else from prediction)
            "ledger_name":      txn.get("ledger_name") or label,
            "approval_status":  txn.get("approval_status", "pending"),
        })

    return results


# ── Model status ──────────────────────────────────────────────────────────────

def model_status(org_id: str, account_id: str) -> dict[str, Any]:
    """Return metadata about the trained model (or {'exists': False} if none)."""
    mp   = _model_path(org_id, account_id)
    meta_p = _meta_path(org_id, account_id)

    if not mp.exists():
        return {"exists": False, "org_id": org_id, "account_id": account_id}

    if meta_p.exists():
        with open(meta_p, encoding="utf-8") as f:
            meta = json.load(f)
        meta["exists"] = True
        return meta

    # Model file exists but no meta — synthesise basics
    bundle = joblib.load(mp)
    le     = bundle.get("label_encoder")
    classes = list(le.classes_) if le is not None else []
    return {
        "exists":      True,
        "org_id":      org_id,
        "account_id":  account_id,
        "classes":     classes,
        "n_samples":   None,
        "accuracy":    None,
        "trained_at":  None,
        "model_path":  str(mp),
    }


# ── Sync corrections (re-train / update) ─────────────────────────────────────

def sync_corrections(
    org_id: str,
    account_id: str,
    corrections: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Accept human corrections and merge into training set, then re-train.

    corrections: list[dict] with keys: description, ledger_name (corrected)
    """
    mp = _model_path(org_id, account_id)
    existing_transactions: list[dict[str, Any]] = []

    if mp.exists():
        bundle = joblib.load(mp)
        le     = bundle.get("label_encoder")
        pipe   = bundle.get("pipeline")
        # Reconstruct training pairs from stored vocabulary (best-effort)
        # For simplicity we re-use whatever was persisted in meta
        meta_p = _meta_path(org_id, account_id)
        if meta_p.exists():
            with open(meta_p, encoding="utf-8") as f:
                meta = json.load(f)
            # stored_samples may be present if we enriched meta; otherwise skip
            existing_transactions = meta.get("stored_samples", [])

    # Merge: corrections override existing by description key
    desc_map: dict[str, dict] = {
        _clean(t.get("description") or extract_narration(t, t.get("bank", ""))): t
        for t in existing_transactions
    }
    for c in corrections:
        raw_desc = c.get("description") or extract_narration(c, c.get("bank", ""))
        key = _clean(raw_desc)
        if key:
            desc_map[key] = {
                "description": raw_desc,
                "ledger_name": c["ledger_name"],
            }

    merged = list(desc_map.values())
    result = train_model(org_id, account_id, merged)

    # Store merged samples in meta for future incremental updates
    meta_p = _meta_path(org_id, account_id)
    if meta_p.exists():
        with open(meta_p, "r+", encoding="utf-8") as f:
            meta = json.load(f)
            meta["stored_samples"] = merged
            f.seek(0)
            json.dump(meta, f, indent=2)
            f.truncate()

    result["corrections_applied"] = len(corrections)
    return result
