"""Integration tests for Invoice Management API endpoints, RBAC, tenant isolation, and state machine."""

from datetime import date, timedelta
from decimal import Decimal
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
        email="operator@bizflow.ai",
        password_hash="dummy_pw_hash",
        full_name="Invoice Operator",
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
def other_workspace(db: Session) -> Business:
    """Workspace owned by another user for cross-tenant tests."""
    other_user = User(
        email="other_tenant@bizflow.ai",
        password_hash="dummy_pw_hash",
        full_name="Other Tenant",
        is_active=True,
    )
    db.add(other_user)
    db.flush()
    biz = Business(name="Other Tenant Workspace", base_currency="USD")
    db.add(biz)
    db.flush()
    membership = BusinessMembership(user_id=other_user.id, business_id=biz.id, role="OWNER")
    db.add(membership)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def active_customer(db: Session, workspace_as_owner: Business) -> Customer:
    """Active customer in workspace_as_owner."""
    cust = Customer(
        business_id=workspace_as_owner.id,
        name="Acme Corporation",
        email="acme@corp.com",
        is_active=True,
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return cust


@pytest.fixture
def inactive_customer(db: Session, workspace_as_owner: Business) -> Customer:
    """Inactive customer in workspace_as_owner."""
    cust = Customer(
        business_id=workspace_as_owner.id,
        name="Inactive Corp",
        email="inactive@corp.com",
        is_active=False,
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return cust


@pytest.fixture
def other_customer(db: Session, other_workspace: Business) -> Customer:
    """Customer belonging to other_workspace."""
    cust = Customer(
        business_id=other_workspace.id,
        name="Foreign Customer",
        email="foreign@corp.com",
        is_active=True,
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return cust


def test_create_invoice_success_owner(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    active_customer: Customer,
) -> None:
    """Owner can create a multi-line invoice with exact string formatting."""
    payload = {
        "customer_id": str(active_customer.id),
        "invoice_number": "INV-2026-001",
        "issue_date": "2026-11-01",
        "due_date": "2026-11-30",
        "tax_rate": "0.1000",
        "discount_amount": "50.00",
        "notes": "Net 30 payment terms.",
        "items": [
            {
                "description": "Consulting Services",
                "quantity": "10.00",
                "unit_price": "100.00",
            },
            {
                "description": "Architecture Review",
                "quantity": "2.00",
                "unit_price": "250.00",
            },
        ],
    }
    # Subtotal = 10*100 + 2*250 = 1500.00
    # Tax @ 10% = 150.00
    # Discount = 50.00
    # Total = 1500 + 150 - 50 = 1600.00
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    resp = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["invoice_number"] == "INV-2026-001"
    assert data["customer_id"] == str(active_customer.id)
    assert data["customer_name"] == "Acme Corporation"
    assert data["status"] == "DRAFT"
    assert data["persisted_status"] == "DRAFT"
    assert data["subtotal"] == "1500.00"
    assert data["tax_rate"] == "0.1000"
    assert data["tax_amount"] == "150.00"
    assert data["discount_amount"] == "50.00"
    assert data["total_amount"] == "1600.00"
    assert data["paid_amount"] == "0.00"
    assert data["balance_due"] == "1600.00"
    assert len(data["items"]) == 2
    items_by_desc = {item["description"]: item["line_total"] for item in data["items"]}
    assert items_by_desc["Consulting Services"] == "1000.00"
    assert items_by_desc["Architecture Review"] == "500.00"


def test_create_invoice_rbac_viewer_forbidden(
    client: TestClient,
    user_token: str,
    workspace_as_viewer: Business,
    active_customer: Customer,
) -> None:
    """Viewer role is forbidden from creating invoices (HTTP 403)."""
    payload = {
        "customer_id": str(active_customer.id),
        "invoice_number": "INV-VIEWER-001",
        "issue_date": "2026-11-01",
        "due_date": "2026-11-30",
        "items": [{"description": "Item", "quantity": "1.00", "unit_price": "10.00"}],
    }
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_viewer.id),
    }
    resp = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert resp.status_code == 403
    assert resp.json()["code"] == "INSUFFICIENT_ROLE_PERMISSIONS"


def test_create_invoice_cross_tenant_customer_rejected_404(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    other_customer: Customer,
) -> None:
    """Attempting to assign a customer from another workspace returns uniform HTTP 404."""
    payload = {
        "customer_id": str(other_customer.id),
        "invoice_number": "INV-CROSS-001",
        "issue_date": "2026-11-01",
        "due_date": "2026-11-30",
        "items": [{"description": "Item", "quantity": "1.00", "unit_price": "10.00"}],
    }
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    resp = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "CUSTOMER_NOT_FOUND"


def test_create_invoice_inactive_customer_rejected_422(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    inactive_customer: Customer,
) -> None:
    """Creating invoice for an inactive customer returns HTTP 422."""
    payload = {
        "customer_id": str(inactive_customer.id),
        "invoice_number": "INV-INACTIVE-001",
        "issue_date": "2026-11-01",
        "due_date": "2026-11-30",
        "items": [{"description": "Item", "quantity": "1.00", "unit_price": "10.00"}],
    }
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    resp = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["code"] == "CUSTOMER_INACTIVE"


def test_duplicate_invoice_number_in_same_workspace_rejected_409(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    active_customer: Customer,
) -> None:
    """Duplicate invoice number in same workspace returns HTTP 409 Conflict."""
    payload = {
        "customer_id": str(active_customer.id),
        "invoice_number": "INV-DUPLICATE-001",
        "issue_date": "2026-11-01",
        "due_date": "2026-11-30",
        "items": [{"description": "Item", "quantity": "1.00", "unit_price": "10.00"}],
    }
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    resp1 = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert resp1.status_code == 201

    resp2 = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert resp2.status_code == 409
    assert resp2.json()["code"] == "INVOICE_NUMBER_ALREADY_EXISTS"


def test_get_invoice_detail_and_cross_tenant_isolation(
    client: TestClient,
    user_token: str,
    auth_user: User,
    db: Session,
    workspace_as_owner: Business,
    other_workspace: Business,
    active_customer: Customer,
) -> None:
    """Invoice is retrievable within own workspace but returns 404 from another workspace."""
    payload = {
        "customer_id": str(active_customer.id),
        "invoice_number": "INV-ISOLATION-001",
        "issue_date": "2026-11-01",
        "due_date": "2026-11-30",
        "items": [{"description": "Item", "quantity": "1.00", "unit_price": "10.00"}],
    }
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_resp = client.post("/api/v1/invoices", json=payload, headers=headers)
    inv_id = create_resp.json()["id"]

    # Fetch within own workspace
    get_resp = client.get(f"/api/v1/invoices/{inv_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == inv_id

    # User is also a member of other_workspace, but invoice belongs to workspace_as_owner
    db.add(BusinessMembership(user_id=auth_user.id, business_id=other_workspace.id, role="MEMBER"))
    db.commit()

    # Fetch from another workspace (simulating cross-tenant probe)
    other_headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(other_workspace.id),
    }
    cross_resp = client.get(f"/api/v1/invoices/{inv_id}", headers=other_headers)
    assert cross_resp.status_code == 404
    assert cross_resp.json()["code"] == "INVOICE_NOT_FOUND"


def test_list_invoices_status_filters_and_overdue(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    active_customer: Customer,
) -> None:
    """Verify list status filtering (ALL, DRAFT, SENT, OVERDUE) and empty states."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }

    # 1. Create a DRAFT invoice
    client.post(
        "/api/v1/invoices",
        json={
            "customer_id": str(active_customer.id),
            "invoice_number": "INV-DRAFT-FILTER",
            "issue_date": "2026-11-01",
            "due_date": "2026-11-30",
            "items": [{"description": "Item", "quantity": "1.00", "unit_price": "50.00"}],
        },
        headers=headers,
    )

    # 2. Create a future SENT invoice
    today = date.today()
    future_date = (today + timedelta(days=10)).isoformat()
    sent_resp = client.post(
        "/api/v1/invoices",
        json={
            "customer_id": str(active_customer.id),
            "invoice_number": "INV-SENT-FUTURE",
            "issue_date": today.isoformat(),
            "due_date": future_date,
            "items": [{"description": "Item", "quantity": "2.00", "unit_price": "50.00"}],
        },
        headers=headers,
    )
    sent_id = sent_resp.json()["id"]
    client.post(f"/api/v1/invoices/{sent_id}/status", json={"action": "MARK_SENT"}, headers=headers)

    # 3. Create a past SENT invoice (effectively OVERDUE)
    past_issue = (today - timedelta(days=20)).isoformat()
    past_due = (today - timedelta(days=5)).isoformat()
    overdue_resp = client.post(
        "/api/v1/invoices",
        json={
            "customer_id": str(active_customer.id),
            "invoice_number": "INV-OVERDUE-PAST",
            "issue_date": past_issue,
            "due_date": past_due,
            "items": [{"description": "Item", "quantity": "1.00", "unit_price": "75.00"}],
        },
        headers=headers,
    )
    overdue_id = overdue_resp.json()["id"]
    client.post(f"/api/v1/invoices/{overdue_id}/status", json={"action": "MARK_SENT"}, headers=headers)

    # Test ALL filter
    all_resp = client.get("/api/v1/invoices?status=ALL", headers=headers)
    assert all_resp.status_code == 200
    assert all_resp.json()["total"] >= 3

    # Test DRAFT filter
    draft_resp = client.get("/api/v1/invoices?status=DRAFT", headers=headers)
    assert draft_resp.status_code == 200
    for item in draft_resp.json()["items"]:
        assert item["status"] == "DRAFT"

    # Test SENT filter (should exclude overdue past invoice!)
    sent_filter_resp = client.get("/api/v1/invoices?status=SENT", headers=headers)
    assert sent_filter_resp.status_code == 200
    sent_numbers = [item["invoice_number"] for item in sent_filter_resp.json()["items"]]
    assert "INV-SENT-FUTURE" in sent_numbers
    assert "INV-OVERDUE-PAST" not in sent_numbers

    # Test OVERDUE filter (should find overdue past invoice)
    overdue_filter_resp = client.get("/api/v1/invoices?status=OVERDUE", headers=headers)
    assert overdue_filter_resp.status_code == 200
    overdue_numbers = [item["invoice_number"] for item in overdue_filter_resp.json()["items"]]
    assert "INV-OVERDUE-PAST" in overdue_numbers
    assert "INV-SENT-FUTURE" not in overdue_numbers

    # Test empty result pagination
    empty_resp = client.get("/api/v1/invoices?search=NONEXISTENT_NUMBER_999", headers=headers)
    assert empty_resp.status_code == 200
    assert empty_resp.json()["total"] == 0
    assert empty_resp.json()["total_pages"] == 0
    assert empty_resp.json()["items"] == []


def test_patch_draft_invoice_success_and_recalculation(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    active_customer: Customer,
) -> None:
    """Updating line items and discount recalculates totals correctly."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_resp = client.post(
        "/api/v1/invoices",
        json={
            "customer_id": str(active_customer.id),
            "invoice_number": "INV-PATCH-001",
            "issue_date": "2026-11-01",
            "due_date": "2026-11-30",
            "items": [{"description": "Old Item", "quantity": "1.00", "unit_price": "100.00"}],
        },
        headers=headers,
    )
    inv_id = create_resp.json()["id"]

    # Patch with replacement items and discount
    patch_payload = {
        "discount_amount": "20.00",
        "items": [
            {"description": "New Item 1", "quantity": "2.00", "unit_price": "200.00"},  # 400.00
            {"description": "New Item 2", "quantity": "1.00", "unit_price": "100.00"},  # 100.00
        ],
    }
    patch_resp = client.patch(f"/api/v1/invoices/{inv_id}", json=patch_payload, headers=headers)
    assert patch_resp.status_code == 200
    data = patch_resp.json()
    assert data["subtotal"] == "500.00"
    assert data["discount_amount"] == "20.00"
    assert data["total_amount"] == "480.00"
    assert data["balance_due"] == "480.00"
    assert len(data["items"]) == 2


def test_patch_non_draft_invoice_rejected_409(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    active_customer: Customer,
) -> None:
    """Attempting to edit a SENT invoice is rejected with HTTP 409 INVOICE_NOT_EDITABLE."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_resp = client.post(
        "/api/v1/invoices",
        json={
            "customer_id": str(active_customer.id),
            "invoice_number": "INV-NOT-EDITABLE-001",
            "issue_date": "2026-11-01",
            "due_date": "2026-11-30",
            "items": [{"description": "Item", "quantity": "1.00", "unit_price": "100.00"}],
        },
        headers=headers,
    )
    inv_id = create_resp.json()["id"]
    client.post(f"/api/v1/invoices/{inv_id}/status", json={"action": "MARK_SENT"}, headers=headers)

    # Attempt to patch SENT invoice
    patch_resp = client.patch(f"/api/v1/invoices/{inv_id}", json={"notes": "Updated note"}, headers=headers)
    assert patch_resp.status_code == 409
    assert patch_resp.json()["code"] == "INVOICE_NOT_EDITABLE"


def test_transition_cancel_preserves_historical_amounts(
    client: TestClient,
    user_token: str,
    workspace_as_owner: Business,
    active_customer: Customer,
) -> None:
    """Canceling an invoice sets status to CANCELED while preserving all financial values."""
    headers = {
        "Authorization": f"Bearer {user_token}",
        "X-Business-ID": str(workspace_as_owner.id),
    }
    create_resp = client.post(
        "/api/v1/invoices",
        json={
            "customer_id": str(active_customer.id),
            "invoice_number": "INV-CANCEL-001",
            "issue_date": "2026-11-01",
            "due_date": "2026-11-30",
            "tax_rate": "0.1000",
            "discount_amount": "10.00",
            "items": [{"description": "Item", "quantity": "2.00", "unit_price": "100.00"}],
        },
        headers=headers,
    )
    inv_id = create_resp.json()["id"]
    pre_subtotal = create_resp.json()["subtotal"]
    pre_tax = create_resp.json()["tax_amount"]
    pre_discount = create_resp.json()["discount_amount"]
    pre_total = create_resp.json()["total_amount"]
    pre_balance = create_resp.json()["balance_due"]

    cancel_resp = client.post(f"/api/v1/invoices/{inv_id}/status", json={"action": "CANCEL"}, headers=headers)
    assert cancel_resp.status_code == 200
    data = cancel_resp.json()
    assert data["status"] == "CANCELED"
    assert data["persisted_status"] == "CANCELED"
    # Verify all historical numbers are preserved
    assert data["subtotal"] == pre_subtotal
    assert data["tax_amount"] == pre_tax
    assert data["discount_amount"] == pre_discount
    assert data["total_amount"] == pre_total
    assert data["balance_due"] == pre_balance

    # Attempting to cancel again returns HTTP 409
    cancel_again = client.post(f"/api/v1/invoices/{inv_id}/status", json={"action": "CANCEL"}, headers=headers)
    assert cancel_again.status_code == 409
    assert cancel_again.json()["code"] == "INVOICE_ALREADY_CANCELED"
