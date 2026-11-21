"""Opt-in PostgreSQL test configuration and fixtures.

Guarantees strict database name validation ('bizflow_test' ONLY),
safe percent-escaped Alembic configuration, automatic migration lifecycle,
and engine disposal.
"""

import os
from pathlib import Path
from typing import Generator
import pytest
from sqlalchemy import create_engine, Engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, Session
from alembic.config import Config
from alembic import command


def validate_test_database_url(url_str: str) -> str:
    """Validate that TEST_DATABASE_URL connects exclusively to 'bizflow_test'.

    Args:
        url_str: Raw database connection URL string.

    Returns:
        str: Validated database URL string.

    Raises:
        RuntimeError: If URL is empty, invalid, or connects to any DB other than 'bizflow_test'.
    """
    if not url_str or not url_str.strip():
        raise RuntimeError("TEST_DATABASE_URL must be set and non-empty for PostgreSQL tests.")

    url = make_url(url_str.strip())
    if url.database != "bizflow_test":
        raise RuntimeError(
            f"DATABASE SAFETY VIOLATION: TEST_DATABASE_URL must connect to database "
            f"'bizflow_test', but connects to '{url.database}'. "
            f"Automated tests are strictly prohibited from running against 'bizflow_dev' or production!"
        )
    return url_str.strip()


@pytest.fixture(scope="session")
def pg_engine() -> Generator[Engine, None, None]:
    """Provide a validated, migrated PostgreSQL Engine for the test session."""
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL not set; skipping opt-in PostgreSQL tests.")

    validated_url = validate_test_database_url(raw_url)

    # Resolve alembic.ini path relative to backend root
    backend_dir = Path(__file__).resolve().parent.parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"

    # Escape percent characters to prevent ConfigParser interpolation errors with special characters
    escaped_url = validated_url.replace("%", "%%")

    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", escaped_url)

    # Automatically run migrations against bizflow_test
    command.upgrade(alembic_cfg, "head")

    engine = create_engine(validated_url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture(scope="function")
def pg_session(pg_engine: Engine) -> Generator[Session, None, None]:
    """Provide an isolated database session for PostgreSQL tests."""
    connection = pg_engine.connect()
    transaction = connection.begin()
    SessionClass = sessionmaker(bind=connection, autocommit=False, autoflush=False, expire_on_commit=False)
    session = SessionClass()

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
