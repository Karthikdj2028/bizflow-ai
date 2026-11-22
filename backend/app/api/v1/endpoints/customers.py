"""Customer API endpoints for accounts receivable and client management."""

import math
from typing import Annotated, Optional
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentBusinessDep, RequireRoles
from app.core.database import get_db
from app.schemas.customer import (
    CustomerCreateRequest,
    CustomerListResponse,
    CustomerResponse,
    CustomerUpdateRequest,
)
from app.services.customer import (
    create_customer as svc_create_customer,
    delete_customer as svc_delete_customer,
    get_customer_by_id as svc_get_customer_by_id,
    get_customers_for_workspace as svc_get_customers,
    update_customer as svc_update_customer,
)

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.get(
    "",
    response_model=CustomerListResponse,
    status_code=status.HTTP_200_OK,
    summary="List workspace customers",
    description="Retrieve paginated customer profiles for the active workspace. Filterable by status and search substring.",
)
def list_customers(
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
    page: Annotated[
        int,
        Query(ge=1, description="Page number (1-based index)."),
    ] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Items per page (max 100)."),
    ] = 20,
    search: Annotated[
        Optional[str],
        Query(max_length=255, description="Search term matching name, email, or phone."),
    ] = None,
    is_active: Annotated[
        Optional[bool],
        Query(description="Filter by active status (default: true). Set false for inactive."),
    ] = True,
) -> CustomerListResponse:
    """List paginated customers for the authenticated business workspace."""
    items, total = svc_get_customers(
        db=db,
        business_id=context.business_id,
        search=search,
        is_active=is_active,
        page=page,
        page_size=page_size,
    )
    total_pages = math.ceil(total / page_size) if total > 0 else 0
    return CustomerListResponse(
        items=[CustomerResponse.model_validate(c) for c in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post(
    "",
    response_model=CustomerResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new customer",
    description="Register a new customer profile. Requires OWNER, ADMIN, or MEMBER role.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def create_customer(
    request: CustomerCreateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> CustomerResponse:
    """Create a new customer profile in the active workspace."""
    customer = svc_create_customer(db, context.business_id, request)
    return CustomerResponse.model_validate(customer)


@router.get(
    "/{customer_id}",
    response_model=CustomerResponse,
    status_code=status.HTTP_200_OK,
    summary="Get customer profile",
    description="Retrieve detailed profile of a single customer by ID. Enforces tenant isolation.",
)
def get_customer(
    customer_id: uuid.UUID,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> CustomerResponse:
    """Retrieve a single customer profile."""
    customer = svc_get_customer_by_id(db, context.business_id, customer_id)
    return CustomerResponse.model_validate(customer)


@router.patch(
    "/{customer_id}",
    response_model=CustomerResponse,
    status_code=status.HTTP_200_OK,
    summary="Update customer profile",
    description="Update fields on an existing customer. Requires OWNER, ADMIN, or MEMBER role. Explicit null clears optional fields.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def update_customer(
    customer_id: uuid.UUID,
    request: CustomerUpdateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> CustomerResponse:
    """Update an existing customer profile."""
    customer = svc_update_customer(db, context.business_id, customer_id, request)
    return CustomerResponse.model_validate(customer)


@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deactivate customer (soft-delete)",
    description="Soft-delete a customer profile by marking is_active = false. Requires OWNER or ADMIN role. Preserves record for invoices.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN"))],
)
def delete_customer(
    customer_id: uuid.UUID,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Soft-delete a customer profile."""
    svc_delete_customer(db, context.business_id, customer_id)
