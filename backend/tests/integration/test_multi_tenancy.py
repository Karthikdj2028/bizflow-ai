"""Integration tests for multi-tenant workspace context, isolation, and role authorization.

Verifies:
- Workspace discovery (header-free) and workspace inspection (X-Business-ID required).
- Missing and malformed X-Business-ID HTTP 400 responses.
- Uniform 404 anti-enumeration on cross-tenant access.
- Multi-workspace switching and isolation.
- Request payload tenant override prevention.
- Membership deletion revocation.
- Role-based authorization boundaries (Owner, Admin, Member, Viewer).
- Inactive user access denial.
"""

import uuid
from typing import Annotated
from fastapi import APIRouter, Depends, status
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership
from app.api.dependencies import (
    CurrentBusinessDep,
    RequireAdmin,
    RequireMember,
    RequireOwner,
    RequireViewer,
    WorkspaceContext,
)


def _register_user_and_get_token(client: TestClient, email: str, name: str, biz_name: str) -> dict:
    """Helper to register a user and return response with user, token, and business."""
    payload = {
        "email": email,
        "password": "ValidPassword123!",
        "full_name": name,
        "initial_business_name": biz_name,
    }
    res = client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 201
    return res.json()


# ==============================================================================
# Workspace Discovery & Inspection Endpoint Tests
# ==============================================================================

def test_list_workspaces_without_header(client: TestClient) -> None:
    """Verify that GET /api/v1/workspaces succeeds WITHOUT X-Business-ID header."""
    auth_data = _register_user_and_get_token(
        client, "list.test@example.com", "List Tester", "Primary Corp"
    )
    token = auth_data["token"]["access_token"]

    response = client.get(
        "/api/v1/workspaces",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert data["total"] >= 1
    assert any(w["name"] == "Primary Corp" and w["role"] == "OWNER" for w in data["items"])


def test_list_workspaces_membership_isolation(client: TestClient) -> None:
    """Verify that user A only sees their own workspaces, with zero leakage of user B's workspaces."""
    auth_a = _register_user_and_get_token(
        client, "isolation.a@example.com", "User A", "Alpha Logistics"
    )
    auth_b = _register_user_and_get_token(
        client, "isolation.b@example.com", "User B", "Beta Enterprises"
    )

    token_a = auth_a["token"]["access_token"]
    token_b = auth_b["token"]["access_token"]

    res_a = client.get("/api/v1/workspaces", headers={"Authorization": f"Bearer {token_a}"})
    assert res_a.status_code == 200
    items_a = res_a.json()["items"]
    assert len(items_a) == 1
    assert items_a[0]["name"] == "Alpha Logistics"
    assert not any(w["name"] == "Beta Enterprises" for w in items_a)

    res_b = client.get("/api/v1/workspaces", headers={"Authorization": f"Bearer {token_b}"})
    assert res_b.status_code == 200
    items_b = res_b.json()["items"]
    assert len(items_b) == 1
    assert items_b[0]["name"] == "Beta Enterprises"
    assert not any(w["name"] == "Alpha Logistics" for w in items_b)


def test_get_current_workspace_success(client: TestClient, db: Session) -> None:
    """Verify that GET /api/v1/workspaces/current returns 200 with verified workspace metadata and role."""
    auth_data = _register_user_and_get_token(
        client, "current.test@example.com", "Current Tester", "Omega Systems"
    )
    token = auth_data["token"]["access_token"]
    user_id = uuid.UUID(auth_data["user"]["id"])

    # Look up business_id created during registration
    biz = db.scalar(
        select(Business)
        .join(BusinessMembership, BusinessMembership.business_id == Business.id)
        .where(BusinessMembership.user_id == user_id)
    )
    assert biz is not None

    response = client.get(
        "/api/v1/workspaces/current",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Business-ID": str(biz.id),
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(biz.id)
    assert data["name"] == "Omega Systems"
    assert data["base_currency"] == "INR"
    assert data["role"] == "OWNER"


def test_get_current_workspace_requires_header(client: TestClient) -> None:
    """Verify that GET /api/v1/workspaces/current returns HTTP 400 when X-Business-ID is missing."""
    auth_data = _register_user_and_get_token(
        client, "noheader@example.com", "No Header User", "No Header Corp"
    )
    token = auth_data["token"]["access_token"]

    response = client.get(
        "/api/v1/workspaces/current",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    data = response.json()
    assert data["code"] == "MISSING_BUSINESS_ID_HEADER"
    assert "Missing required 'X-Business-ID' header" in data["detail"]


def test_get_current_workspace_malformed_header_400(client: TestClient) -> None:
    """Verify that GET /api/v1/workspaces/current returns HTTP 400 when X-Business-ID is not a valid UUID."""
    auth_data = _register_user_and_get_token(
        client, "baduuid@example.com", "Bad UUID User", "Bad UUID Corp"
    )
    token = auth_data["token"]["access_token"]

    response = client.get(
        "/api/v1/workspaces/current",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Business-ID": "12345-not-a-uuid",
        },
    )
    assert response.status_code == 400
    data = response.json()
    assert data["code"] == "INVALID_BUSINESS_ID_FORMAT"
    assert "not a valid UUID" in data["detail"]


# ==============================================================================
# Cross-Tenant Privacy & Anti-Enumeration Tests
# ==============================================================================

def test_cross_tenant_access_denial_uniform_404(client: TestClient, db: Session) -> None:
    """Verify that User A accessing Business B returns an identical HTTP 404 to a non-existent business.

    Uniform 404 anti-enumeration: An attacker cannot distinguish between a non-existent
    workspace and an unauthorized workspace.
    """
    auth_a = _register_user_and_get_token(client, "alice@example.com", "Alice", "Alice Org")
    auth_b = _register_user_and_get_token(client, "bob@example.com", "Bob", "Bob Org")

    token_a = auth_a["token"]["access_token"]
    user_b_id = uuid.UUID(auth_b["user"]["id"])

    # Get Bob's business ID
    biz_b = db.scalar(
        select(Business)
        .join(BusinessMembership, BusinessMembership.business_id == Business.id)
        .where(BusinessMembership.user_id == user_b_id)
    )

    # Alice attempts to access Bob's workspace via X-Business-ID
    res_unauthorized = client.get(
        "/api/v1/workspaces/current",
        headers={
            "Authorization": f"Bearer {token_a}",
            "X-Business-ID": str(biz_b.id),
        },
    )
    assert res_unauthorized.status_code == 404
    data_unauth = res_unauthorized.json()
    assert data_unauth["code"] == "BUSINESS_NOT_FOUND"

    # Compare with Alice attempting to access a random non-existent UUID
    random_uuid = str(uuid.uuid4())
    res_nonexistent = client.get(
        "/api/v1/workspaces/current",
        headers={
            "Authorization": f"Bearer {token_a}",
            "X-Business-ID": random_uuid,
        },
    )
    assert res_nonexistent.status_code == 404
    data_nonexist = res_nonexistent.json()
    assert data_nonexist["code"] == "BUSINESS_NOT_FOUND"

    # Both responses must be identical in structure and message
    assert data_unauth["detail"] == data_nonexist["detail"]
    assert data_unauth["title"] == data_nonexist["title"]


def test_multi_workspace_switching(client: TestClient, db: Session) -> None:
    """Verify that a user who belongs to multiple workspaces can switch context via X-Business-ID."""
    auth_user = _register_user_and_get_token(
        client, "multi.switcher@example.com", "Multi Switcher", "Workspace One"
    )
    token = auth_user["token"]["access_token"]
    user_id = uuid.UUID(auth_user["user"]["id"])

    # Create a second workspace and add this user as MEMBER
    biz2 = Business(name="Workspace Two", base_currency="INR")
    db.add(biz2)
    db.flush()

    m2 = BusinessMembership(user_id=user_id, business_id=biz2.id, role="MEMBER")
    db.add(m2)
    db.commit()

    # Get Workspace One ID
    biz1 = db.scalar(
        select(Business)
        .join(BusinessMembership, BusinessMembership.business_id == Business.id)
        .where(BusinessMembership.user_id == user_id, Business.name == "Workspace One")
    )

    # 1. Access Workspace One -> OWNER
    res1 = client.get(
        "/api/v1/workspaces/current",
        headers={"Authorization": f"Bearer {token}", "X-Business-ID": str(biz1.id)},
    )
    assert res1.status_code == 200
    assert res1.json()["name"] == "Workspace One"
    assert res1.json()["role"] == "OWNER"

    # 2. Access Workspace Two -> MEMBER
    res2 = client.get(
        "/api/v1/workspaces/current",
        headers={"Authorization": f"Bearer {token}", "X-Business-ID": str(biz2.id)},
    )
    assert res2.status_code == 200
    assert res2.json()["name"] == "Workspace Two"
    assert res2.json()["role"] == "MEMBER"


def test_membership_deletion_immediate_revocation(client: TestClient, db: Session) -> None:
    """Verify that deleting a membership row immediately revokes access on the next HTTP request."""
    auth_user = _register_user_and_get_token(
        client, "revoked@example.com", "Revoked User", "Revoke Org"
    )
    token = auth_user["token"]["access_token"]
    user_id = uuid.UUID(auth_user["user"]["id"])

    # Create Workspace X where user is MEMBER
    biz = Business(name="Workspace X", base_currency="INR")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=user_id, business_id=biz.id, role="MEMBER")
    db.add(membership)
    db.commit()

    # Access succeeds initially
    res_before = client.get(
        "/api/v1/workspaces/current",
        headers={"Authorization": f"Bearer {token}", "X-Business-ID": str(biz.id)},
    )
    assert res_before.status_code == 200

    # Revoke membership by deleting the membership row
    db.delete(membership)
    db.commit()

    # Subsequent request immediately returns 404 BUSINESS_NOT_FOUND
    res_after = client.get(
        "/api/v1/workspaces/current",
        headers={"Authorization": f"Bearer {token}", "X-Business-ID": str(biz.id)},
    )
    assert res_after.status_code == 404
    assert res_after.json()["code"] == "BUSINESS_NOT_FOUND"


def test_inactive_user_tenant_access_blocked(client: TestClient, db: Session) -> None:
    """Verify that deactivated user account is rejected before workspace context is resolved."""
    auth_data = _register_user_and_get_token(
        client, "deact@example.com", "Deact User", "Deact Corp"
    )
    token = auth_data["token"]["access_token"]
    user_id = uuid.UUID(auth_data["user"]["id"])

    biz = db.scalar(
        select(Business)
        .join(BusinessMembership, BusinessMembership.business_id == Business.id)
        .where(BusinessMembership.user_id == user_id)
    )

    # Deactivate the user
    user = db.get(User, user_id)
    user.is_active = False
    db.commit()

    response = client.get(
        "/api/v1/workspaces/current",
        headers={"Authorization": f"Bearer {token}", "X-Business-ID": str(biz.id)},
    )
    assert response.status_code == 401
    assert response.json()["code"] == "ACCOUNT_INACTIVE"


# ==============================================================================
# Role Hierarchy & Payload Override Prevention Tests
# ==============================================================================

# Test-only route schemas and router to verify role boundaries & payload override immunity
class MockItemCreate(BaseModel):
    item_name: str
    business_id: str | None = None


mock_rbac_router = APIRouter(prefix="/test-tenancy", tags=["Testing"])


@mock_rbac_router.get("/owner-only")
def handle_owner_route(context: RequireOwner) -> dict:
    return {"status": "ok", "role": context.role}


@mock_rbac_router.get("/admin-only")
def handle_admin_route(context: RequireAdmin) -> dict:
    return {"status": "ok", "role": context.role}


@mock_rbac_router.get("/member-only")
def handle_member_route(context: RequireMember) -> dict:
    return {"status": "ok", "role": context.role}


@mock_rbac_router.get("/viewer-only")
def handle_viewer_route(context: RequireViewer) -> dict:
    return {"status": "ok", "role": context.role}


@mock_rbac_router.post("/items")
def handle_payload_override_route(
    payload: MockItemCreate,
    context: CurrentBusinessDep,
) -> dict:
    # Server strictly binds to context.business_id, completely ignoring any foreign payload ID
    bound_business_id = str(context.business_id)
    return {
        "item_name": payload.item_name,
        "effective_business_id": bound_business_id,
        "ignored_payload_id": payload.business_id,
    }


def test_role_hierarchy_boundary_enforcement(client: TestClient, db: Session) -> None:
    """Verify role boundaries: VIEWER < MEMBER < ADMIN < OWNER across protected routes."""
    from app.main import app
    app.include_router(mock_rbac_router)

    # Create users with different roles in the same business
    business = Business(name="RBAC Enterprise", base_currency="INR")
    db.add(business)
    db.flush()

    users_roles = {
        "owner": ("rbac.owner@example.com", "OWNER"),
        "admin": ("rbac.admin@example.com", "ADMIN"),
        "member": ("rbac.member@example.com", "MEMBER"),
        "viewer": ("rbac.viewer@example.com", "VIEWER"),
    }
    tokens = {}

    for key, (email, role) in users_roles.items():
        auth = _register_user_and_get_token(client, email, f"User {key}", f"Temp Org {key}")
        tokens[key] = auth["token"]["access_token"]
        uid = uuid.UUID(auth["user"]["id"])
        # Add to RBAC Enterprise with the specific role
        m = BusinessMembership(user_id=uid, business_id=business.id, role=role)
        db.add(m)
    db.commit()

    biz_header = {"X-Business-ID": str(business.id)}

    # 1. OWNER route
    assert client.get("/test-tenancy/owner-only", headers={"Authorization": f"Bearer {tokens['owner']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/owner-only", headers={"Authorization": f"Bearer {tokens['admin']}", **biz_header}).status_code == 403
    assert client.get("/test-tenancy/owner-only", headers={"Authorization": f"Bearer {tokens['member']}", **biz_header}).status_code == 403
    assert client.get("/test-tenancy/owner-only", headers={"Authorization": f"Bearer {tokens['viewer']}", **biz_header}).status_code == 403

    # 2. ADMIN route (permits OWNER, ADMIN)
    assert client.get("/test-tenancy/admin-only", headers={"Authorization": f"Bearer {tokens['owner']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/admin-only", headers={"Authorization": f"Bearer {tokens['admin']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/admin-only", headers={"Authorization": f"Bearer {tokens['member']}", **biz_header}).status_code == 403
    assert client.get("/test-tenancy/admin-only", headers={"Authorization": f"Bearer {tokens['viewer']}", **biz_header}).status_code == 403

    # 3. MEMBER route (permits OWNER, ADMIN, MEMBER)
    assert client.get("/test-tenancy/member-only", headers={"Authorization": f"Bearer {tokens['owner']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/member-only", headers={"Authorization": f"Bearer {tokens['admin']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/member-only", headers={"Authorization": f"Bearer {tokens['member']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/member-only", headers={"Authorization": f"Bearer {tokens['viewer']}", **biz_header}).status_code == 403

    # 4. VIEWER route (permits all authenticated members)
    assert client.get("/test-tenancy/viewer-only", headers={"Authorization": f"Bearer {tokens['owner']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/viewer-only", headers={"Authorization": f"Bearer {tokens['admin']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/viewer-only", headers={"Authorization": f"Bearer {tokens['member']}", **biz_header}).status_code == 200
    assert client.get("/test-tenancy/viewer-only", headers={"Authorization": f"Bearer {tokens['viewer']}", **biz_header}).status_code == 200


def test_request_body_business_id_override_prevention(client: TestClient, db: Session) -> None:
    """Verify that a client supplying a rogue business_id in the JSON body cannot override the validated workspace context."""
    from app.main import app
    app.include_router(mock_rbac_router)

    auth = _register_user_and_get_token(
        client, "override.tester@example.com", "Override User", "Legitimate Workspace"
    )
    token = auth["token"]["access_token"]
    user_id = uuid.UUID(auth["user"]["id"])

    # Get Legitimate Workspace ID
    legit_biz = db.scalar(
        select(Business)
        .join(BusinessMembership, BusinessMembership.business_id == Business.id)
        .where(BusinessMembership.user_id == user_id)
    )

    # Create a separate, valid foreign workspace UUID
    foreign_biz = Business(name="Foreign Unrelated Corp", base_currency="INR")
    db.add(foreign_biz)
    db.commit()

    foreign_rogue_id = str(foreign_biz.id)
    payload = {
        "item_name": "Accounting Document",
        "business_id": foreign_rogue_id,  # Exact JSON key 'business_id' containing foreign workspace UUID
    }

    response = client.post(
        "/test-tenancy/items",
        json=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Business-ID": str(legit_biz.id),
        },
    )
    assert response.status_code == 200
    res_data = response.json()
    # Effective business ID must strictly match legitimate workspace context, completely ignoring rogue payload ID
    assert res_data["effective_business_id"] == str(legit_biz.id)
    assert res_data["effective_business_id"] != foreign_rogue_id
    assert res_data["ignored_payload_id"] == foreign_rogue_id
