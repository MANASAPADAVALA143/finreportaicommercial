"""Database configuration and session management"""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Load repo-root .env (GulfTax standalone — single .env for frontend + backend).
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./gulftax.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class _ExtendExisting:
    """Tolerate accidental double-import of the same mapped class.

    FinReportAI mounts this package both via sys.path (`from models import …`)
    and as ``app.modules.gulftax.ported.*``. Without this, SQLAlchemy raises
    InvalidRequestError f405 (Table already defined for this MetaData).
    """

    __abstract__ = True
    __table_args__ = {"extend_existing": True}


Base = declarative_base(cls=_ExtendExisting)


def get_db():
    """Dependency for getting database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
