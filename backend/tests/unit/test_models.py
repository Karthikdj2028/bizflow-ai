"""Unit tests for SQLAlchemy 2.0 database models, constraints, and relationships.

These tests run against an isolated SQLite memory engine with strict foreign key
enforcement enabled (PRAGMA foreign_keys=ON).

NOTE: These tests verify ORM mapping and constraint definitions in memory.
Full PostgreSQL integration verification requires an active PostgreSQL 16 instance.
"""

import uuid
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import IntegrityError
from app.core.database import Base
from app.models import User, Business, BusinessMembership


@pytest.fixture(scope="function")
def db_session() -> Session:
    """Create an isolated in-memory SQLite database with foreign keys enabled."""
    engine = create_engine("sqlite:///:memory:")

    # Explicitly enable foreign key constraints for SQLite
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def test_model_metadata_registration() -> None:
    """Verify that all core models are registered in Base.metadata."""
    table_names = Base.metadata.tables.keys()
    assert "users" in table_names
    assert "businesses" in table_names
    assert "business_memberships" in table_names


def test_uuid_primary_key_generation(db_session: Session) -> None:
    """Verify that primary keys are automatically generated as valid UUIDs."""
    user = User(
        email="test.uuid@bizflow.ai",
        password_hash="hashed_secret_123",
        full_name="UUID Test User",
    )
    db_session.add(user)
    db_session.commit()

    assert user.id is not None
    assert isinstance(user.id, uuid.UUID)
    assert user.created_at is not None
    assert user.is_active is True


def test_user_email_uniqueness(db_session: Session) -> None:
    """Verify that duplicate user emails violate unique constraint."""
    user1 = User(
        email="duplicate@bizflow.ai",
        password_hash="hash1",
        full_name="User One",
    )
    user2 = User(
        email="duplicate@bizflow.ai",
        password_hash="hash2",
        full_name="User Two",
    )
    db_session.add(user1)
    db_session.commit()

    db_session.add(user2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_business_creation_and_defaults(db_session: Session) -> None:
    """Verify business creation and default base_currency = 'INR'."""
    biz = Business(name="Acme Logistics")
    db_session.add(biz)
    db_session.commit()

    assert biz.id is not None
    assert isinstance(biz.id, uuid.UUID)
    assert biz.name == "Acme Logistics"
    assert biz.base_currency == "INR"
    assert biz.created_at is not None


def test_business_membership_uniqueness(db_session: Session) -> None:
    """Verify that (user_id, business_id) combination must be unique."""
    user = User(email="member@bizflow.ai", password_hash="hash", full_name="Member")
    biz = Business(name="Biz")
    db_session.add_all([user, biz])
    db_session.commit()

    m1 = BusinessMembership(user_id=user.id, business_id=biz.id, role="OWNER")
    db_session.add(m1)
    db_session.commit()

    # Attempt duplicate membership for the same user and business
    m2 = BusinessMembership(user_id=user.id, business_id=biz.id, role="MEMBER")
    db_session.add(m2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_membership_role_check_constraint(db_session: Session) -> None:
    """Verify that invalid roles violate the CHECK constraint."""
    user = User(email="role.test@bizflow.ai", password_hash="hash", full_name="Role Test")
    biz = Business(name="Role Biz")
    db_session.add_all([user, biz])
    db_session.commit()

    invalid_membership = BusinessMembership(
        user_id=user.id,
        business_id=biz.id,
        role="SUPERADMIN",  # Not in ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')
    )
    db_session.add(invalid_membership)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_foreign_key_enforcement(db_session: Session) -> None:
    """Verify foreign key enforcement when referencing non-existent IDs."""
    fake_user_id = uuid.uuid4()
    biz = Business(name="FK Biz")
    db_session.add(biz)
    db_session.commit()

    membership = BusinessMembership(
        user_id=fake_user_id,
        business_id=biz.id,
        role="OWNER",
    )
    db_session.add(membership)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_model_relationships_and_cascade(db_session: Session) -> None:
    """Verify bidirectional relationships and cascade deletion."""
    user = User(email="cascade@bizflow.ai", password_hash="hash", full_name="Cascade User")
    biz = Business(name="Cascade Biz")
    db_session.add_all([user, biz])
    db_session.commit()

    membership = BusinessMembership(user_id=user.id, business_id=biz.id, role="OWNER")
    db_session.add(membership)
    db_session.commit()

    # Test bidirectional relationship navigation
    assert len(user.memberships) == 1
    assert user.memberships[0].business_id == biz.id
    assert len(biz.memberships) == 1
    assert biz.memberships[0].user_id == user.id
    assert membership.user.email == "cascade@bizflow.ai"
    assert membership.business.name == "Cascade Biz"

    # Test cascade deletion when user is deleted
    db_session.delete(user)
    db_session.commit()

    remaining_memberships = db_session.query(BusinessMembership).filter_by(business_id=biz.id).all()
    assert len(remaining_memberships) == 0
