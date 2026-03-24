from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Create SQLAlchemy engine (SQLite needs check_same_thread=False for FastAPI)
_connect_args = {}
if "sqlite" in settings.DATABASE_URL:
    _connect_args["check_same_thread"] = False
engine = create_engine(settings.DATABASE_URL, echo=settings.DEBUG, connect_args=_connect_args)

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
