"""Unit tests for Customer domain service and ORM model constraints."""

from datetime import datetime, timezone
import uuid
import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, EntityNotFoundError
from app.models.business import Business
from app.models.customer import Customer
from app.schemas.customer import CustomerCreateRequest, CustomerUpdateRequest
from app.services.customer import (
    create_customer,
    delete_customer,
    get_customer_by_id,
    get_customers_for_workspace,
    update_customer,
)


@pytest.fixture
def workspace_a(db: Session) -> Business:
    biz = Business(name="Workspace Alpha", base_currency="USD")
    db.add(biz)
    db.commit()
    db.refresh(biz)
    return biz


@pytest.fixture
def workspace_b(db: Session) -> Business:
    biz = Business(name="Workspace Beta", base_currency="EUR")
    db.add(biz)
    db.commit()
    db.refresh(biz)
    return biz


def test_customer_creation_default_payment_terms(db: Session, workspace_a: Business):
    """Customer is created with default payment terms of 30 days and is_active=True."""
    req = CustomerCreateRequest(name="Apex Manufacturing")
    customer = create_customer(db, workspace_a.id, req)

    assert customer.id is not None
    assert customer.business_id == workspace_a.id
    assert customer.name == "Apex Manufacturing"
    assert customer.payment_terms_days == 30
    assert customer.is_active is True
    assert customer.email is None
    assert customer.phone is None
    assert customer.billing_address is None


def test_customer_creation_custom_payment_terms(db: Session, workspace_a: Business):
    """Customer can be created with explicit custom payment terms (e.g. 0 for Due on Receipt, 15, 60)."""
    req = CustomerCreateRequest(
        name="Net Zero Logistics",
        email="billing@netzero.com",
        phone="+1-555-0100",
        billing_address="123 Freight Way, Dallas, TX",
        payment_terms_days=0,
    )
    customer = create_customer(db, workspace_a.id, req)

    assert customer.name == "Net Zero Logistics"
    assert customer.payment_terms_days == 0
    assert customer.email == "billing@netzero.com"
    assert customer.phone == "+1-555-0100"
    assert customer.billing_address == "123 Freight Way, Dallas, TX"


def test_negative_payment_terms_rejected():
    """Pydantic schema rejects negative payment terms."""
    with pytest.raises(PydanticValidationError) as exc_info:
        CustomerCreateRequest(name="Negative Terms Corp", payment_terms_days=-5)
    assert "greater than or equal to 0" in str(exc_info.value)


def test_empty_and_whitespace_only_names_rejected():
    """Names that are empty or whitespace-only are rejected at the schema level."""
    with pytest.raises(PydanticValidationError):
        CustomerCreateRequest(name="")

    with pytest.raises(PydanticValidationError):
        CustomerCreateRequest(name="   \t\n  ")


def test_db_constraint_name_not_empty(db: Session, workspace_a: Business):
    """Database check constraint rejects empty or whitespace-only name."""
    now = datetime.now(timezone.utc)
    customer = Customer(
        business_id=workspace_a.id,
        name="   ",
        payment_terms_days=30,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(customer)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_db_constraint_negative_payment_terms(db: Session, workspace_a: Business):
    """Database check constraint rejects negative payment terms."""
    now = datetime.now(timezone.utc)
    customer = Customer(
        business_id=workspace_a.id,
        name="Valid Name",
        payment_terms_days=-1,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(customer)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_search_by_name_email_phone(db: Session, workspace_a: Business):
    """Substring search matches across name, email, and phone case-insensitively."""
    c1 = create_customer(
        db,
        workspace_a.id,
        CustomerCreateRequest(
            name="Quantum Computing Lab",
            email="research@quantum.io",
            phone="+1-555-4321",
        ),
    )
    c2 = create_customer(
        db,
        workspace_a.id,
        CustomerCreateRequest(
            name="Alpha Retail Group",
            email="accounts@alpharetail.com",
            phone="+1-800-9999",
        ),
    )

    # Search by name substring
    items, total = get_customers_for_workspace(db, workspace_a.id, search="quantum")
    assert total == 1
    assert items[0].id == c1.id

    # Search by email substring
    items, total = get_customers_for_workspace(db, workspace_a.id, search="alpharetail")
    assert total == 1
    assert items[0].id == c2.id

    # Search by phone substring
    items, total = get_customers_for_workspace(db, workspace_a.id, search="4321")
    assert total == 1
    assert items[0].id == c1.id


def test_active_and_inactive_filtering(db: Session, workspace_a: Business):
    """Default listing returns active customers; is_active=False returns inactive."""
    c_active = create_customer(db, workspace_a.id, CustomerCreateRequest(name="Active Client"))
    c_inactive = create_customer(
        db,
        workspace_a.id,
        CustomerCreateRequest(name="Legacy Client", is_active=False),
    )

    # Default: active only
    items, total = get_customers_for_workspace(db, workspace_a.id)
    assert total == 1
    assert items[0].id == c_active.id

    # Explicit is_active=True
    items, total = get_customers_for_workspace(db, workspace_a.id, is_active=True)
    assert total == 1
    assert items[0].id == c_active.id

    # Explicit is_active=False
    items, total = get_customers_for_workspace(db, workspace_a.id, is_active=False)
    assert total == 1
    assert items[0].id == c_inactive.id

    # is_active=None: returns all
    items, total = get_customers_for_workspace(db, workspace_a.id, is_active=None)
    assert total == 2


def test_pagination_and_deterministic_ordering(db: Session, workspace_a: Business):
    """Pagination splits records into pages and enforces page bounds."""
    for i in range(1, 26):
        create_customer(db, workspace_a.id, CustomerCreateRequest(name=f"Customer {i:02d}"))

    # Page 1 (20 items)
    items_p1, total = get_customers_for_workspace(db, workspace_a.id, page=1, page_size=20)
    assert total == 25
    assert len(items_p1) == 20

    # Page 2 (5 items)
    items_p2, total = get_customers_for_workspace(db, workspace_a.id, page=2, page_size=20)
    assert total == 25
    assert len(items_p2) == 5

    # Check invalid pages
    with pytest.raises(BadRequestError):
        get_customers_for_workspace(db, workspace_a.id, page=0)

    with pytest.raises(BadRequestError):
        get_customers_for_workspace(db, workspace_a.id, page_size=101)


def test_partial_update_behavior(db: Session, workspace_a: Business):
    """Partial updates modify only specified fields."""
    customer = create_customer(
        db,
        workspace_a.id,
        CustomerCreateRequest(
            name="Initial Name",
            email="initial@test.com",
            phone="+1-111",
            billing_address="Old Address",
            payment_terms_days=30,
        ),
    )

    update_req = CustomerUpdateRequest(name="Revised Name", payment_terms_days=45)
    updated = update_customer(db, workspace_a.id, customer.id, update_req)

    assert updated.name == "Revised Name"
    assert updated.payment_terms_days == 45
    assert updated.email == "initial@test.com"
    assert updated.phone == "+1-111"
    assert updated.billing_address == "Old Address"


def test_explicit_null_clears_optional_fields(db: Session, workspace_a: Business):
    """Explicit null clears nullable fields via model_fields_set."""
    customer = create_customer(
        db,
        workspace_a.id,
        CustomerCreateRequest(
            name="Tech Corp",
            email="tech@corp.com",
            phone="+1-555-9999",
            billing_address="100 Tech Way",
        ),
    )

    # Clear email and billing_address with None
    clear_req = CustomerUpdateRequest.model_validate({
        "email": None,
        "billing_address": None,
    })
    updated = update_customer(db, workspace_a.id, customer.id, clear_req)

    assert updated.email is None
    assert updated.billing_address is None
    # Phone was omitted, so it remains unchanged
    assert updated.phone == "+1-555-9999"


def test_tenant_scoped_customer_lookup(db: Session, workspace_a: Business, workspace_b: Business):
    """Lookup enforces workspace tenant isolation."""
    customer_a = create_customer(db, workspace_a.id, CustomerCreateRequest(name="Alpha Customer"))

    # Accessible within Workspace A
    found = get_customer_by_id(db, workspace_a.id, customer_a.id)
    assert found.id == customer_a.id

    # Foreign workspace lookup raises uniform 404 EntityNotFoundError
    with pytest.raises(EntityNotFoundError) as exc_info:
        get_customer_by_id(db, workspace_b.id, customer_a.id)
    assert "CUSTOMER_NOT_FOUND" in exc_info.value.code


def test_soft_delete_preserves_database_record(db: Session, workspace_a: Business):
    """Delete marks is_active = False and does not purge the row."""
    customer = create_customer(db, workspace_a.id, CustomerCreateRequest(name="Retiring Client"))
    assert customer.is_active is True

    delete_customer(db, workspace_a.id, customer.id)

    db.refresh(customer)
    assert customer.is_active is False

    # Repeated soft deletion behaves consistently
    delete_customer(db, workspace_a.id, customer.id)
    db.refresh(customer)
    assert customer.is_active is False


def test_patch_explicit_null_rejected_for_non_nullable_fields(db: Session, workspace_a: Business):
    """Explicit null for name, payment_terms_days, or is_active is strictly rejected."""
    customer = create_customer(
        db,
        workspace_a.id,
        CustomerCreateRequest(name="Strict Customer", payment_terms_days=30),
    )

    # 1. Pydantic schema validation rejects explicit null for name
    with pytest.raises(PydanticValidationError) as exc1:
        CustomerUpdateRequest.model_validate({"name": None})
    assert "Customer name cannot be null" in str(exc1.value)

    # 2. Pydantic schema validation rejects explicit null for payment_terms_days
    with pytest.raises(PydanticValidationError) as exc2:
        CustomerUpdateRequest.model_validate({"payment_terms_days": None})
    assert "Payment terms cannot be null" in str(exc2.value)

    # 3. Pydantic schema validation rejects explicit null for is_active
    with pytest.raises(PydanticValidationError) as exc3:
        CustomerUpdateRequest.model_validate({"is_active": None})
    assert "is_active cannot be null" in str(exc3.value)

    # 4. Service-layer defense rejects raw dict with None if model_fields_set contains them
    unvalidated_req = CustomerUpdateRequest.__new__(CustomerUpdateRequest)
    object.__setattr__(unvalidated_req, "__pydantic_fields_set__", {"name"})
    object.__setattr__(unvalidated_req, "name", None)
    with pytest.raises(BadRequestError) as exc4:
        update_customer(db, workspace_a.id, customer.id, unvalidated_req)
    assert exc4.value.code == "INVALID_NAME"
