from sqlalchemy import create_engine
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
