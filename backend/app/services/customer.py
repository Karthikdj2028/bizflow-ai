"""Domain service for customer profile management and client records."""

from datetime import datetime, timezone
import math
from typing import List, Optional, Tuple
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, EntityNotFoundError
from app.models.customer import Customer
from app.schemas.customer import CustomerCreateRequest, CustomerUpdateRequest


def escape_sql_wildcards(term: str) -> str:
    """Escape LIKE/ILIKE special wildcard characters (% and _) and backslashes."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def create_customer(
    db: Session,
    business_id: uuid.UUID,
    request: CustomerCreateRequest,
) -> Customer:
    """Create and persist a new customer profile within the active workspace."""
    now = datetime.now(timezone.utc)
    customer = Customer(
        id=uuid.uuid4(),
        business_id=business_id,
        name=request.name.strip(),
        email=request.email,
        phone=request.phone,
        billing_address=request.billing_address,
        payment_terms_days=request.payment_terms_days,
        is_active=request.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


def get_customers_for_workspace(
    db: Session,
    business_id: uuid.UUID,
    search: Optional[str] = None,
    is_active: Optional[bool] = True,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Customer], int]:
    """Retrieve paginated customers for a workspace with optional search and active status filtering."""
    if page < 1:
        raise BadRequestError(
            detail="Page number must be greater than or equal to 1.",
            code="INVALID_PAGE",
        )
    if page_size < 1 or page_size > 100:
        raise BadRequestError(
            detail="Page size must be between 1 and 100.",
            code="INVALID_PAGE_SIZE",
        )

    base_conditions = [Customer.business_id == business_id]

    if is_active is not None:
        base_conditions.append(Customer.is_active.is_(is_active))

    if search and search.strip():
        escaped_search = escape_sql_wildcards(search.strip())
        pattern = f"%{escaped_search}%"
        base_conditions.append(
            or_(
                Customer.name.ilike(pattern, escape="\\"),
                Customer.email.ilike(pattern, escape="\\"),
                Customer.phone.ilike(pattern, escape="\\"),
            )
        )

    # 1. Total count query
    count_stmt = select(func.count(Customer.id)).where(*base_conditions)
    total_count = db.scalar(count_stmt) or 0

    # 2. Deterministic paginated items query
    offset = (page - 1) * page_size
    items_stmt = (
        select(Customer)
        .where(*base_conditions)
        .order_by(Customer.created_at.desc(), Customer.id.desc())
        .offset(offset)
        .limit(page_size)
    )
    items = list(db.scalars(items_stmt).all())

    return items, total_count


def get_customer_by_id(
    db: Session,
    business_id: uuid.UUID,
    customer_id: uuid.UUID,
) -> Customer:
    """Retrieve a single customer profile, enforcing workspace tenancy isolation.

    Raises uniform 404 EntityNotFoundError for missing or foreign-tenant records.
    """
    customer = db.scalar(
        select(Customer).where(
            Customer.id == customer_id,
            Customer.business_id == business_id,
        )
    )
    if customer is None:
        raise EntityNotFoundError(
            detail=f"Customer '{customer_id}' not found.",
            code="CUSTOMER_NOT_FOUND",
        )
    return customer


def update_customer(
    db: Session,
    business_id: uuid.UUID,
    customer_id: uuid.UUID,
    request: CustomerUpdateRequest,
) -> Customer:
    """Apply partial updates to a customer record.

    Explicit null clears optional fields (email, phone, billing_address).
    Omitted fields remain unchanged.
    """
    customer = get_customer_by_id(db, business_id, customer_id)

    if not request.model_fields_set:
        raise BadRequestError(
            detail="Request body cannot be empty. Specify at least one field to update.",
            code="EMPTY_UPDATE_PAYLOAD",
        )

    if "name" in request.model_fields_set:
        if request.name is None:
            raise BadRequestError(detail="Customer name cannot be null.", code="INVALID_NAME")
        customer.name = request.name.strip()

    if "email" in request.model_fields_set:
        customer.email = request.email.strip() if request.email else None

    if "phone" in request.model_fields_set:
        customer.phone = request.phone.strip() if request.phone else None

    if "billing_address" in request.model_fields_set:
        customer.billing_address = request.billing_address.strip() if request.billing_address else None

    if "payment_terms_days" in request.model_fields_set:
        if request.payment_terms_days is None:
            raise BadRequestError(detail="Payment terms cannot be null.", code="INVALID_PAYMENT_TERMS")
        customer.payment_terms_days = request.payment_terms_days

    if "is_active" in request.model_fields_set:
        if request.is_active is None:
            raise BadRequestError(detail="is_active cannot be null.", code="INVALID_IS_ACTIVE")
        customer.is_active = request.is_active

    customer.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(customer)
    return customer


def delete_customer(
    db: Session,
    business_id: uuid.UUID,
    customer_id: uuid.UUID,
) -> None:
    """Soft-delete a customer by setting is_active = False.

    Customer database record is preserved for audit trail and invoice relationships.
    Repeated deactivation behaves consistently and safely.
    """
    customer = get_customer_by_id(db, business_id, customer_id)
    customer.is_active = False
    customer.updated_at = datetime.now(timezone.utc)
    db.commit()
