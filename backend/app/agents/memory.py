import json
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


async def read_agent_memory(agent_name: str, db: Session) -> list[dict[str, Any]]:
    """Read last 6 months of agent history."""
    try:
        result = db.execute(
            text(
                """
                SELECT last_6_months
                FROM agent_memory
                WHERE agent_name = :agent_name
                """
            ),
            {"agent_name": agent_name},
        ).first()
        if not result:
            return []

        raw = result[0]
        if raw is None:
            return []
        if isinstance(raw, str):
            return json.loads(raw)
        return raw
    except Exception:
        return []


async def update_agent_memory(agent_name: str, new_data: dict[str, Any], db: Session) -> None:
    """Update memory with latest run and keep trailing 180 entries."""
    try:
        history = await read_agent_memory(agent_name, db)
        history.append({"date": datetime.now().isoformat(), "data": new_data})
        if len(history) > 180:
            history = history[-180:]

        db.execute(
            text(
                """
                INSERT INTO agent_memory (agent_name, last_6_months, updated_at)
                VALUES (:agent_name, CAST(:last_6_months AS JSONB), NOW())
                ON CONFLICT (agent_name)
                DO UPDATE SET
                  last_6_months = CAST(:last_6_months AS JSONB),
                  updated_at = NOW()
                """
            ),
            {"agent_name": agent_name, "last_6_months": json.dumps(history, default=str)},
        )
        db.commit()
    except Exception as exc:
        print(f"Memory update error: {exc}")
        db.rollback()


async def store_agent_run(
    agent_name: str,
    input_data: dict[str, Any],
    output_data: dict[str, Any],
    insight: dict[str, Any],
    db: Session,
) -> None:
    """Store complete agent run in DB."""
    try:
        urgency = insight.get("urgency", "green")
        db.execute(
            text(
                """
                INSERT INTO agent_runs (agent_name, input_data, output_data, insight, urgency)
                VALUES (
                  :agent_name,
                  CAST(:input_data AS JSONB),
                  CAST(:output_data AS JSONB),
                  CAST(:insight AS JSONB),
                  :urgency
                )
                """
            ),
            {
                "agent_name": agent_name,
                "input_data": json.dumps(input_data, default=str),
                "output_data": json.dumps(output_data, default=str),
                "insight": json.dumps(insight, default=str),
                "urgency": urgency,
            },
        )
        db.commit()
    except Exception as exc:
        print(f"Store run error: {exc}")
        db.rollback()
