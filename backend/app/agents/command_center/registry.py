"""Dispatch CFO Command Center agents to concrete runners."""
from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

from app.agents.command_center import (
    fpa_budget_runner,
    fpa_forecast_runner,
    fpa_variance_runner,
    ifrs_delegate_runner,
    je_anomaly_runner,
    recon_runner,
)

Runner = Callable[[Session, str, dict[str, Any]], dict[str, Any]]

AGENT_REGISTRY: dict[str, Runner] = {
    "fpa_variance": fpa_variance_runner.run,
    "fpa_forecast": fpa_forecast_runner.run,
    "fpa_budget": fpa_budget_runner.run,
    "je_anomaly": je_anomaly_runner.run,
    "recon": recon_runner.run,
    "ifrs": ifrs_delegate_runner.run,
}


def list_agent_names() -> list[str]:
    return sorted(AGENT_REGISTRY.keys())


def run_agent(agent_name: str, db: Session, tenant_id: str, context: dict[str, Any]) -> dict[str, Any]:
    key = (agent_name or "").strip().lower()
    fn = AGENT_REGISTRY.get(key)
    if not fn:
        raise ValueError(f"Unknown agent: {agent_name}. Valid: {', '.join(list_agent_names())}")
    return fn(db, tenant_id, context)
