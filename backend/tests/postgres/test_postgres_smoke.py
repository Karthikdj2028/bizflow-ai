"""Opt-in PostgreSQL smoke and schema verification tests.

Requires a live PostgreSQL instance and explicit TEST_DATABASE_URL pointing to 'bizflow_test'.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import uuid
from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership


@pytest.mark.postgres
def test_postgres_connectivity(pg_session: Session) -> None:
    """Verify live PostgreSQL connectivity and version retrieval."""
    result = pg_session.execute(text("SELECT version();")).scalar()
    assert result is not None
    assert "PostgreSQL" in str(result)


@pytest.mark.postgres
def test_postgres_schema_presence(pg_session: Session) -> None:
    """Verify that Alembic migrations created the core schema tables in bizflow_test."""
    tables_query = text(
        """
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
        """
    )
    existing_tables = {row[0] for row in pg_session.execute(tables_query).fetchall()}
    assert "users" in existing_tables
    assert "businesses" in existing_tables
    assert "business_memberships" in existing_tables
    assert "alembic_version" in existing_tables


@pytest.mark.postgres
def test_postgres_role_check_constraint(pg_session: Session) -> None:
    """Verify that PostgreSQL enforces the chk_membership_role check constraint."""
    # Create user and business
    user = User(
        email="pg_tester@bizflow.io",
        password_hash="hashed_pwd_placeholder",
        full_name="PG Tester",
    )
    biz = Business(
        name="PG Test Business",
        base_currency="USD",
    )
    pg_session.add_all([user, biz])
    pg_session.flush()

    # Valid role: should succeed
    membership = BusinessMembership(
        user_id=user.id,
        business_id=biz.id,
        role="OWNER",
    )
    pg_session.add(membership)
    pg_session.flush()

    # Invalid role: should fail against PostgreSQL CHECK constraint
    invalid_membership = BusinessMembership(
        user_id=user.id,
        business_id=biz.id,
        role="INVALID_ROLE",
    )
    pg_session.add(invalid_membership)
    with pytest.raises(IntegrityError):
        pg_session.flush()
