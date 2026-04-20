"""Optional API key gate for /mcp only (set CLIENT_API_KEY in production)."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


def add_mcp_api_key_middleware(app, client_api_key: str) -> None:
    """When client_api_key is non-empty, require matching X-API-Key on /mcp*."""
    key = (client_api_key or "").strip()
    if not key:
        return

    class _McpApiKeyMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            if request.url.path.startswith("/mcp"):
                if request.method == "OPTIONS":
                    return await call_next(request)
                supplied = request.headers.get("x-api-key") or request.headers.get(
                    "X-API-Key", ""
                )
                if supplied.strip() != key:
                    return JSONResponse(
                        {"detail": "Invalid or missing X-API-Key for MCP"},
                        status_code=401,
                    )
            return await call_next(request)

    app.add_middleware(_McpApiKeyMiddleware)
