"""Sliding-window limits for the few public endpoints that cost money per call (LLM, outbound phone calls).

Counts live in this process only, so they reset on restart and each worker keeps its own.
"""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, Request

_MAX_KEYS = 10_000


class RateLimit:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        """Record a hit for `key` and return True, or return False once `limit` hits fall within the window."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            if len(self._hits) > _MAX_KEYS:
                for stale in [k for k, h in self._hits.items() if not h or now - h[-1] >= self.window]:
                    del self._hits[stale]
            return True

    def check(self, key: str) -> None:
        if not self.allow(key):
            raise HTTPException(status_code=429, detail="Too many requests, please try again later")

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def client_ip(request: Request) -> str:
    """Render's proxy appends the connecting address to X-Forwarded-For, so the last entry can't be forged."""
    forwarded = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if forwarded:
        return forwarded[-1]
    return request.client.host if request.client else "unknown"
