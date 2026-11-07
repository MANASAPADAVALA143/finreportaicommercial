"""Shared types for close agents."""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.services.ai_cfo.ledger import LedgerScope

MATERIALITY_FLOOR = 5000.0


def period_bounds(period: str) -> tuple[date, date]:
    year, month = int(period[:4]), int(period[5:7])
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def money(v: Any) -> float:
    return round(float(v or 0), 2)


def severity(amount: float, high_at: float = MATERIALITY_FLOOR) -> str:
    return "high" if abs(amount) >= high_at else "medium"


@dataclass
class Entity:
    id: str
    name: str
    currency: str = "AED"


@dataclass
class CloseContext:
    db: Session
    workspace_id: str
    company_id: str
    period: str
    run_id: int
    upstream: dict[str, dict[str, Any]] = field(default_factory=dict)
    currency: str = "AED"
    entities: list[Entity] = field(default_factory=list)
    scope_kind: str = "entity"

    @property
    def scope(self) -> LedgerScope:
        return LedgerScope(self.workspace_id, self.company_id)

    @property
    def start(self) -> date:
        return period_bounds(self.period)[0]

    @property
    def end(self) -> date:
        return period_bounds(self.period)[1]


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    blocking: bool = False  # a failed blocking check means the output cannot be trusted


@dataclass
class ExceptionItem:
    fingerprint: str
    category: str
    severity: str
    title: str
    detail: str
    amount: float | None = None
    refs: list[dict[str, Any]] = field(default_factory=list)
    entity_id: str | None = None


@dataclass
class JournalDraft:
    fingerprint: str
    title: str
    rationale: str
    entry_date: date
    lines: list[dict[str, Any]]
    refs: list[dict[str, Any]] = field(default_factory=list)
    entity_id: str | None = None
    reference: str | None = None

    @property
    def amount(self) -> float:
        return round(sum(float(line.get("debit") or 0) for line in self.lines), 2)


@dataclass
class AgentOutcome:
    records_processed: int
    output: dict[str, Any]
    checks: list[Check] = field(default_factory=list)
    exceptions: list[ExceptionItem] = field(default_factory=list)
    journals: list[JournalDraft] = field(default_factory=list)
    messages: list[str] = field(default_factory=list)
