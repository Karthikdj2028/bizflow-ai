"""Invoice API endpoints for multi-line invoice management and lifecycle transitions."""

from datetime import date, datetime, timezone
import math
from typing import Annotated, Optional
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentBusinessDep, RequireRoles
from app.core.database import get_db
from app.models.invoice import Invoice
from app.schemas.invoice import (
    InvoiceCreateRequest,
    InvoiceDetailResponse,
    InvoiceItemResponse,
    InvoiceListItemResponse,
    InvoicePaginationResponse,
    InvoiceStatusTransitionRequest,
    InvoiceUpdateRequest,
)
from app.services.invoice import (
    create_invoice as svc_create_invoice,
    derive_presentation_status,
    get_invoice_by_id as svc_get_invoice_by_id,
    get_invoices_for_workspace as svc_get_invoices,
    transition_invoice_status as svc_transition_status,
    update_invoice as svc_update_invoice,
)

router = APIRouter(prefix="/invoices", tags=["Invoices"])


def _to_detail_response(inv: Invoice, request_today_utc: date) -> InvoiceDetailResponse:
    """Serialize an Invoice ORM model to InvoiceDetailResponse with exact string formatting."""
    pres_status = derive_presentation_status(
        persisted_status=inv.status,
        due_date=inv.due_date,
        balance_due=inv.balance_due,
        request_today_utc=request_today_utc,
    )
    items_resp = [
        InvoiceItemResponse(
            id=item.id,
            invoice_id=item.invoice_id,
            description=item.description,
            quantity=f"{item.quantity:.2f}",
            unit_price=f"{item.unit_price:.2f}",
            line_total=f"{item.line_total:.2f}",
            created_at=item.created_at,
        )
        for item in inv.items
    ]
    return InvoiceDetailResponse(
        id=inv.id,
        business_id=inv.business_id,
        customer_id=inv.customer_id,
        customer_name=inv.customer.name if inv.customer else "",
        invoice_number=inv.invoice_number,
        status=pres_status,
        persisted_status=inv.status,
        issue_date=inv.issue_date,
        due_date=inv.due_date,
        subtotal=f"{inv.subtotal:.2f}",
        tax_rate=f"{inv.tax_rate:.4f}",
        tax_amount=f"{inv.tax_amount:.2f}",
        discount_amount=f"{inv.discount_amount:.2f}",
        total_amount=f"{inv.total_amount:.2f}",
        paid_amount=f"{inv.paid_amount:.2f}",
        balance_due=f"{inv.balance_due:.2f}",
        notes=inv.notes,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
        items=items_resp,
    )


def _to_list_item_response(inv: Invoice, request_today_utc: date) -> InvoiceListItemResponse:
    """Serialize an Invoice ORM model to InvoiceListItemResponse."""
    pres_status = derive_presentation_status(
        persisted_status=inv.status,
        due_date=inv.due_date,
        balance_due=inv.balance_due,
        request_today_utc=request_today_utc,
    )
    return InvoiceListItemResponse(
        id=inv.id,
        business_id=inv.business_id,
        customer_id=inv.customer_id,
        customer_name=inv.customer.name if inv.customer else "",
        invoice_number=inv.invoice_number,
        status=pres_status,
        persisted_status=inv.status,
        issue_date=inv.issue_date,
        due_date=inv.due_date,
        subtotal=f"{inv.subtotal:.2f}",
        tax_rate=f"{inv.tax_rate:.4f}",
        tax_amount=f"{inv.tax_amount:.2f}",
        discount_amount=f"{inv.discount_amount:.2f}",
        total_amount=f"{inv.total_amount:.2f}",
        paid_amount=f"{inv.paid_amount:.2f}",
        balance_due=f"{inv.balance_due:.2f}",
        notes=inv.notes,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
    )


@router.get(
    "",
    response_model=InvoicePaginationResponse,
    status_code=status.HTTP_200_OK,
    summary="List workspace invoices",
    description="Retrieve paginated invoices for the active workspace with filtering by status, customer, search, and date ranges.",
)
def list_invoices(
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
    status: Annotated[
        Optional[str],
        Query(description="Filter by status: ALL, DRAFT, SENT, OVERDUE, PARTIALLY_PAID, PAID, CANCELED."),
    ] = None,
    customer_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Filter by specific customer ID."),
    ] = None,
    search: Annotated[
        Optional[str],
        Query(max_length=64, description="Search term matching invoice number substring."),
    ] = None,
    issue_date_from: Annotated[
        Optional[date],
        Query(description="Filter invoices issued on or after this date (inclusive)."),
    ] = None,
    issue_date_to: Annotated[
        Optional[date],
        Query(description="Filter invoices issued on or before this date (inclusive)."),
    ] = None,
    due_date_from: Annotated[
        Optional[date],
        Query(description="Filter invoices due on or after this date (inclusive)."),
    ] = None,
    due_date_to: Annotated[
        Optional[date],
        Query(description="Filter invoices due on or before this date (inclusive)."),
    ] = None,
    page: Annotated[
        int,
        Query(ge=1, description="Page number (1-based index)."),
    ] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Items per page (max 100)."),
    ] = 20,
) -> InvoicePaginationResponse:
    """List paginated invoices for the authenticated business workspace."""
    request_today_utc = datetime.now(timezone.utc).date()

    items, total = svc_get_invoices(
        db=db,
        business_id=context.business_id,
        status=status,
        customer_id=customer_id,
        search=search,
        issue_date_from=issue_date_from,
        issue_date_to=issue_date_to,
        due_date_from=due_date_from,
        due_date_to=due_date_to,
        page=page,
        page_size=page_size,
        request_today_utc=request_today_utc,
    )

    total_pages = math.ceil(total / page_size) if total > 0 else 0
    return InvoicePaginationResponse(
        items=[_to_list_item_response(inv, request_today_utc) for inv in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post(
    "",
    response_model=InvoiceDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create new draft invoice",
    description="Create a new multi-line invoice in DRAFT status. Requires OWNER, ADMIN, or MEMBER role.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def create_invoice(
    request: InvoiceCreateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> InvoiceDetailResponse:
    """Create a new multi-line draft invoice."""
    request_today_utc = datetime.now(timezone.utc).date()
    invoice = svc_create_invoice(db, context.business_id, request)
    return _to_detail_response(invoice, request_today_utc)


@router.get(
    "/{invoice_id}",
    response_model=InvoiceDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get invoice detail",
    description="Retrieve complete invoice detail including line items. Enforces workspace isolation.",
)
def get_invoice(
    invoice_id: uuid.UUID,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> InvoiceDetailResponse:
    """Retrieve an invoice by ID."""
    request_today_utc = datetime.now(timezone.utc).date()
    invoice = svc_get_invoice_by_id(db, context.business_id, invoice_id)
    return _to_detail_response(invoice, request_today_utc)


@router.patch(
    "/{invoice_id}",
    response_model=InvoiceDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Update draft invoice",
    description="Partially update a DRAFT invoice. Requires OWNER, ADMIN, or MEMBER role.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def update_invoice(
    invoice_id: uuid.UUID,
    request: InvoiceUpdateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> InvoiceDetailResponse:
    """Update a draft invoice."""
    request_today_utc = datetime.now(timezone.utc).date()
    invoice = svc_update_invoice(db, context.business_id, invoice_id, request)
    return _to_detail_response(invoice, request_today_utc)


@router.post(
    "/{invoice_id}/status",
    response_model=InvoiceDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Transition invoice status",
    description="Execute lifecycle transition: action='MARK_SENT' (DRAFT -> SENT) or action='CANCEL'. Requires OWNER, ADMIN, or MEMBER role.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def transition_invoice_status(
    invoice_id: uuid.UUID,
    request: InvoiceStatusTransitionRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> InvoiceDetailResponse:
    """Transition an invoice's lifecycle state."""
    request_today_utc = datetime.now(timezone.utc).date()
    invoice = svc_transition_status(db, context.business_id, invoice_id, request.action)
    return _to_detail_response(invoice, request_today_utc)
