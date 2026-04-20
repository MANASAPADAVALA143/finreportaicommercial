from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    # App
    APP_NAME: str = "FinReport AI"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Database — sqlite default so `uvicorn` starts without Postgres; override in .env for production
    DATABASE_URL: str = "sqlite:///./finreportai.db"

    # Supabase (optional for local; auth routes need real values)
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # Security — change in production
    SECRET_KEY: str = "dev-local-secret-key-replace-in-production-min-32-chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # CORS
    BACKEND_CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3004", "http://localhost:3006", "http://localhost:5173"]

    # Expose FastAPI routes as MCP tools at /mcp (requires `fastapi-mcp` package)
    ENABLE_FASTAPI_MCP: bool = True

    # If set, only /mcp* requests must send header X-API-Key matching this value (other routes unchanged)
    CLIENT_API_KEY: str = ""

    # VAPI outbound (POST /api/voice/inbound-lead) — see https://docs.vapi.ai/calls/outbound-calling
    VAPI_API_KEY: str = ""
    NOVA_ASSISTANT_ID: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    # Optional: n8n webhook URL to alert when VAPI call creation fails (e.g. email Manasa)
    INBOUND_LEAD_VAPI_FAILURE_WEBHOOK: str = ""

settings = Settings()
