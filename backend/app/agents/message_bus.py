"""
Lightweight progress fan-out.

Primary delivery path: PostgreSQL `agent_run_logs` (polled by HTTP and WebSocket).
This module holds optional in-process subscribers for future extensions.
"""
from __future__ import annotations

from typing import Callable

LogHandler = Callable[[str, str], None]

_handlers: list[LogHandler] = []


def subscribe(handler: LogHandler) -> None:
    _handlers.append(handler)


def unsubscribe(handler: LogHandler) -> None:
    try:
        _handlers.remove(handler)
    except ValueError:
        pass


def publish(agent_id: str, message: str) -> None:
    for h in list(_handlers):
        try:
            h(agent_id, message)
        except Exception:
            pass
