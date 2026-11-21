"""Transaction API endpoints for workspace ledger management and financial summaries."""

from datetime import date
import math
from typing import Annotated, Optional
import uuid
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentBusinessDep, RequireRoles
from app.core.database import get_db
from app.schemas.transaction import (
    FinancialSummaryResponse,
    TransactionCreateRequest,
    TransactionListResponse,
    TransactionResponse,
    TransactionUpdateRequest,
)
from app.services.transaction import (
    calculate_financial_summary as svc_calculate_summary,
    create_transaction as svc_create_transaction,
    get_transaction as svc_get_transaction,
    list_transactions as svc_list_transactions,
    soft_delete_transaction as svc_delete_transaction,
    update_transaction as svc_update_transaction,
)

router = APIRouter(prefix="/transactions", tags=["Transactions"])


@router.post(
    "",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create transaction entry",
    description="Record a new income or expense transaction in the active workspace. Requires OWNER, ADMIN, or MEMBER role.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def create_transaction(
    request: TransactionCreateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> TransactionResponse:
    """Create a new income or expense ledger transaction entry."""
    tx = svc_create_transaction(
        db=db,
        business_id=context.business_id,
        base_currency=context.business.base_currency,
        request=request,
    )
    return TransactionResponse.model_validate(tx)


@router.get(
    "",
    response_model=TransactionListResponse,
    status_code=status.HTTP_200_OK,
    summary="List workspace transactions",
    description="Query, filter, and paginate active transaction ledger records. Strictly read-only.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER", "VIEWER"))],
)
def list_transactions(
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
    type: Annotated[
        Optional[str],
        Query(
            description="Filter by cash flow type ('INCOME' or 'EXPENSE').",
            examples=["INCOME", "EXPENSE"],
        ),
    ] = None,
    category_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Filter by specific category UUID."),
    ] = None,
    start_date: Annotated[
        Optional[date],
        Query(description="Inclusive start date boundary (YYYY-MM-DD)."),
    ] = None,
    end_date: Annotated[
        Optional[date],
        Query(description="Inclusive end date boundary (YYYY-MM-DD)."),
    ] = None,
    search: Annotated[
        Optional[str],
        Query(
            max_length=100,
            description="Substring search across description or counterparty.",
        ),
    ] = None,
    sort_by: Annotated[
        str,
        Query(
            description="Allowlisted field to sort by.",
            examples=["transaction_date", "amount", "created_at"],
        ),
    ] = "transaction_date",
    sort_order: Annotated[
        str,
        Query(
            description="Sort direction ('asc' or 'desc').",
            examples=["asc", "desc"],
        ),
    ] = "desc",
    page: Annotated[
        int,
        Query(ge=1, description="Page index (1-based)."),
    ] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Items per page (max 100)."),
    ] = 20,
) -> TransactionListResponse:
    """Retrieve filtered, paginated transaction records with deterministic ordering."""
    items, total_count = svc_list_transactions(
        db=db,
        business_id=context.business_id,
        type_filter=type,
        category_id=category_id,
        start_date=start_date,
        end_date=end_date,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )
    total_pages = math.ceil(total_count / page_size) if total_count > 0 else 0
    return TransactionListResponse(
        items=[TransactionResponse.model_validate(t) for t in items],
        total=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# CRITICAL ROUTE ORDERING: /summary must be registered BEFORE /{transaction_id}
@router.get(
    "/summary",
    response_model=FinancialSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get financial calculation summary",
    description="Calculate period income, expense, net cash flow, and workspace-wide cumulative net movement.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER", "VIEWER"))],
)
def get_financial_summary(
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
    start_date: Annotated[
        Optional[date],
        Query(description="Inclusive start date. Defaults to first day of current UTC month."),
    ] = None,
    end_date: Annotated[
        Optional[date],
        Query(description="Inclusive end date. Defaults to current UTC date."),
    ] = None,
    category_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Optional category filter for period metrics and breakdowns."),
    ] = None,
) -> FinancialSummaryResponse:
    """Return SQL-aggregated cash movement overview and category breakdowns."""
    return svc_calculate_summary(
        db=db,
        business_id=context.business_id,
        currency=context.business.base_currency,
        start_date=start_date,
        end_date=end_date,
        category_id=category_id,
    )


@router.get(
    "/{transaction_id}",
    response_model=TransactionResponse,
    status_code=status.HTTP_200_OK,
    summary="Get transaction details",
    description="Retrieve details of a single active transaction. Strictly read-only.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER", "VIEWER"))],
)
def get_transaction(
    transaction_id: uuid.UUID,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> TransactionResponse:
    """Fetch an active transaction by UUID."""
    tx = svc_get_transaction(
        db=db,
        business_id=context.business_id,
        transaction_id=transaction_id,
    )
    return TransactionResponse.model_validate(tx)


@router.patch(
    "/{transaction_id}",
    response_model=TransactionResponse,
    status_code=status.HTTP_200_OK,
    summary="Update transaction entry",
    description="Modify an active transaction entry. Requires OWNER, ADMIN, or MEMBER role. Type is immutable.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def update_transaction(
    transaction_id: uuid.UUID,
    request: TransactionUpdateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> TransactionResponse:
    """Update editable fields of an active transaction."""
    tx = svc_update_transaction(
        db=db,
        business_id=context.business_id,
        transaction_id=transaction_id,
        request=request,
    )
    return TransactionResponse.model_validate(tx)


@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_200_OK,
    summary="Soft-delete transaction entry",
    description="Mark an active transaction as soft-deleted. Strictly restricted to OWNER and ADMIN roles.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN"))],
)
def delete_transaction(
    transaction_id: uuid.UUID,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Soft-delete a transaction record."""
    svc_delete_transaction(
        db=db,
        business_id=context.business_id,
        transaction_id=transaction_id,
    )
    return {
        "message": "Transaction successfully deleted",
        "id": str(transaction_id),
    }
