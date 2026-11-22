"""Integration tests for Customer Management API endpoints, RBAC, and multi-tenant isolation."""

import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.business import Business
from app.models.customer import Customer
from app.models.membership import BusinessMembership
from app.models.user import User


@pytest.fixture
def auth_user(db: Session) -> User:
    """Create an active authenticated test user."""
    user = User(
        email="test_user@bizflow.ai",
        password_hash="hashed_dummy_pw",
        full_name="Test Operator",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def user_token(auth_user: User) -> str:
    """JWT Bearer token for auth_user."""
    return create_access_token(auth_user.id)


@pytest.fixture
def workspace_as_owner(db: Session, auth_user: User) -> Business:
    """Workspace where auth_user is OWNER."""
    biz = Business(name="Owner Workspace", base_currency="USD")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="OWNER")
    db.add(membership)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_admin(db: Session, auth_user: User) -> Business:
    """Workspace where auth_user is ADMIN."""
    biz = Business(name="Admin Workspace", base_currency="USD")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="ADMIN")
    db.add(membership)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_member(db: Session, auth_user: User) -> Business:
    """Workspace where auth_user is MEMBER."""
    biz = Business(name="Member Workspace", base_currency="USD")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="MEMBER")
    db.add(membership)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_viewer(db: Session, auth_user: User) -> Business:
    """Workspace where auth_user is VIEWER."""
    biz = Business(name="Viewer Workspace", base_currency="USD")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="VIEWER")
    db.add(membership)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def foreign_workspace(db: Session) -> Business:
    """Unrelated workspace owned by another user."""
    other_user = User(
        email="other@bizflow.ai",
        password_hash="hashed_other",
        full_name="Other User",
        is_active=True,
    )
    db.add(other_user)
    db.flush()
    biz = Business(name="Foreign Workspace", base_currency="EUR")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=other_user.id, business_id=biz.id, role="OWNER")
    db.add(membership)
    db.commit()
    db.refresh(biz)
    return biz


def test_create_customer_success_owner(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """OWNER can create customer with contact info and payment terms."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    payload = {
        "name": "Acme Global Industries",
        "email": "billing@acmeglobal.com",
        "phone": "+1-555-0199",
        "billing_address": "100 Industrial Parkway, Chicago, IL",
        "payment_terms_days": 15,
    }
    response = client.post("/api/v1/customers", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Acme Global Industries"
    assert data["email"] == "billing@acmeglobal.com"
    assert data["phone"] == "+1-555-0199"
    assert data["payment_terms_days"] == 15
    assert data["is_active"] is True
    assert data["business_id"] == str(workspace_as_owner.id)


def test_create_customer_rbac_member(
    client: TestClient,
    user_token: str,
    workspace_as_member: Business,
):
    """MEMBER role can create customer profiles."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_member.id),
    }
    payload = {"name": "Member Client", "payment_terms_days": 30}
    response = client.post("/api/v1/customers", json=payload, headers=headers)
    assert response.status_code == 201


def test_create_customer_rbac_viewer_forbidden(
    client: TestClient,
    user_token: str,
    workspace_as_viewer: Business,
):
    """VIEWER role cannot create customer profiles (403 Forbidden)."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_viewer.id),
    }
    payload = {"name": "Disallowed Client"}
    response = client.post("/api/v1/customers", json=payload, headers=headers)
    assert response.status_code == 403


def test_create_customer_validation_errors(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """Validation rejects empty name, negative payment terms, and malformed email."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }

    # 1. Empty name
    res1 = client.post("/api/v1/customers", json={"name": "   "}, headers=headers)
    assert res1.status_code == 422

    # 2. Negative payment terms
    res2 = client.post("/api/v1/customers", json={"name": "Valid", "payment_terms_days": -10}, headers=headers)
    assert res2.status_code == 422

    # 3. Invalid email format
    res3 = client.post("/api/v1/customers", json={"name": "Valid", "email": "not-an-email"}, headers=headers)
    assert res3.status_code == 422


def test_list_customers_active_and_inactive(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """List endpoint separates active and inactive customers."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    # Create active customer
    client.post("/api/v1/customers", json={"name": "Active 1"}, headers=headers)
    # Create inactive customer
    client.post("/api/v1/customers", json={"name": "Inactive 1", "is_active": False}, headers=headers)

    # Default listing (is_active=true)
    res_default = client.get("/api/v1/customers", headers=headers)
    assert res_default.status_code == 200
    data_def = res_default.json()
    assert data_def["total"] == 1
    assert data_def["items"][0]["name"] == "Active 1"

    # Filter is_active=false
    res_inactive = client.get("/api/v1/customers?is_active=false", headers=headers)
    assert res_inactive.status_code == 200
    data_inact = res_inactive.json()
    assert data_inact["total"] == 1
    assert data_inact["items"][0]["name"] == "Inactive 1"


def test_get_customer_by_id(
    client: TestClient,
    user_token: str,
    workspace_as_viewer: Business,
    workspace_as_owner: Business,
):
    """All workspace roles can fetch single customer; nonexistent ID returns 404."""
    headers_owner = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_res = client.post("/api/v1/customers", json={"name": "Target Client"}, headers=headers_owner)
    customer_id = create_res.json()["id"]

    # Retrieve as owner
    get_res = client.get(f"/api/v1/customers/{customer_id}", headers=headers_owner)
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Target Client"

    # Nonexistent customer ID returns 404 Problem Details
    missing_id = uuid.uuid4()
    missing_res = client.get(f"/api/v1/customers/{missing_id}", headers=headers_owner)
    assert missing_res.status_code == 404
    assert missing_res.json()["code"] == "CUSTOMER_NOT_FOUND"


def test_patch_customer_success_and_null_clearing(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """PATCH updates specified fields and null clears optional fields."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_res = client.post(
        "/api/v1/customers",
        json={
            "name": "Original Name",
            "email": "orig@test.com",
            "phone": "+1-555",
            "billing_address": "Original Address",
            "payment_terms_days": 30,
        },
        headers=headers,
    )
    customer_id = create_res.json()["id"]

    # Partial update: change name and payment terms, clear phone
    patch_res = client.patch(
        f"/api/v1/customers/{customer_id}",
        json={
            "name": "Updated Name",
            "phone": None,
            "payment_terms_days": 60,
        },
        headers=headers,
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["name"] == "Updated Name"
    assert data["phone"] is None
    assert data["payment_terms_days"] == 60
    assert data["email"] == "orig@test.com"
    assert data["billing_address"] == "Original Address"


def test_patch_empty_body_rejected(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """PATCH with empty payload returns 400 Bad Request."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_res = client.post("/api/v1/customers", json={"name": "Client A"}, headers=headers)
    customer_id = create_res.json()["id"]

    patch_res = client.patch(f"/api/v1/customers/{customer_id}", json={}, headers=headers)
    assert patch_res.status_code == 400
    assert patch_res.json()["code"] == "EMPTY_UPDATE_PAYLOAD"


def test_patch_explicit_null_rejected_with_422(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """PATCH with explicit null for name, payment_terms_days, or is_active returns HTTP 422."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_res = client.post(
        "/api/v1/customers",
        json={
            "name": "Immutable Client",
            "payment_terms_days": 30,
            "is_active": True,
        },
        headers=headers,
    )
    customer_id = create_res.json()["id"]

    # 1. Explicit null for name -> 422
    res_name = client.patch(f"/api/v1/customers/{customer_id}", json={"name": None}, headers=headers)
    assert res_name.status_code == 422

    # 2. Explicit null for payment_terms_days -> 422
    res_terms = client.patch(f"/api/v1/customers/{customer_id}", json={"payment_terms_days": None}, headers=headers)
    assert res_terms.status_code == 422

    # 3. Explicit null for is_active -> 422
    res_active = client.patch(f"/api/v1/customers/{customer_id}", json={"is_active": None}, headers=headers)
    assert res_active.status_code == 422

    # 4. Verify customer record in database remains unmodified
    verify_res = client.get(f"/api/v1/customers/{customer_id}", headers=headers)
    assert verify_res.status_code == 200
    data = verify_res.json()
    assert data["name"] == "Immutable Client"
    assert data["payment_terms_days"] == 30
    assert data["is_active"] is True


def test_delete_customer_rbac_and_soft_delete(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    workspace_as_member: Business,
    workspace_as_viewer: Business,
):
    """DELETE requires OWNER/ADMIN; returns 204 No Content; soft-deletes record."""
    headers_owner = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_res = client.post("/api/v1/customers", json={"name": "To Deactivate"}, headers=headers_owner)
    customer_id = create_res.json()["id"]

    # 1. MEMBER cannot delete (403 Forbidden)
    headers_member = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_member.id),
    }
    del_member_res = client.delete(f"/api/v1/customers/{customer_id}", headers=headers_member)
    assert del_member_res.status_code == 403

    # 2. VIEWER cannot delete (403 Forbidden)
    headers_viewer = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_viewer.id),
    }
    del_viewer_res = client.delete(f"/api/v1/customers/{customer_id}", headers=headers_viewer)
    assert del_viewer_res.status_code == 403

    # 3. OWNER deletes -> 204 No Content
    del_res = client.delete(f"/api/v1/customers/{customer_id}", headers=headers_owner)
    assert del_res.status_code == 204

    # Record is soft-deleted (is_active = False), still retrievable
    get_res = client.get(f"/api/v1/customers/{customer_id}", headers=headers_owner)
    assert get_res.status_code == 200
    assert get_res.json()["is_active"] is False


def test_cross_tenant_isolation_uniform_404(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    foreign_workspace: Business,
    db: Session,
):
    """Customer belonging to Foreign Workspace returns uniform 404 when queried from Workspace Alpha."""
    # Create customer in foreign workspace
    foreign_cust = Customer(
        business_id=foreign_workspace.id,
        name="Foreign Secret Client",
        payment_terms_days=30,
        is_active=True,
    )
    db.add(foreign_cust)
    db.commit()
    db.refresh(foreign_cust)

    headers_alpha = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }

    # 1. GET foreign customer returns 404
    get_res = client.get(f"/api/v1/customers/{foreign_cust.id}", headers=headers_alpha)
    assert get_res.status_code == 404
    assert get_res.json()["code"] == "CUSTOMER_NOT_FOUND"

    # 2. PATCH foreign customer returns 404
    patch_res = client.patch(
        f"/api/v1/customers/{foreign_cust.id}",
        json={"name": "Hijacked Name"},
        headers=headers_alpha,
    )
    assert patch_res.status_code == 404
    assert patch_res.json()["code"] == "CUSTOMER_NOT_FOUND"

    # 3. DELETE foreign customer returns 404
    del_res = client.delete(f"/api/v1/customers/{foreign_cust.id}", headers=headers_alpha)
    assert del_res.status_code == 404
    assert del_res.json()["code"] == "CUSTOMER_NOT_FOUND"


def test_list_customers_pagination_validation(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
):
    """Pagination query params validate bounds (page >= 1, page_size <= 100)."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    # Page < 1
    res1 = client.get("/api/v1/customers?page=0", headers=headers)
    assert res1.status_code == 422

    # Page size > 100
    res2 = client.get("/api/v1/customers?page_size=101", headers=headers)
    assert res2.status_code == 422
