"""Optional persistence of FP&A extended module outputs."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.fpa_suite import FpaAnalysisResult

logger = logging.getLogger(__name__)


def store_fpa_result(
    db: Optional[Session],
    module: str,
    payload: dict[str, Any],
    user_id: Optional[str] = None,
) -> None:
    if db is None:
        return
    try:
        body = json.dumps(payload, default=str)
        if len(body) > 500_000:
            body = body[:500_000] + '"…[truncated]"'
        row = FpaAnalysisResult(module=module, user_id=user_id, result_json=body)
        db.add(row)
        db.commit()
    except Exception:
        logger.exception("fpa_analysis_results insert failed")
        db.rollback()
