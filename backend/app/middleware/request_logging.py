"""API request logging — metadata only, never request/response bodies."""

from __future__ import annotations

import logging
import time
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("finreport.api.access")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()
        tenant_id = request.headers.get("x-workspace-id") or request.headers.get("x-tenant-id") or "-"
        user_id = "-"
        auth = request.headers.get("authorization") or ""
        if auth.startswith("Bearer "):
            user_id = "authenticated"

        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "method=%s path=%s status=%s tenant_id=%s user=%s ms=%s",
            request.method,
            request.url.path,
            response.status_code,
            tenant_id,
            user_id,
            elapsed_ms,
        )
        return response
