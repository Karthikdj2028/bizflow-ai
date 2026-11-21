"""Unit tests for multi-tenant workspace context dependencies and role-based guards.

Verifies:
- Explicit X-Business-ID header parsing and RFC 9457 HTTP 400 responses for missing/malformed values.
- Uniform HTTP 404 anti-enumeration responses for nonexistent vs. unpermitted workspaces.
- Construction-time fail-closed validation and case-sensitive exact matching for RequireRoles().
- Reusable assert_not_last_owner safeguard behavior.
"""

import uuid
import pytest
from starlette.requests import Request
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    EntityNotFoundError,
    ForbiddenError,
)
from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership, SUPPORTED_ROLES
from app.api.dependencies import (
    WorkspaceContext,
    get_current_workspace,
    RequireRoles,
    RequireOwner,
    RequireAdmin,
    RequireMember,
    RequireViewer,
)
from app.services.workspace import assert_not_last_owner


def _make_dummy_request(headers: dict[str, str] | None = None) -> Request:
    """Helper to instantiate a dummy Starlette Request with specific headers."""
    raw_headers = []
    if headers:
        for k, v in headers.items():
            raw_headers.append((k.lower().encode("latin-1"), v.encode("latin-1")))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/workspaces/current",
        "headers": raw_headers,
    }
    return Request(scope)


# ==============================================================================
# Header Parsing & Tenancy Resolution Tests
# ==============================================================================

def test_missing_business_header_raises_400(db: Session) -> None:
    """Verify that omitting X-Business-ID raises BadRequestError with code MISSING_BUSINESS_ID_HEADER."""
    dummy_user = User(
        email="tenant.test1@example.com",
        password_hash="dummy",
        full_name="Tenant Tester 1",
    )
    req = _make_dummy_request(headers={})

    with pytest.raises(BadRequestError) as exc_info:
        get_current_workspace(request=req, current_user=dummy_user, db=db)
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "MISSING_BUSINESS_ID_HEADER"
    assert "Missing required 'X-Business-ID' header" in exc_info.value.detail


def test_empty_business_header_raises_400(db: Session) -> None:
    """Verify that empty or whitespace-only X-Business-ID raises BadRequestError."""
    dummy_user = User(
        email="tenant.test2@example.com",
        password_hash="dummy",
        full_name="Tenant Tester 2",
    )
    req = _make_dummy_request(headers={"X-Business-ID": "   "})

    with pytest.raises(BadRequestError) as exc_info:
        get_current_workspace(request=req, current_user=dummy_user, db=db)
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "MISSING_BUSINESS_ID_HEADER"


def test_malformed_uuid_header_raises_400(db: Session) -> None:
    """Verify that a non-UUID string raises BadRequestError with code INVALID_BUSINESS_ID_FORMAT."""
    dummy_user = User(
        email="tenant.test3@example.com",
        password_hash="dummy",
        full_name="Tenant Tester 3",
    )
    req = _make_dummy_request(headers={"X-Business-ID": "not-a-valid-uuid-12345"})

    with pytest.raises(BadRequestError) as exc_info:
        get_current_workspace(request=req, current_user=dummy_user, db=db)
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "INVALID_BUSINESS_ID_FORMAT"
    assert "not a valid UUID" in exc_info.value.detail


def test_nonexistent_business_raises_uniform_404(db: Session) -> None:
    """Verify that a valid UUID not in the database raises EntityNotFoundError (404 BUSINESS_NOT_FOUND)."""
    dummy_user = User(
        email="tenant.test4@example.com",
        password_hash="dummy",
        full_name="Tenant Tester 4",
    )
    non_existent_uuid = str(uuid.uuid4())
    req = _make_dummy_request(headers={"X-Business-ID": non_existent_uuid})

    with pytest.raises(EntityNotFoundError) as exc_info:
        get_current_workspace(request=req, current_user=dummy_user, db=db)
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "BUSINESS_NOT_FOUND"
    assert exc_info.value.detail == "Requested business workspace not found."


def test_user_without_membership_raises_uniform_404(db: Session) -> None:
    """Verify that an existing workspace where the user is NOT a member returns identical 404 BUSINESS_NOT_FOUND.

    This proves uniform anti-enumeration behavior: non-member access returns identical response
    to a nonexistent business.
    """
    # Create User A and User B
    user_a = User(email="user_a@example.com", password_hash="hash", full_name="User A")
    user_b = User(email="user_b@example.com", password_hash="hash", full_name="User B")
    business_b = Business(name="Business B Workspace", base_currency="INR")
    db.add_all([user_a, user_b, business_b])
    db.flush()

    # User B is owner of Business B
    membership_b = BusinessMembership(user_id=user_b.id, business_id=business_b.id, role="OWNER")
    db.add(membership_b)
    db.commit()

    # User A attempts to access Business B using valid X-Business-ID
    req = _make_dummy_request(headers={"X-Business-ID": str(business_b.id)})

    with pytest.raises(EntityNotFoundError) as exc_info:
        get_current_workspace(request=req, current_user=user_a, db=db)
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "BUSINESS_NOT_FOUND"
    assert exc_info.value.detail == "Requested business workspace not found."


def test_valid_membership_returns_workspace_context(db: Session) -> None:
    """Verify that valid user and membership returns an immutable WorkspaceContext."""
    user = User(email="valid.member@example.com", password_hash="hash", full_name="Valid Member")
    business = Business(name="Valid Workspace", base_currency="INR")
    db.add_all([user, business])
    db.flush()

    membership = BusinessMembership(user_id=user.id, business_id=business.id, role="ADMIN")
    db.add(membership)
    db.commit()

    req = _make_dummy_request(headers={"X-Business-ID": str(business.id)})
    context = get_current_workspace(request=req, current_user=user, db=db)

    assert isinstance(context, WorkspaceContext)
    assert context.business_id == business.id
    assert context.user_id == user.id
    assert context.role == "ADMIN"
    assert context.business.name == "Valid Workspace"


# ==============================================================================
# Role Guard Construction & Enforcement Tests
# ==============================================================================

def test_require_roles_empty_allowed_roles_fails_closed() -> None:
    """Verify that RequireRoles() fails closed with ValueError when constructed with empty allowed_roles."""
    with pytest.raises(ValueError, match="RequireRoles requires at least one allowed role"):
        RequireRoles()


def test_require_roles_unknown_role_fails_closed() -> None:
    """Verify that RequireRoles() fails closed when given an unrecognized role string."""
    with pytest.raises(ValueError, match="Invalid role"):
        RequireRoles("SUPERADMIN")

    with pytest.raises(ValueError, match="Invalid role"):
        RequireRoles("OWNER", "ROOT_ADMIN")


def test_require_roles_case_sensitive_exact_matching() -> None:
    """Verify that role matching is strictly case-sensitive and rejects lowercase roles at construction."""
    with pytest.raises(ValueError, match="Invalid role"):
        RequireRoles("owner")

    with pytest.raises(ValueError, match="Invalid role"):
        RequireRoles("Admin")


def test_require_roles_permitted_access(db: Session) -> None:
    """Verify that role_checker permits access when WorkspaceContext.role matches whitelist."""
    user = User(email="perm.user@example.com", password_hash="hash", full_name="Perm User")
    business = Business(name="Perm Workspace", base_currency="INR")
    membership = BusinessMembership(user_id=user.id, business_id=business.id, role="ADMIN")
    context = WorkspaceContext(business=business, membership=membership, user=user)

    admin_checker = RequireRoles("OWNER", "ADMIN")
    assert admin_checker(context) == context


def test_require_roles_denies_insufficient_role_with_403(db: Session) -> None:
    """Verify that role_checker raises ForbiddenError (403 INSUFFICIENT_ROLE_PERMISSIONS) on mismatch."""
    user = User(email="viewer.user@example.com", password_hash="hash", full_name="Viewer User")
    business = Business(name="Viewer Workspace", base_currency="INR")
    membership = BusinessMembership(user_id=user.id, business_id=business.id, role="VIEWER")
    context = WorkspaceContext(business=business, membership=membership, user=user)

    owner_checker = RequireRoles("OWNER")
    with pytest.raises(ForbiddenError) as exc_info:
        owner_checker(context)
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "INSUFFICIENT_ROLE_PERMISSIONS"
    assert "Insufficient role permissions" in exc_info.value.detail
    assert "Your role: 'VIEWER'" in exc_info.value.detail


def test_require_viewer_allows_all_supported_roles(db: Session) -> None:
    """Verify that RequireViewer allows all four supported roles (minimum permission level)."""
    user = User(email="multi.role@example.com", password_hash="hash", full_name="Multi Role")
    business = Business(name="Multi Workspace", base_currency="INR")
    viewer_checker = RequireRoles("OWNER", "ADMIN", "MEMBER", "VIEWER")

    for role in ("OWNER", "ADMIN", "MEMBER", "VIEWER"):
        membership = BusinessMembership(user_id=user.id, business_id=business.id, role=role)
        context = WorkspaceContext(business=business, membership=membership, user=user)
        assert viewer_checker(context) == context


# ==============================================================================
# Last-Owner Safeguard Tests
# ==============================================================================

def test_last_owner_protection_assertion_raises_409(db: Session) -> None:
    """Verify that assert_not_last_owner raises ConflictError when target user is the sole owner."""
    user = User(email="sole.owner@example.com", password_hash="hash", full_name="Sole Owner")
    business = Business(name="Sole Workspace", base_currency="INR")
    db.add_all([user, business])
    db.flush()

    membership = BusinessMembership(user_id=user.id, business_id=business.id, role="OWNER")
    db.add(membership)
    db.commit()

    with pytest.raises(ConflictError) as exc_info:
        assert_not_last_owner(db=db, business_id=business.id, user_id=user.id)
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "CANNOT_REMOVE_LAST_OWNER"
    assert "sole remaining OWNER" in exc_info.value.detail


def test_last_owner_protection_permits_when_multiple_owners(db: Session) -> None:
    """Verify that assert_not_last_owner succeeds cleanly when more than one owner exists."""
    user1 = User(email="owner1@example.com", password_hash="hash", full_name="Owner 1")
    user2 = User(email="owner2@example.com", password_hash="hash", full_name="Owner 2")
    business = Business(name="Dual Owner Workspace", base_currency="INR")
    db.add_all([user1, user2, business])
    db.flush()

    m1 = BusinessMembership(user_id=user1.id, business_id=business.id, role="OWNER")
    m2 = BusinessMembership(user_id=user2.id, business_id=business.id, role="OWNER")
    db.add_all([m1, m2])
    db.commit()

    # User 1 is not the last owner because User 2 is also OWNER
    assert_not_last_owner(db=db, business_id=business.id, user_id=user1.id)


def test_last_owner_protection_ignores_non_owner(db: Session) -> None:
    """Verify that assert_not_last_owner succeeds cleanly when the target user is a MEMBER or VIEWER."""
    user1 = User(email="member.target@example.com", password_hash="hash", full_name="Member Target")
    business = Business(name="Non Owner Workspace", base_currency="INR")
    db.add_all([user1, business])
    db.flush()

    m = BusinessMembership(user_id=user1.id, business_id=business.id, role="MEMBER")
    db.add(m)
    db.commit()

    # Member can be removed without violating the last-owner invariant
    assert_not_last_owner(db=db, business_id=business.id, user_id=user1.id)
