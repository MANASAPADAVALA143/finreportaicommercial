"""Shared agent context and base class."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable

from sqlalchemy.orm import Session


LogFn = Callable[[str, str], None]


class AgentContext:
    """Per-run execution context (DB session + identifiers + logger)."""

    def __init__(
        self,
        db: Session,
        agent_run_db_id: int,
        public_run_id: str,
        tenant_id: str,
        trial_balance_id: int,
        log: LogFn,
    ):
        self.db = db
        self.agent_run_db_id = agent_run_db_id
        self.public_run_id = public_run_id
        self.tenant_id = tenant_id
        self.trial_balance_id = trial_balance_id
        self.log = log
        self.shared: dict[str, Any] = {}

    def emit(self, agent_id: str, message: str) -> None:
        self.log(agent_id, message)


class BaseAgent(ABC):
    agent_id: str = "BASE"

    def __init__(self, ctx: AgentContext):
        self.ctx = ctx

    @abstractmethod
    def run(self) -> None:
        raise NotImplementedError
