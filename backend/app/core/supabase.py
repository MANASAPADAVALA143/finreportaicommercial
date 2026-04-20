from supabase import create_client, Client
from app.core.config import settings

_client: Client | None = None


def get_supabase() -> Client:
    """Lazy Supabase client so the API can boot locally without Supabase configured."""
    global _client
    if _client is None:
        url = (settings.SUPABASE_URL or "").strip()
        key = (settings.SUPABASE_KEY or "").strip()
        if not url or not key:
            raise RuntimeError(
                "Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY in backend/.env "
                "(auth routes only; R2R/IFRS/TB work without it)."
            )
        _client = create_client(url, key)
    return _client
