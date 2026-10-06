from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings


def get_engine_connect_args() -> dict:
    """Driver options per URL (avoids long hangs when Postgres is down)."""
    if "sqlite" in settings.DATABASE_URL:
        return {"check_same_thread": False}
    if settings.DATABASE_URL.startswith("postgresql"):
        return {"connect_timeout": 10}
    return {}


# Create SQLAlchemy engine (SQLite needs check_same_thread=False for FastAPI)
engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args=get_engine_connect_args(),
)

# Ensure search_path=public on every Postgres connection so tables in the
# public schema are always visible regardless of the role's default path.
if engine.dialect.name == "postgresql":
    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, _conn_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("SET search_path TO public")
        cursor.close()

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
