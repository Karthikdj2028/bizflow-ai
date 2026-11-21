"""Integration tests for Transaction API endpoints, RBAC, financial summaries, and multi-tenancy."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import uuid
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.business import Business
from app.models.category import Category
from app.models.membership import BusinessMembership
from app.models.transaction import Transaction
from app.models.user import User
from app.services.category import seed_default_categories
from app.services.transaction import create_transaction


@pytest.fixture
def auth_user(db: Session) -> User:
    """Create a persistent active user."""
    user = User(
        email="tx_operator@bizflow.ai",
        password_hash="dummy_hash_for_testing_purposes",
        full_name="Transaction Operator",
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
    """Create a business workspace where auth_user is OWNER with seeded categories."""
    biz = Business(name="Owner Workspace", base_currency="INR")
    db.add(biz)
    db.flush()

    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="OWNER")
    db.add(membership)
    seed_default_categories(db, biz.id)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_member(db: Session, auth_user: User) -> Business:
    """Create a business workspace where auth_user is MEMBER with seeded categories."""
    biz = Business(name="Member Workspace", base_currency="INR")
    db.add(biz)
    db.flush()

    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="MEMBER")
    db.add(membership)
    seed_default_categories(db, biz.id)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_as_viewer(db: Session, auth_user: User) -> Business:
    """Create a business workspace where auth_user is VIEWER with seeded categories."""
    biz = Business(name="Viewer Workspace", base_currency="INR")
    db.add(biz)
    db.flush()

    membership = BusinessMembership(user_id=auth_user.id, business_id=biz.id, role="VIEWER")
    db.add(membership)
    seed_default_categories(db, biz.id)
    db.commit()
    db.refresh(biz)
    return biz


def _get_headers(token: str, business_id: uuid.UUID) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "X-Business-ID": str(business_id),
    }


def test_create_income_transaction_success(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify creating an income transaction succeeds and inherits workspace currency."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "INCOME"
    ).first()
    assert cat is not None

    payload = {
        "type": "INCOME",
        "amount": "15000.00",
        "category_id": str(cat.id),
        "transaction_date": str(datetime.now(timezone.utc).date()),
        "description": "Consulting retainer invoice payment",
        "counterparty": "Acme Holdings",
        "reference_number": "INV-2026-001",
        "payment_method": "BANK_TRANSFER",
    }
    res = client.post(
        "/api/v1/transactions",
        json=payload,
        headers=_get_headers(user_token, workspace_with_owner.id),
    )
    assert res.status_code == 201
    data = res.json()
    assert data["type"] == "INCOME"
    assert data["amount"] == "15000.00"
    assert data["currency"] == "INR"  # Inherited from workspace base_currency
    assert data["category_name"] == cat.name
    assert data["category_color"] == cat.color_hex


def test_create_expense_transaction_success(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify creating an expense transaction succeeds with full metadata."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    payload = {
        "type": "EXPENSE",
        "amount": "450.75",
        "category_id": str(cat.id),
        "transaction_date": str(datetime.now(timezone.utc).date()),
        "description": "Stationery supplies",
        "counterparty": "Staples",
        "payment_method": "CREDIT_CARD",
    }
    res = client.post(
        "/api/v1/transactions",
        json=payload,
        headers=_get_headers(user_token, workspace_with_owner.id),
    )
    assert res.status_code == 201
    data = res.json()
    assert data["type"] == "EXPENSE"
    assert data["amount"] == "450.75"
    assert data["currency"] == "INR"


def test_create_transaction_rejects_client_currency_override(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify extra payload fields such as currency are strictly rejected."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "INCOME"
    ).first()
    assert cat is not None

    payload = {
        "type": "INCOME",
        "amount": "1000.00",
        "category_id": str(cat.id),
        "transaction_date": str(datetime.now(timezone.utc).date()),
        "description": "Attempted currency override",
        "currency": "USD",
    }
    res = client.post(
        "/api/v1/transactions",
        json=payload,
        headers=_get_headers(user_token, workspace_with_owner.id),
    )
    assert res.status_code == 422


def test_create_transaction_cross_tenant_category_404(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify assigning a category owned by another business returns uniform 404."""
    # Create foreign business with category
    foreign_biz = Business(name="Foreign Biz", base_currency="INR")
    db.add(foreign_biz)
    db.flush()
    foreign_cat = Category(
        business_id=foreign_biz.id,
        name="Foreign Category",
        type="EXPENSE",
        is_system_default=False,
    )
    db.add(foreign_cat)
    db.commit()

    payload = {
        "type": "EXPENSE",
        "amount": "500.00",
        "category_id": str(foreign_cat.id),
        "transaction_date": str(datetime.now(timezone.utc).date()),
        "description": "Cross-tenant category attempt",
    }
    res = client.post(
        "/api/v1/transactions",
        json=payload,
        headers=_get_headers(user_token, workspace_with_owner.id),
    )
    assert res.status_code == 404
    assert res.json()["code"] == "CATEGORY_NOT_FOUND"


def test_create_transaction_category_type_mismatch_400(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify assigning an INCOME category to an EXPENSE transaction returns 400 Bad Request."""
    income_cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "INCOME"
    ).first()
    assert income_cat is not None

    payload = {
        "type": "EXPENSE",  # Mismatched type
        "amount": "1200.00",
        "category_id": str(income_cat.id),
        "transaction_date": str(datetime.now(timezone.utc).date()),
        "description": "Type mismatch attempt",
    }
    res = client.post(
        "/api/v1/transactions",
        json=payload,
        headers=_get_headers(user_token, workspace_with_owner.id),
    )
    assert res.status_code == 400
    assert res.json()["code"] == "CATEGORY_TYPE_MISMATCH"


def test_route_order_summary_before_id(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify GET /api/v1/transactions/summary resolves to summary and not /{transaction_id}."""
    res = client.get(
        "/api/v1/transactions/summary",
        headers=_get_headers(user_token, workspace_with_owner.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert "total_income" in data
    assert "total_expenses" in data
    assert "cumulative_net_movement" in data


def test_list_transactions_pagination(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify transaction listing pagination controls (page, page_size, total_pages)."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    today = datetime.now(timezone.utc).date()
    headers = _get_headers(user_token, workspace_with_owner.id)

    # Insert 5 transactions
    for i in range(5):
        client.post(
            "/api/v1/transactions",
            json={
                "type": "EXPENSE",
                "amount": f"{(i + 1) * 10}.00",
                "category_id": str(cat.id),
                "transaction_date": str(today),
                "description": f"Test Transaction {i}",
            },
            headers=headers,
        )

    # Page 1 with size 2
    res = client.get("/api/v1/transactions?page=1&page_size=2", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
    assert data["total_pages"] == 3


def test_list_transactions_date_range_filter(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify filtering transactions by inclusive start_date and end_date."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "INCOME"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)

    # Tx on two_days_ago
    client.post(
        "/api/v1/transactions",
        json={"type": "INCOME", "amount": "100.00", "category_id": str(cat.id), "transaction_date": str(two_days_ago), "description": "2 days ago"},
        headers=headers,
    )
    # Tx on yesterday
    client.post(
        "/api/v1/transactions",
        json={"type": "INCOME", "amount": "200.00", "category_id": str(cat.id), "transaction_date": str(yesterday), "description": "Yesterday"},
        headers=headers,
    )
    # Tx on today
    client.post(
        "/api/v1/transactions",
        json={"type": "INCOME", "amount": "300.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Today"},
        headers=headers,
    )

    # Filter for yesterday only
    res = client.get(
        f"/api/v1/transactions?start_date={yesterday}&end_date={yesterday}",
        headers=headers,
    )
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["description"] == "Yesterday"


def test_list_transactions_search_wildcard_escaping(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify search terms containing SQL wildcards (%, _) are escaped safely."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "50.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "100% discount purchase"},
        headers=headers,
    )
    client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "75.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Normal purchase 1000"},
        headers=headers,
    )

    # Search specifically for "100%"
    res = client.get("/api/v1/transactions?search=100%", headers=headers)
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["description"] == "100% discount purchase"


def test_list_transactions_deterministic_sorting(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify deterministic pagination sorting when records share identical transaction dates."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    for i in range(4):
        client.post(
            "/api/v1/transactions",
            json={"type": "EXPENSE", "amount": "10.00", "category_id": str(cat.id), "transaction_date": str(today), "description": f"Same date {i}"},
            headers=headers,
        )

    res1 = client.get("/api/v1/transactions?page=1&page_size=2&sort_by=transaction_date&sort_order=desc", headers=headers)
    res2 = client.get("/api/v1/transactions?page=2&page_size=2&sort_by=transaction_date&sort_order=desc", headers=headers)
    page1_ids = [item["id"] for item in res1.json()["items"]]
    page2_ids = [item["id"] for item in res2.json()["items"]]

    # Ensure no duplicate items across pages
    assert len(set(page1_ids).intersection(set(page2_ids))) == 0


def test_get_single_transaction_success(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify retrieving an active transaction by ID returns complete data with category metadata."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "INCOME"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={"type": "INCOME", "amount": "5000.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Single fetch test"},
        headers=headers,
    )
    tx_id = create_res.json()["id"]

    get_res = client.get(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert get_res.status_code == 200
    data = get_res.json()
    assert data["id"] == tx_id
    assert data["category_name"] == cat.name
    assert data["category_color"] == cat.color_hex


def test_update_transaction_success(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify modifying transaction fields updates values and refreshes updated_at."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "100.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Pre-update"},
        headers=headers,
    )
    tx_id = create_res.json()["id"]

    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"amount": "150.00", "description": "Post-update", "counterparty": "New Vendor"},
        headers=headers,
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["amount"] == "150.00"
    assert data["description"] == "Post-update"
    assert data["counterparty"] == "New Vendor"


def test_update_transaction_type_immutable_422(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify attempting to modify transaction type in PATCH returns 422."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "100.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Immutable type test"},
        headers=headers,
    )
    tx_id = create_res.json()["id"]

    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"type": "INCOME"},
        headers=headers,
    )
    assert patch_res.status_code == 422


def test_patch_empty_body_rejected_400(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify sending an empty JSON body ({}) to PATCH returns HTTP 400 and EMPTY_UPDATE_PAYLOAD."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "100.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Empty patch test"},
        headers=headers,
    )
    tx_id = create_res.json()["id"]

    patch_res = client.patch(f"/api/v1/transactions/{tx_id}", json={}, headers=headers)
    assert patch_res.status_code == 400
    data = patch_res.json()
    assert data["code"] == "EMPTY_UPDATE_PAYLOAD"
    assert data["status"] == 400
    assert "Empty update payload" in data["detail"]


def test_soft_delete_transaction_success(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify soft-deleting a transaction succeeds and returns 404 on subsequent get/update."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "200.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Delete test"},
        headers=headers,
    )
    tx_id = create_res.json()["id"]

    # Delete succeeds
    del_res = client.delete(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert del_res.status_code == 200

    # Subsequent GET returns 404
    get_res = client.get(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert get_res.status_code == 404

    # Subsequent PATCH returns 404
    patch_res = client.patch(f"/api/v1/transactions/{tx_id}", json={"amount": "300.00"}, headers=headers)
    assert patch_res.status_code == 404

    # Re-deleting returns 404
    del_res2 = client.delete(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert del_res2.status_code == 404


def test_rbac_member_can_create_and_update(
    client: TestClient, user_token: str, workspace_as_member: Business, db: Session
):
    """Verify MEMBER role can create and update transactions."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_as_member.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_as_member.id)
    today = datetime.now(timezone.utc).date()

    # Create allowed
    post_res = client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "75.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Member expense"},
        headers=headers,
    )
    assert post_res.status_code == 201
    tx_id = post_res.json()["id"]

    # Update allowed
    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"description": "Updated by member"},
        headers=headers,
    )
    assert patch_res.status_code == 200


def test_rbac_member_cannot_delete_403(
    client: TestClient, user_token: str, workspace_as_member: Business, db: Session
):
    """Verify MEMBER role receives 403 Forbidden on DELETE /transactions/{id}."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_as_member.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_as_member.id)
    today = datetime.now(timezone.utc).date()

    post_res = client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "75.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Member delete test"},
        headers=headers,
    )
    tx_id = post_res.json()["id"]

    del_res = client.delete(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert del_res.status_code == 403
    assert del_res.json()["code"] == "INSUFFICIENT_ROLE_PERMISSIONS"


def test_rbac_viewer_cannot_mutate_403(
    client: TestClient, user_token: str, workspace_as_viewer: Business, db: Session
):
    """Verify VIEWER role can read but receives 403 Forbidden on create, update, and delete."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_as_viewer.id, Category.type == "INCOME"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_as_viewer.id)
    today = datetime.now(timezone.utc).date()

    # Read allowed
    get_res = client.get("/api/v1/transactions", headers=headers)
    assert get_res.status_code == 200

    # Create forbidden
    post_res = client.post(
        "/api/v1/transactions",
        json={"type": "INCOME", "amount": "100.00", "category_id": str(cat.id), "transaction_date": str(today), "description": "Viewer test"},
        headers=headers,
    )
    assert post_res.status_code == 403

    # Update forbidden
    patch_res = client.patch(
        f"/api/v1/transactions/{uuid.uuid4()}",
        json={"description": "Viewer patch"},
        headers=headers,
    )
    assert patch_res.status_code == 403

    # Delete forbidden
    del_res = client.delete(
        f"/api/v1/transactions/{uuid.uuid4()}",
        headers=headers,
    )
    assert del_res.status_code == 403


def test_cross_tenant_isolation_404(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify attempting to access another workspace's transaction returns uniform 404."""
    # Create foreign business and transaction
    foreign_biz = Business(name="Foreign Org", base_currency="INR")
    db.add(foreign_biz)
    db.flush()
    seed_default_categories(db, foreign_biz.id)
    foreign_cat = db.query(Category).filter(Category.business_id == foreign_biz.id).first()
    assert foreign_cat is not None

    foreign_tx = Transaction(
        id=uuid.uuid4(),
        business_id=foreign_biz.id,
        category_id=foreign_cat.id,
        type="EXPENSE",
        amount=Decimal("100.00"),
        currency="INR",
        transaction_date=datetime.now(timezone.utc).date(),
        description="Foreign transaction",
    )
    db.add(foreign_tx)
    db.commit()

    # Attempt to read foreign transaction using workspace_with_owner headers
    headers = _get_headers(user_token, workspace_with_owner.id)
    get_res = client.get(f"/api/v1/transactions/{foreign_tx.id}", headers=headers)
    assert get_res.status_code == 404


def test_summary_date_range_validation(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify summary endpoint rejects start_date > end_date and future end_date."""
    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    # start_date > end_date -> 400
    res1 = client.get(
        f"/api/v1/transactions/summary?start_date={today}&end_date={yesterday}",
        headers=headers,
    )
    assert res1.status_code == 400
    assert res1.json()["code"] == "INVALID_DATE_RANGE"

    # end_date in future -> 422
    res2 = client.get(
        f"/api/v1/transactions/summary?end_date={tomorrow}",
        headers=headers,
    )
    assert res2.status_code == 422
    assert res2.json()["code"] == "FUTURE_END_DATE_NOT_PERMITTED"


def test_summary_scoped_vs_cumulative_semantics(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify period metrics honor category_id while cumulative net movement aggregates workspace-wide."""
    cats = db.query(Category).filter(Category.business_id == workspace_with_owner.id).all()
    income_cat = [c for c in cats if c.type == "INCOME"][0]
    expense_cat = [c for c in cats if c.type == "EXPENSE"][0]

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    # Tx 1: Income 1000.00 in income_cat
    client.post(
        "/api/v1/transactions",
        json={"type": "INCOME", "amount": "1000.00", "category_id": str(income_cat.id), "transaction_date": str(today), "description": "Income"},
        headers=headers,
    )
    # Tx 2: Expense 400.00 in expense_cat
    client.post(
        "/api/v1/transactions",
        json={"type": "EXPENSE", "amount": "400.00", "category_id": str(expense_cat.id), "transaction_date": str(today), "description": "Expense"},
        headers=headers,
    )

    # Summary filtered by income_cat:
    # Period income should be 1000.00, period expense should be 0.00
    # BUT cumulative_net_movement must be 1000.00 - 400.00 = 600.00!
    res = client.get(
        f"/api/v1/transactions/summary?category_id={income_cat.id}",
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total_income"] == "1000.00"
    assert data["total_expenses"] == "0.00"
    assert data["net_cash_flow"] == "1000.00"
    assert data["cumulative_net_movement"] == "600.00"  # Workspace-wide!


def test_summary_future_end_date_rejected_422(
    client: TestClient, user_token: str, workspace_with_owner: Business
):
    """Verify summary endpoint rejects future end_date with HTTP 422 and FUTURE_END_DATE_NOT_PERMITTED."""
    headers = _get_headers(user_token, workspace_with_owner.id)
    tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)

    res = client.get(
        f"/api/v1/transactions/summary?end_date={tomorrow}",
        headers=headers,
    )
    assert res.status_code == 422
    data = res.json()
    assert data["code"] == "FUTURE_END_DATE_NOT_PERMITTED"
    assert data["status"] == 422
    assert "End date cannot be in the future" in data["detail"]


def test_patch_clear_counterparty_with_null(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify PATCH with counterparty: null successfully clears existing counterparty in DB."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={
            "type": "EXPENSE",
            "amount": "100.00",
            "category_id": str(cat.id),
            "transaction_date": str(today),
            "description": "Clear counterparty test",
            "counterparty": "Initial Vendor Inc",
        },
        headers=headers,
    )
    tx_id = create_res.json()["id"]
    assert create_res.json()["counterparty"] == "Initial Vendor Inc"

    # Send explicit null for counterparty
    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"counterparty": None},
        headers=headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["counterparty"] is None

    # Verify directly in database
    tx_db = db.query(Transaction).filter(Transaction.id == uuid.UUID(tx_id)).first()
    assert tx_db is not None
    assert tx_db.counterparty is None


def test_patch_clear_reference_number_with_null(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify PATCH with reference_number: null successfully clears existing reference_number in DB."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()

    create_res = client.post(
        "/api/v1/transactions",
        json={
            "type": "EXPENSE",
            "amount": "100.00",
            "category_id": str(cat.id),
            "transaction_date": str(today),
            "description": "Clear reference_number test",
            "reference_number": "INV-REF-9988",
        },
        headers=headers,
    )
    tx_id = create_res.json()["id"]
    assert create_res.json()["reference_number"] == "INV-REF-9988"

    # Send explicit null for reference_number
    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"reference_number": None},
        headers=headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["reference_number"] is None

    # Verify directly in database
    tx_db = db.query(Transaction).filter(Transaction.id == uuid.UUID(tx_id)).first()
    assert tx_db is not None
    assert tx_db.reference_number is None


def test_patch_future_transaction_date_rejected_422(
    client: TestClient, user_token: str, workspace_with_owner: Business, db: Session
):
    """Verify attempting to update transaction_date to a future date returns HTTP 422."""
    cat = db.query(Category).filter(
        Category.business_id == workspace_with_owner.id, Category.type == "EXPENSE"
    ).first()
    assert cat is not None

    headers = _get_headers(user_token, workspace_with_owner.id)
    today = datetime.now(timezone.utc).date()
    future_date = today + timedelta(days=5)

    create_res = client.post(
        "/api/v1/transactions",
        json={
            "type": "EXPENSE",
            "amount": "100.00",
            "category_id": str(cat.id),
            "transaction_date": str(today),
            "description": "Future date patch test",
        },
        headers=headers,
    )
    tx_id = create_res.json()["id"]

    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"transaction_date": str(future_date)},
        headers=headers,
    )
    assert patch_res.status_code == 422
    data = patch_res.json()
    assert data["code"] == "REQUEST_VALIDATION_FAILED"
    assert any("future" in err.get("message", "").lower() for err in data.get("errors", []))
