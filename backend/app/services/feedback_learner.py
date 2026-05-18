"""
feedback_learner.py — Fix 5: False-positive feedback loop

Auditor corrections retune per-client layer weights so the ensemble
de-emphasises layers that produce too many false positives for that client.

Weight update rule (gradient-free):
  - False positive (auditor says LOW for a flagged entry):
      reduce weight of the dominant layer by LEARNING_RATE
  - True positive (auditor confirms flag is correct):
      increase weight of dominant layer by LEARNING_RATE / 2
  - Weights are renormalised to sum to 100 after each batch

Per-client weights are persisted in the AccountBaseline table as a JSON
blob keyed by company_id.  If no row exists, DEFAULT_WEIGHTS are used.
"""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_WEIGHTS: dict[str, float] = {
    "statistical": 25.0,
    "ml":          35.0,
    "pattern":     20.0,
    "behavioral":  20.0,
}

LEARNING_RATE = 0.05   # 5 % shift per feedback event
MIN_WEIGHT    = 10.0   # floor — no layer ever ignored
MAX_WEIGHT    = 50.0   # ceiling — no single layer dominates


# ── FeedbackLearner ───────────────────────────────────────────────────────────

class FeedbackLearner:
    """
    Loads, updates, and persists per-client ensemble layer weights based on
    auditor accept/reject decisions.

    Usage
    -----
    learner = FeedbackLearner()
    weights = learner.load_weights(company_id, db)
    result  = learner.process_feedback(company_id, feedback_batch, db)
    metrics = learner.precision_recall(feedback_batch)
    """

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, float]] = {}

    # ── Persistence helpers ───────────────────────────────────────────────────

    def load_weights(self, client_id: str, db: Any) -> dict[str, float]:
        """
        Return current weights for *client_id*.

        Tries to read a JSON blob from AccountBaseline.meta_json
        (column added by migration; falls back gracefully if column absent).
        In-process cache avoids repeated DB hits within a request.
        """
        if client_id in self._cache:
            return dict(self._cache[client_id])

        weights = dict(DEFAULT_WEIGHTS)
        try:
            from app.models.history_models import AccountBaseline  # avoid circular at module load
            row = (
                db.query(AccountBaseline)
                .filter(AccountBaseline.company_id == client_id)
                .first()
            )
            if row and hasattr(row, "meta_json") and row.meta_json:
                stored = json.loads(row.meta_json) if isinstance(row.meta_json, str) else row.meta_json
                if isinstance(stored, dict) and "layer_weights" in stored:
                    candidate = stored["layer_weights"]
                    # validate shape
                    if all(k in candidate for k in DEFAULT_WEIGHTS):
                        weights = {k: float(candidate[k]) for k in DEFAULT_WEIGHTS}
                        log.debug(
                            "[FeedbackLearner] Loaded weights for %s: %s", client_id, weights
                        )
        except Exception as exc:
            log.warning("[FeedbackLearner] Could not load weights for %s: %s", client_id, exc)

        self._cache[client_id] = weights
        return dict(weights)

    def _save_weights(self, client_id: str, weights: dict[str, float], db: Any) -> None:
        """Persist updated weights back to AccountBaseline.meta_json."""
        try:
            from app.models.history_models import AccountBaseline
            row = (
                db.query(AccountBaseline)
                .filter(AccountBaseline.company_id == client_id)
                .first()
            )
            if row is None:
                row = AccountBaseline(company_id=client_id)
                db.add(row)

            existing: dict[str, Any] = {}
            if hasattr(row, "meta_json") and row.meta_json:
                existing = json.loads(row.meta_json) if isinstance(row.meta_json, str) else row.meta_json or {}

            existing["layer_weights"] = weights
            if hasattr(row, "meta_json"):
                row.meta_json = json.dumps(existing)
            db.commit()
            self._cache[client_id] = dict(weights)
            log.debug("[FeedbackLearner] Saved weights for %s: %s", client_id, weights)
        except Exception as exc:
            log.warning("[FeedbackLearner] Could not save weights for %s: %s", client_id, exc)
            try:
                db.rollback()
            except Exception:
                pass

    # ── Core update logic ─────────────────────────────────────────────────────

    @staticmethod
    def _dominant_layer(layer_scores: dict[str, float]) -> str | None:
        """Return the layer with the highest score contribution."""
        if not layer_scores:
            return None
        return max(layer_scores, key=lambda k: float(layer_scores.get(k, 0)))

    @staticmethod
    def _normalise(weights: dict[str, float]) -> dict[str, float]:
        """Rescale weights so they sum to 100, respecting MIN/MAX bounds."""
        # Clamp first
        clamped = {k: max(MIN_WEIGHT, min(MAX_WEIGHT, v)) for k, v in weights.items()}
        total = sum(clamped.values())
        if total == 0:
            return dict(DEFAULT_WEIGHTS)
        factor = 100.0 / total
        scaled = {k: v * factor for k, v in clamped.items()}
        # Re-clamp after scaling (edge case when one layer is at ceiling)
        scaled = {k: max(MIN_WEIGHT, min(MAX_WEIGHT, v)) for k, v in scaled.items()}
        return scaled

    def _apply_update(
        self,
        weights: dict[str, float],
        dominant_layer: str | None,
        is_false_positive: bool,
    ) -> dict[str, float]:
        """
        Gradient-free weight shift:
        - FP → reduce dominant layer weight by LEARNING_RATE × current_weight
        - TP → increase dominant layer weight by (LEARNING_RATE/2) × current_weight
        """
        if dominant_layer is None or dominant_layer not in weights:
            return weights

        w = dict(weights)
        shift = w[dominant_layer] * LEARNING_RATE

        if is_false_positive:
            w[dominant_layer] = max(MIN_WEIGHT, w[dominant_layer] - shift)
            log.debug(
                "[FeedbackLearner] FP — reducing %s by %.2f → %.2f",
                dominant_layer, shift, w[dominant_layer],
            )
        else:
            w[dominant_layer] = min(MAX_WEIGHT, w[dominant_layer] + shift * 0.5)
            log.debug(
                "[FeedbackLearner] TP — boosting %s by %.2f → %.2f",
                dominant_layer, shift * 0.5, w[dominant_layer],
            )

        return self._normalise(w)

    # ── Public API ────────────────────────────────────────────────────────────

    def process_feedback(
        self,
        client_id: str,
        feedback_batch: list[dict[str, Any]],
        db: Any,
    ) -> dict[str, Any]:
        """
        Process a list of auditor decisions and update client weights.

        Each item in *feedback_batch* must have:
        {
            "journal_id":    str,
            "auditor_label": "TRUE_POSITIVE" | "FALSE_POSITIVE" | "IGNORE",
            "layer_scores":  {"statistical": x, "ml": x, "pattern": x, "behavioral": x}
        }

        Returns
        -------
        {
            "processed": int,
            "skipped":   int,
            "new_weights": {...},
            "weight_delta": {...},   # change vs old weights
        }
        """
        weights_before = self.load_weights(client_id, db)
        weights = dict(weights_before)

        processed = 0
        skipped = 0

        for item in feedback_batch:
            label = str(item.get("auditor_label", "IGNORE")).upper()
            if label == "IGNORE":
                skipped += 1
                continue

            layer_scores: dict[str, float] = item.get("layer_scores", {})
            dominant = self._dominant_layer(layer_scores)
            is_fp = label == "FALSE_POSITIVE"
            weights = self._apply_update(weights, dominant, is_fp)
            processed += 1

        if processed > 0:
            self._save_weights(client_id, weights, db)

        delta = {k: round(weights[k] - weights_before[k], 2) for k in weights}

        return {
            "processed":   processed,
            "skipped":     skipped,
            "new_weights": weights,
            "weight_delta": delta,
        }

    def precision_recall(
        self, feedback_batch: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Compute precision, recall, and F1 from auditor decisions.

        Requires each item to have:
        {
            "auditor_label": "TRUE_POSITIVE" | "FALSE_POSITIVE" | "MISSED_ANOMALY" | "IGNORE",
            "risk_level":    "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
        }

        - TRUE_POSITIVE  → tp
        - FALSE_POSITIVE → fp (engine flagged, auditor says clean)
        - MISSED_ANOMALY → fn (engine missed, auditor found it)
        """
        tp = fp = fn = 0

        for item in feedback_batch:
            label = str(item.get("auditor_label", "IGNORE")).upper()
            if label == "TRUE_POSITIVE":
                tp += 1
            elif label == "FALSE_POSITIVE":
                fp += 1
            elif label == "MISSED_ANOMALY":
                fn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else None
        recall    = tp / (tp + fn) if (tp + fn) > 0 else None
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision is not None and recall is not None and (precision + recall) > 0
            else None
        )

        return {
            "true_positives":  tp,
            "false_positives": fp,
            "missed_anomalies": fn,
            "total_reviewed":  tp + fp + fn,
            "precision":       round(precision, 3) if precision is not None else None,
            "recall":          round(recall, 3)    if recall    is not None else None,
            "f1_score":        round(f1, 3)        if f1        is not None else None,
            "precision_pct":   round(precision * 100, 1) if precision is not None else None,
            "recall_pct":      round(recall    * 100, 1) if recall    is not None else None,
        }
