"""Database engine, session management, and base declarative model.

Provides synchronous SQLAlchemy 2.x engine, sessionmaker, and the get_db
generator dependency. Enforces explicit transaction boundaries with zero
silent auto-commits.
"""

from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from app.core.config import get_settings

settings = get_settings()

# Configure synchronous SQLAlchemy engine with connection health pre-ping
# to gracefully handle stale or dropped database connections.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    echo=False,
)

# Standard sessionmaker: autocommit and autoflush are disabled to ensure
# all transaction commits and flushes are explicit and service-controlled.
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy 2.0 declarative ORM models."""
    pass


def get_db() -> Generator[Session, None, None]:
    """Provide a transactional database session for request lifecycle.

    Yields:
        Session: Active SQLAlchemy session.

    Behavior:
        - Creates a new session per request.
        - Rolls back any uncommitted changes if an unhandled exception occurs.
        - Guarantees session closure in the finally block.
        - Never silently commits. Services must manage their own commit boundaries.
    """
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
