from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings


def pin_psycopg2(url: str) -> str:
    """SQLAlchemy 2.1 maps bare postgresql:// to psycopg 3, whose typed binds break
    String model columns that are uuid in the DB; psycopg2 sends untyped literals."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


def return_uuid_as_str(engine) -> None:
    """Undo the psycopg2 dialect's register_uuid so uuid columns load as str.

    Models declare these ids as String(36); uuid.UUID values would otherwise leak into
    filters on varchar columns and get bound as ::UUID (varchar = uuid errors).
    """
    if engine.dialect.driver != "psycopg2":
        return
    import psycopg2.extensions as ext

    uuid_str = ext.new_type((2950,), "UUID_AS_STR", lambda value, _cur: value)
    uuid_arr_str = ext.new_array_type((2951,), "UUID_ARRAY_AS_STR", uuid_str)

    @event.listens_for(engine, "connect")
    def _uuid_as_str(dbapi_conn, _conn_record):
        ext.register_type(uuid_str, dbapi_conn)
        ext.register_type(uuid_arr_str, dbapi_conn)


def get_engine_connect_args() -> dict:
    """Driver options per URL (avoids long hangs when Postgres is down)."""
    if "sqlite" in settings.DATABASE_URL:
        return {"check_same_thread": False}
    if settings.DATABASE_URL.startswith("postgresql"):
        return {"connect_timeout": 10}
    return {}


# Create SQLAlchemy engine (SQLite needs check_same_thread=False for FastAPI)
engine = create_engine(
    pin_psycopg2(settings.DATABASE_URL),
    echo=settings.DEBUG,
    connect_args=get_engine_connect_args(),
    # Batched INSERT..RETURNING renders typed casts (p0::VARCHAR) even on psycopg2,
    # which fail against uuid columns that models declare as String.
    use_insertmanyvalues=False,
)

# Ensure search_path=public on every Postgres connection so tables in the
# public schema are always visible regardless of the role's default path.
if engine.dialect.name == "postgresql":
    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, _conn_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.close()

return_uuid_as_str(engine)

# Create SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class for models
Base = declarative_base()


def get_db():
    """Database session dependency for FastAPI."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
