"""Integration tests for user registration, login, and authentication dependencies.

Conforms to RFC 9457 Problem Details error responses.
"""

from datetime import timedelta
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership
from app.core.security import create_access_token


# ==============================================================================
# Registration API Tests
# ==============================================================================

def test_register_user_success(client: TestClient, db: Session) -> None:
    """Verify successful user registration with default INR workspace and OWNER role."""
    payload = {
        "email": "sarah.connor@example.com",
        "password": "ValidPassword123!",
        "full_name": "Sarah Connor",
        "initial_business_name": "Cyberdyne Defense",
    }
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201

    data = response.json()
    assert "user" in data
    assert "token" in data

    # 1. Verify User response fields
    user_data = data["user"]
    assert user_data["email"] == "sarah.connor@example.com"
    assert user_data["full_name"] == "Sarah Connor"
    assert user_data["is_active"] is True
    assert "password_hash" not in user_data  # CRITICAL: Hash must never be serialized
    assert "id" in user_data

    # 2. Verify Token response fields
    token_data = data["token"]
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"
    assert token_data["expires_in"] == 900  # 15 minutes in seconds

    # 3. Verify Database State
    created_user = db.scalar(select(User).where(User.email == "sarah.connor@example.com"))
    assert created_user is not None
    assert created_user.password_hash != "ValidPassword123!"

    created_biz = db.scalar(select(Business).where(Business.name == "Cyberdyne Defense"))
    assert created_biz is not None
    assert created_biz.base_currency == "INR"

    created_membership = db.scalar(
        select(BusinessMembership).where(
            BusinessMembership.user_id == created_user.id,
            BusinessMembership.business_id == created_biz.id,
        )
    )
    assert created_membership is not None
    assert created_membership.role == "OWNER"


def test_register_user_email_normalization(client: TestClient) -> None:
    """Verify that email addresses with leading/trailing spaces and uppercase are normalized."""
    payload = {
        "email": "  JOHN.DOE@EXAMPLE.COM  ",
        "password": "ValidPassword123!",
        "full_name": "John Doe",
    }
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201
    assert response.json()["user"]["email"] == "john.doe@example.com"


def test_register_duplicate_email_rejected_rfc9457(client: TestClient) -> None:
    """Verify that duplicate registrations return HTTP 409 in RFC 9457 format."""
    payload = {
        "email": "duplicate.test@example.com",
        "password": "ValidPassword123!",
        "full_name": "Original User",
    }
    # First registration succeeds
    res1 = client.post("/api/v1/auth/register", json=payload)
    assert res1.status_code == 201

    # Second registration with same email (even with different casing) must fail with 409
    payload_dup = {
        "email": "DUPLICATE.TEST@EXAMPLE.COM",
        "password": "DifferentPassword999!",
        "full_name": "Second User",
    }
    res2 = client.post("/api/v1/auth/register", json=payload_dup)
    assert res2.status_code == 409
    assert res2.headers.get("content-type") == "application/problem+json"

    error_data = res2.json()
    assert error_data["title"] == "Conflict"
    assert error_data["status"] == 409
    assert error_data["code"] == "EMAIL_ALREADY_EXISTS"
    assert "already exists" in error_data["detail"]


def test_register_password_byte_validation_422(client: TestClient) -> None:
    """Verify that passwords exceeding 72 bytes trigger 422 Unprocessable Entity."""
    oversized_password = "A" * 73
    payload = {
        "email": "oversized@example.com",
        "password": oversized_password,
        "full_name": "Oversized User",
    }
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 422
    assert response.headers.get("content-type") == "application/problem+json"

    error_data = response.json()
    assert error_data["code"] == "REQUEST_VALIDATION_FAILED"
    assert any("72-byte UTF-8 limit" in err["message"] for err in error_data["errors"])


def test_register_atomic_rollback_on_failure(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that if workspace or membership creation fails, the user record is rolled back cleanly."""
    from app.services import auth as auth_service

    # Force an error during the membership creation step
    def failing_register(*args, **kwargs):
        raise RuntimeError("Simulated failure during workspace creation")

    # Let's test the atomic transaction behavior directly at the service layer
    from app.schemas.auth import UserRegisterRequest
    req = UserRegisterRequest(
        email="atomic.test@example.com",
        password="Password123!",
        full_name="Atomic Tester",
    )

    # Monkeypatch Business entity instantiation to fail inside with db.begin():
    def mock_business_init(*args, **kwargs):
        raise RuntimeError("Simulated failure in Business workspace creation")

    monkeypatch.setattr("app.services.auth.Business", mock_business_init)

    with pytest.raises(RuntimeError):
        auth_service.register_user(db=db, request=req)

    # Assert that NO user was committed to the database
    persisted_user = db.scalar(select(User).where(User.email == "atomic.test@example.com"))
    assert persisted_user is None


# ==============================================================================
# Login API Tests
# ==============================================================================

def test_login_success(client: TestClient) -> None:
    """Verify successful user login returns a valid JWT access token."""
    # Register user first
    reg_payload = {
        "email": "login.success@example.com",
        "password": "MyStrongPassword123!",
        "full_name": "Login Success User",
    }
    client.post("/api/v1/auth/register", json=reg_payload)

    # Login with registered credentials
    login_payload = {
        "email": "login.success@example.com",
        "password": "MyStrongPassword123!",
    }
    response = client.post("/api/v1/auth/login", json=login_payload)
    assert response.status_code == 200

    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 900


def test_login_invalid_email_generic_401(client: TestClient) -> None:
    """Verify that non-existent email returns generic 401 without leaking existence."""
    payload = {
        "email": "nonexistent.user@example.com",
        "password": "SomePassword123!",
    }
    response = client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 401
    assert response.headers.get("content-type") == "application/problem+json"

    data = response.json()
    assert data["code"] == "INVALID_CREDENTIALS"
    assert data["detail"] == "Invalid email or password."


def test_login_invalid_password_generic_401(client: TestClient) -> None:
    """Verify that incorrect password returns identical generic 401 message."""
    reg_payload = {
        "email": "valid.user@example.com",
        "password": "CorrectPassword123!",
        "full_name": "Valid User",
    }
    client.post("/api/v1/auth/register", json=reg_payload)

    login_payload = {
        "email": "valid.user@example.com",
        "password": "WrongPassword456!",
    }
    response = client.post("/api/v1/auth/login", json=login_payload)
    assert response.status_code == 401
    data = response.json()
    assert data["code"] == "INVALID_CREDENTIALS"
    assert data["detail"] == "Invalid email or password."


def test_login_deactivated_account_rejected(client: TestClient, db: Session) -> None:
    """Verify that deactivated accounts (is_active=False) cannot log in."""
    reg_payload = {
        "email": "deactivated@example.com",
        "password": "MyPassword123!",
        "full_name": "Deactivated User",
    }
    client.post("/api/v1/auth/register", json=reg_payload)

    # Deactivate user directly in the database
    user = db.scalar(select(User).where(User.email == "deactivated@example.com"))
    assert user is not None
    user.is_active = False
    db.commit()

    login_payload = {
        "email": "deactivated@example.com",
        "password": "MyPassword123!",
    }
    response = client.post("/api/v1/auth/login", json=login_payload)
    assert response.status_code == 401
    data = response.json()
    assert data["code"] == "ACCOUNT_INACTIVE"


# ==============================================================================
# CurrentUserDep & /api/v1/auth/me Tests
# ==============================================================================

def test_get_current_user_profile_success(client: TestClient) -> None:
    """Verify GET /api/v1/auth/me returns caller profile with valid Bearer token."""
    reg_payload = {
        "email": "me.endpoint@example.com",
        "password": "Password123!",
        "full_name": "Profile User",
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    token = reg_res.json()["token"]["access_token"]

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "me.endpoint@example.com"
    assert data["full_name"] == "Profile User"
    assert "password_hash" not in data


def test_get_current_user_missing_header_401(client: TestClient) -> None:
    """Verify that request missing Authorization header returns 401."""
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    data = response.json()
    assert data["code"] == "MISSING_AUTHENTICATION"


def test_get_current_user_invalid_token_401(client: TestClient) -> None:
    """Verify that forged or malformed Bearer token returns 401."""
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid.fake.token"},
    )
    assert response.status_code == 401
    data = response.json()
    assert data["code"] == "INVALID_TOKEN"


def test_get_current_user_expired_token_401(client: TestClient, db: Session) -> None:
    """Verify that expired Bearer token returns 401 TOKEN_EXPIRED."""
    reg_payload = {
        "email": "expired.user@example.com",
        "password": "Password123!",
        "full_name": "Expired User",
    }
    client.post("/api/v1/auth/register", json=reg_payload)
    user = db.scalar(select(User).where(User.email == "expired.user@example.com"))

    # Mint an expired token
    expired_token = create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=-30),
    )

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code == 401
    data = response.json()
    assert data["code"] == "TOKEN_EXPIRED"


def test_get_current_user_deactivated_token_rejected(client: TestClient, db: Session) -> None:
    """Verify that an active token is rejected if the user is deactivated in the DB."""
    reg_payload = {
        "email": "banned.user@example.com",
        "password": "Password123!",
        "full_name": "Banned User",
    }
    res = client.post("/api/v1/auth/register", json=reg_payload)
    token = res.json()["token"]["access_token"]

    # Deactivate user in database
    user = db.scalar(select(User).where(User.email == "banned.user@example.com"))
    user.is_active = False
    db.commit()

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401
    data = response.json()
    assert data["code"] == "ACCOUNT_INACTIVE"


# ==============================================================================
# Security Hardening & Concurrency Discrimination Tests
# ==============================================================================

def test_login_nonexistent_user_invokes_dummy_verification(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify that login for a non-existent user executes dummy bcrypt verification exactly once."""
    from unittest.mock import MagicMock
    import app.services.auth as auth_service
    from app.core.security import DUMMY_BCRYPT_HASH, verify_password

    mock_verify = MagicMock(side_effect=verify_password)
    monkeypatch.setattr(auth_service, "verify_password", mock_verify)

    login_payload = {
        "email": "nonexistent.user.12345@example.com",
        "password": "RandomPassword999!",
    }
    response = client.post("/api/v1/auth/login", json=login_payload)
    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_CREDENTIALS"

    # Verify dummy verification was invoked exactly once with the given password and DUMMY_BCRYPT_HASH
    mock_verify.assert_called_once_with("RandomPassword999!", DUMMY_BCRYPT_HASH)


def test_register_concurrency_race_condition(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify that if two concurrent requests race past application check, the DB uniqueness constraint fires and maps to 409."""
    import app.services.auth as auth_service

    reg_payload = {
        "email": "concurrent.race@example.com",
        "password": "ValidPassword123!",
        "full_name": "Concurrent Race User",
    }
    # First registration completes successfully
    res1 = client.post("/api/v1/auth/register", json=reg_payload)
    assert res1.status_code == 201

    # Simulate race condition: mock the SELECT pre-check to return None as if checking simultaneously
    original_scalar = Session.scalar

    def mock_scalar(self, statement, *args, **kwargs):
        # If querying for User by email, simulate concurrent cache miss / race by returning None
        query_str = str(statement)
        if "users.email =" in query_str and "SELECT" in query_str:
            return None
        return original_scalar(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "scalar", mock_scalar)

    # Second registration attempts insert; database constraint triggers IntegrityError; service maps to 409
    res2 = client.post("/api/v1/auth/register", json=reg_payload)
    assert res2.status_code == 409
    data = res2.json()
    assert data["code"] == "EMAIL_ALREADY_EXISTS"
    assert "already exists" in data["detail"].lower()


def test_register_unrelated_integrity_error_returns_500_without_leak(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify that an unrelated database constraint violation maps to HTTP 500 without leaking SQL internals."""
    from sqlalchemy.exc import IntegrityError
    import app.services.auth as auth_service

    reg_payload = {
        "email": "unrelated.integrity@example.com",
        "password": "ValidPassword123!",
        "full_name": "Unrelated Error User",
    }

    # Simulate an unrelated foreign key or check constraint failure inside register_user
    original_add = Session.add

    def mock_add(self, instance, *args, **kwargs):
        if isinstance(instance, BusinessMembership):
            raise IntegrityError(
                statement="INSERT INTO business_memberships ...",
                params={},
                orig=Exception("FOREIGN KEY constraint failed: fk_business_memberships_user_id"),
            )
        return original_add(self, instance, *args, **kwargs)

    monkeypatch.setattr(Session, "add", mock_add)

    response = client.post("/api/v1/auth/register", json=reg_payload)
    assert response.status_code == 500
    data = response.json()
    assert data["code"] == "INTERNAL_DATABASE_ERROR"
    assert "integrity constraint prevented registration" in data["detail"]
    # Verify no raw SQL or table details leaked to client
    assert "business_memberships" not in data["detail"]
    assert "INSERT INTO" not in data["detail"]
    assert "FOREIGN KEY" not in data["detail"]


def test_register_atomic_rollback_on_business_failure(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify that failure during workspace business creation rolls back user creation atomically."""
    from sqlalchemy.exc import IntegrityError

    reg_payload = {
        "email": "rollback.user@example.com",
        "password": "ValidPassword123!",
        "full_name": "Rollback User",
    }

    original_add = Session.add

    def mock_add(self, instance, *args, **kwargs):
        if isinstance(instance, Business):
            raise IntegrityError(
                statement="INSERT INTO businesses ...",
                params={},
                orig=Exception("Simulated check constraint or database error on businesses table"),
            )
        return original_add(self, instance, *args, **kwargs)

    monkeypatch.setattr(Session, "add", mock_add)

    response = client.post("/api/v1/auth/register", json=reg_payload)
    assert response.status_code == 500

    # Verify atomic rollback: zero User records created
    orphaned_user = db.scalar(select(User).where(User.email == "rollback.user@example.com"))
    assert orphaned_user is None


def test_register_atomic_rollback_on_membership_failure(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify that failure during membership creation rolls back both user and business creation atomically."""
    from sqlalchemy.exc import IntegrityError

    reg_payload = {
        "email": "membership.rollback@example.com",
        "password": "ValidPassword123!",
        "full_name": "Membership Rollback User",
        "initial_business_name": "Rollback Workspace Corp",
    }

    original_add = Session.add

    def mock_add(self, instance, *args, **kwargs):
        if isinstance(instance, BusinessMembership):
            raise IntegrityError(
                statement="INSERT INTO business_memberships ...",
                params={},
                orig=Exception("Simulated check constraint failed: chk_membership_role"),
            )
        return original_add(self, instance, *args, **kwargs)

    monkeypatch.setattr(Session, "add", mock_add)

    response = client.post("/api/v1/auth/register", json=reg_payload)
    assert response.status_code == 500

    # Verify atomic rollback: neither User nor Business remains
    orphaned_user = db.scalar(select(User).where(User.email == "membership.rollback@example.com"))
    assert orphaned_user is None
    orphaned_biz = db.scalar(select(Business).where(Business.name == "Rollback Workspace Corp"))
    assert orphaned_biz is None
