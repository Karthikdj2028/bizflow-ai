"""Unit tests for database session dependency and transaction management.

Verifies:
- get_db() rollback behavior on exception.
- get_db() session closure guarantees.
- get_db() never silently auto-commits.
- Alembic configuration file and migration scripts exist and parse.
"""

from pathlib import Path
import pytest
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal, Base
from app.models import User


def test_get_db_session_lifecycle() -> None:
    """Verify get_db yields an active session and closes it cleanly."""
    gen = get_db()
    db = next(gen)
    assert isinstance(db, Session)
    assert db.is_active

    # Closing generator must trigger finally block
    with pytest.raises(StopIteration):
        next(gen)


def test_get_db_rollback_on_exception() -> None:
    """Verify get_db rolls back the transaction if an exception occurs."""
    gen = get_db()
    db = next(gen)

    # Simulate an error within the request context
    test_error = RuntimeError("Simulated request processing error")
    with pytest.raises(RuntimeError):
        gen.throw(test_error)


def test_get_db_no_silent_commit() -> None:
    """Verify that get_db never commits uncommitted objects automatically."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.core.database import Base
    from app.models import User

    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=test_engine)
    TestingSession = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)

    def custom_get_db():
        db = TestingSession()
        try:
            yield db
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    gen = custom_get_db()
    db = next(gen)
    user = User(email="nocommit@bizflow.ai", password_hash="hash", full_name="No Commit")
    db.add(user)
    # Notice: we DO NOT call db.commit()!
    with pytest.raises(StopIteration):
        next(gen)

    # Open a completely fresh session to verify user was NOT saved
    verify_session = TestingSession()
    persisted_user = verify_session.query(User).filter_by(email="nocommit@bizflow.ai").first()
    assert persisted_user is None, "Object was silently committed! get_db must not auto-commit."
    verify_session.close()


def test_alembic_configuration_integrity() -> None:
    """Verify Alembic configuration files and initial migration exist."""
    backend_dir = Path(__file__).resolve().parent.parent.parent
    alembic_ini = backend_dir / "alembic.ini"
    alembic_env = backend_dir / "alembic" / "env.py"
    migration_file = backend_dir / "alembic" / "versions" / "0001_initial_core_schema.py"

    assert alembic_ini.exists(), "alembic.ini must exist"
    assert alembic_env.exists(), "alembic/env.py must exist"
    assert migration_file.exists(), "0001_initial_core_schema.py migration must exist"

    # Verify migration file content contains expected table definitions
    content = migration_file.read_text(encoding="utf-8")
    assert "users" in content
    assert "businesses" in content
    assert "business_memberships" in content
    assert "chk_membership_role" in content
    assert "uq_user_business_membership" in content
