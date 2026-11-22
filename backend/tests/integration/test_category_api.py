"""Integration tests for Category API endpoints, RBAC, and multi-tenant isolation."""

import uuid
from decimal import Decimal
from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.business import Business
from app.models.category import Category
from app.models.membership import BusinessMembership
from app.models.transaction import Transaction
from app.models.user import User
from app.services.category import seed_default_categories


@pytest.fixture
def auth_user(db: Session) -> User:
    """Create a persistent active user."""
    user = User(
        email="operator@bizflow.ai",
        password_hash="dummy_hash_for_testing_purposes",
        full_name="Operations User",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def user_token(auth_user: User) -> str:
    """Generate access token for auth_user."""
    return create_access_token(auth_user.id)


@pytest.fixture
def workspace_with_owner(db: Session, auth_user: User) -> Business:
    """Create a business workspace where auth_user is OWNER and categories are seeded."""
    biz = Business(name="Primary Workspace", base_currency="INR")
    db.add(biz)
    db.flush()

    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="OWNER")
    db.add(membership)
    seed_default_categories(db, biz.id)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_viewer(db: Session, auth_user: User) -> Business:
    """Create a business workspace where auth_user is VIEWER."""
    biz = Business(name="Readonly Workspace", base_currency="INR")
    db.add(biz)
    db.flush()

    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="VIEWER")
    db.add(membership)
    seed_default_categories(db, biz.id)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_member(db: Session, auth_user: User) -> Business:
    """Create a business workspace where auth_user is MEMBER."""
    biz = Business(name="Member Workspace", base_currency="INR")
    db.add(biz)
    db.flush()

    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="MEMBER")
    db.add(membership)
    seed_default_categories(db, biz.id)
    db.commit()
    db.refresh(biz)
    return biz


def test_get_categories_strictly_read_only(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify GET /api/v1/categories returns 9 default categories with 200 OK."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    response = client.get("/api/v1/categories", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert data["total"] == 9
    assert len(data["items"]) == 9
    assert all(c["is_system_default"] is True for c in data["items"])


def test_get_categories_type_filter(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify filtering categories by type query parameter."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    res_income = client.get("/api/v1/categories?type=INCOME", headers=headers)
    assert res_income.status_code == 200
    data_income = res_income.json()
    assert data_income["total"] == 3
    assert all(c["type"] == "INCOME" for c in data_income["items"])

    res_expense = client.get("/api/v1/categories?type=EXPENSE", headers=headers)
    assert res_expense.status_code == 200
    data_expense = res_expense.json()
    assert data_expense["total"] == 6
    assert all(c["type"] == "EXPENSE" for c in data_expense["items"])


def test_create_custom_category_success(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify creating a custom category with valid color and name."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    payload = {
        "name": "Cloud Infrastructure",
        "type": "EXPENSE",
        "description": "AWS, GCP, and Azure compute charges",
        "color_hex": "#0ea5e9",
    }
    response = client.post("/api/v1/categories", json=payload, headers=headers)
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Cloud Infrastructure"
    assert created["type"] == "EXPENSE"
    assert created["color_hex"] == "#0EA5E9"
    assert created["is_system_default"] is False
    assert created["business_id"] == str(workspace_with_owner.id)


def test_create_category_duplicate_rejected_409(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify duplicate category names are rejected case-insensitively with 409 Conflict."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    # "Sales & Services" is a default INCOME category
    payload = {
        "name": "sales & services",  # lowercase
        "type": "INCOME",
        "color_hex": "#10B981",
    }
    response = client.post("/api/v1/categories", json=payload, headers=headers)
    assert response.status_code == 409
    assert response.json()["code"] == "CATEGORY_ALREADY_EXISTS"


def test_create_category_invalid_color_hex_422(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify malformed color hex values are rejected with 422 Unprocessable Entity."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    payload = {
        "name": "Bad Color Category",
        "type": "EXPENSE",
        "color_hex": "not-a-color",
    }
    response = client.post("/api/v1/categories", json=payload, headers=headers)
    assert response.status_code == 422


def test_update_category_success(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify updating a custom category's name, description, and color."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    # Create category first
    create_res = client.post(
        "/api/v1/categories",
        json={"name": "Logistics Fees", "type": "EXPENSE"},
        headers=headers,
    )
    cat_id = create_res.json()["id"]

    # Update category
    patch_res = client.patch(
        f"/api/v1/categories/{cat_id}",
        json={"name": "Freight & Logistics", "color_hex": "#FF5733"},
        headers=headers,
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["name"] == "Freight & Logistics"
    assert updated["color_hex"] == "#FF5733"


def test_update_category_description_clearing_and_omission(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify description handling over REST API: omission preserves, string updates, null clears."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }

    # Create category with initial description
    create_res = client.post(
        "/api/v1/categories",
        json={"name": "Office Supplies", "type": "EXPENSE", "description": "Desk items"},
        headers=headers,
    )
    assert create_res.status_code == 201
    cat_id = create_res.json()["id"]
    assert create_res.json()["description"] == "Desk items"

    # 1. Omitted description: update color only, description must be preserved
    patch_omitted = client.patch(
        f"/api/v1/categories/{cat_id}",
        json={"color_hex": "#336699"},
        headers=headers,
    )
    assert patch_omitted.status_code == 200
    assert patch_omitted.json()["description"] == "Desk items"
    assert patch_omitted.json()["color_hex"] == "#336699"

    # 2. String description: update description value
    patch_string = client.patch(
        f"/api/v1/categories/{cat_id}",
        json={"description": "Updated stationery and pens"},
        headers=headers,
    )
    assert patch_string.status_code == 200
    assert patch_string.json()["description"] == "Updated stationery and pens"

    # 3. Explicit null description: clear existing description
    patch_null = client.patch(
        f"/api/v1/categories/{cat_id}",
        json={"description": None},
        headers=headers,
    )
    assert patch_null.status_code == 200
    assert patch_null.json()["description"] is None

    # 4. Verify persistence in subsequent GET
    get_res = client.get("/api/v1/categories", headers=headers)
    assert get_res.status_code == 200
    items = get_res.json()["items"]
    persisted_cat = next(c for c in items if c["id"] == cat_id)
    assert persisted_cat["description"] is None


def test_delete_custom_category_success(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify deleting an unused custom category returns 204 No Content."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    create_res = client.post(
        "/api/v1/categories",
        json={"name": "Temporary Category", "type": "EXPENSE"},
        headers=headers,
    )
    cat_id = create_res.json()["id"]

    del_res = client.delete(f"/api/v1/categories/{cat_id}", headers=headers)
    assert del_res.status_code == 204

    # Confirm deleted
    get_res = client.get("/api/v1/categories", headers=headers)
    assert not any(c["id"] == cat_id for c in get_res.json()["items"])


def test_delete_system_default_category_rejected_409(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify system default categories cannot be deleted (409 Conflict)."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    list_res = client.get("/api/v1/categories", headers=headers)
    default_cat_id = list_res.json()["items"][0]["id"]

    del_res = client.delete(f"/api/v1/categories/{default_cat_id}", headers=headers)
    assert del_res.status_code == 409
    assert del_res.json()["code"] == "CANNOT_DELETE_SYSTEM_CATEGORY"


def test_delete_category_in_use_rejected_409(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify categories referenced by transactions cannot be deleted (409 Conflict)."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }
    create_res = client.post(
        "/api/v1/categories",
        json={"name": "Server Hardware", "type": "EXPENSE"},
        headers=headers,
    )
    cat_id = uuid.UUID(create_res.json()["id"])

    # Attach transaction to category
    tx = Transaction(
        business_id=workspace_with_owner.id,
        category_id=cat_id,
        type="EXPENSE",
        amount=Decimal("1200.00"),
        currency="INR",
        transaction_date=date(2026, 11, 21),
        description="Dell Server Purchase",
    )
    db.add(tx)
    db.commit()

    del_res = client.delete(f"/api/v1/categories/{cat_id}", headers=headers)
    assert del_res.status_code == 409
    assert del_res.json()["code"] == "CATEGORY_IN_USE"


def test_viewer_role_cannot_create_or_mutate_category(
    client: TestClient, user_token: str, workspace_as_viewer: Business
):
    """Verify VIEWER role can read categories but receives 403 Forbidden on write operations."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_viewer.id),
    }
    # Read allowed
    get_res = client.get("/api/v1/categories", headers=headers)
    assert get_res.status_code == 200

    # Create blocked
    post_res = client.post(
        "/api/v1/categories",
        json={"name": "Viewer Custom", "type": "EXPENSE"},
        headers=headers,
    )
    assert post_res.status_code == 403
    assert post_res.json()["code"] == "INSUFFICIENT_ROLE_PERMISSIONS"

    # Delete blocked
    cat_id = get_res.json()["items"][0]["id"]
    del_res = client.delete(f"/api/v1/categories/{cat_id}", headers=headers)
    assert del_res.status_code == 403


def test_member_role_cannot_create_category(
    client: TestClient, user_token: str, workspace_as_member: Business
):
    """Verify MEMBER role can read categories but receives 403 Forbidden when creating categories."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_member.id),
    }
    # Read allowed
    get_res = client.get("/api/v1/categories", headers=headers)
    assert get_res.status_code == 200

    # Create forbidden (403) for MEMBER
    post_res = client.post(
        "/api/v1/categories",
        json={"name": "Member Custom", "type": "EXPENSE"},
        headers=headers,
    )
    assert post_res.status_code == 403
    assert post_res.json()["code"] == "INSUFFICIENT_ROLE_PERMISSIONS"


def test_cross_tenant_category_isolation(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify categories belonging to another workspace return uniform 404 Not Found."""
    # Create Business 2 with its own category
    biz2 = Business(name="Foreign Business", base_currency="INR")
    db.add(biz2)
    db.flush()
    cat2 = Category(
        business_id=biz2.id,
        name="Private Business 2 Category",
        type="EXPENSE",
        is_system_default=False,
    )
    db.add(cat2)
    db.commit()

    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_with_owner.id),
    }

    # Attempt to update Business 2 category using Business 1 header
    patch_res = client.patch(
        f"/api/v1/categories/{cat2.id}",
        json={"name": "Hacked Name"},
        headers=headers,
    )
    assert patch_res.status_code == 404
    assert patch_res.json()["code"] == "CATEGORY_NOT_FOUND"

    # Attempt to delete Business 2 category
    del_res = client.delete(f"/api/v1/categories/{cat2.id}", headers=headers)
    assert del_res.status_code == 404
    assert del_res.json()["code"] == "CATEGORY_NOT_FOUND"


def test_registration_atomically_seeds_default_categories(client: TestClient, db: Session):
    """Verify user registration automatically provisions the 9 default categories for the new workspace."""
    reg_payload = {
        "email": "fresh.user@example.com",
        "password": "SecurePassword123!",
        "full_name": "Fresh User",
        "initial_business_name": "Fresh Start Ventures",
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_res.status_code == 201
    data = reg_res.json()
    new_token = data["token"]["access_token"]

    # Retrieve created workspace via /api/v1/workspaces
    auth_headers = {"Authorization": f"Bearer {new_token}"}
    ws_res = client.get("/api/v1/workspaces", headers=auth_headers)
    assert ws_res.status_code == 200
    workspaces = ws_res.json()["items"]
    assert len(workspaces) == 1
    new_biz_id = workspaces[0]["id"]

    # Verify default categories exist for the new workspace
    headers = {
        "Authorization": f"Bearer {new_token}",
        "X-Business-ID": str(new_biz_id),
    }
    cat_res = client.get("/api/v1/categories", headers=headers)
    assert cat_res.status_code == 200
    cat_data = cat_res.json()
    assert cat_data["total"] == 9
    assert len(cat_data["items"]) == 9
