"""Domain service for multi-line invoice management, state machine, and financial arithmetic."""

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, DivisionByZero, ROUND_HALF_UP
import math
from typing import List, Optional, Tuple
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import BadRequestError, ConflictError, EntityNotFoundError, ValidationError
from app.models.customer import Customer
from app.models.invoice import Invoice, InvoiceItem
from app.schemas.invoice import InvoiceCreateRequest, InvoiceUpdateRequest

MAX_NUMERIC_15_2 = Decimal("999999999999.99")


class _ConcurrentRetryException(Exception):
    """Internal signal to trigger savepoint rollback and optimistic relationship refresh."""
    pass


def escape_sql_wildcards(term: str) -> str:
    """Escape LIKE/ILIKE special wildcard characters (% and _) and backslashes."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def calculate_line_total(quantity: Decimal, unit_price: Decimal) -> Decimal:
    """Calculate single line item total with ROUND_HALF_UP quantization."""
    try:
        line_total = (quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if line_total > MAX_NUMERIC_15_2:
            raise ValidationError(
                detail="Calculated line item total exceeds maximum monetary limit.",
                code="NUMERICAL_OVERFLOW_LIMIT",
            )
        return line_total
    except (InvalidOperation, OverflowError, DivisionByZero) as exc:
        raise ValidationError(
            detail="Arithmetic calculation failed during line total evaluation.",
            code="DECIMAL_CALCULATION_ERROR",
        ) from exc


def calculate_invoice_totals(
    items_data: List[Tuple[Decimal, Decimal]],
    tax_rate: Decimal,
    discount_amount: Decimal,
) -> Tuple[Decimal, Decimal, Decimal, Decimal]:
    """Calculate subtotal, tax_amount, total_amount, and balance_due.

    Args:
        items_data: List of (quantity, unit_price) tuples.
        tax_rate: Fractional tax rate [0.0000, 1.0000].
        discount_amount: Total discount.

    Returns:
        Tuple of (subtotal, tax_amount, total_amount, balance_due).
    """
    try:
        subtotal = Decimal("0.00")
        for qty, price in items_data:
            line_tot = calculate_line_total(qty, price)
            subtotal += line_tot

        if subtotal > MAX_NUMERIC_15_2:
            raise ValidationError(
                detail="Calculated subtotal exceeds maximum monetary limit.",
                code="NUMERICAL_OVERFLOW_LIMIT",
            )

        tax_amount = (subtotal * tax_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if tax_amount > MAX_NUMERIC_15_2:
            raise ValidationError(
                detail="Calculated tax amount exceeds maximum monetary limit.",
                code="NUMERICAL_OVERFLOW_LIMIT",
            )

        if discount_amount > (subtotal + tax_amount):
            raise ValidationError(
                detail="Discount amount cannot exceed subtotal + tax amount.",
                code="DISCOUNT_EXCEEDS_TOTAL",
            )

        total_amount = subtotal + tax_amount - discount_amount
        if total_amount > MAX_NUMERIC_15_2:
            raise ValidationError(
                detail="Calculated total amount exceeds maximum monetary limit.",
                code="NUMERICAL_OVERFLOW_LIMIT",
            )

        balance_due = total_amount  # For new/draft invoices, paid_amount = 0
        return subtotal, tax_amount, total_amount, balance_due

    except (InvalidOperation, OverflowError, DivisionByZero) as exc:
        raise ValidationError(
            detail="Arithmetic calculation failed during invoice totals evaluation.",
            code="DECIMAL_CALCULATION_ERROR",
        ) from exc


def derive_presentation_status(
    persisted_status: str,
    due_date: date,
    balance_due: Decimal,
    request_today_utc: date,
) -> str:
    """Derive dynamic presentation status (including runtime OVERDUE)."""
    if (
        persisted_status in ("SENT", "PARTIALLY_PAID")
        and due_date < request_today_utc
        and balance_due > Decimal("0.00")
    ):
        return "OVERDUE"
    return persisted_status


def create_invoice(
    db: Session,
    business_id: uuid.UUID,
    request: InvoiceCreateRequest,
) -> Invoice:
    """Create and persist a new multi-line invoice in DRAFT status."""
    # 1. Acquire customer row lock with populate_existing()
    customer = (
        db.query(Customer)
        .filter(Customer.id == request.customer_id, Customer.business_id == business_id)
        .with_for_update()
        .populate_existing()
        .one_or_none()
    )
    if not customer:
        raise EntityNotFoundError("Customer not found", code="CUSTOMER_NOT_FOUND")

    if not customer.is_active:
        raise ValidationError("Cannot create invoice for an inactive customer", code="CUSTOMER_INACTIVE")

    if not request.items:
        raise ValidationError("Invoice must contain at least one line item", code="INVOICE_ITEMS_EMPTY")

    # 2. Calculate totals
    items_tuples = [
        (Decimal(str(item.quantity)), Decimal(str(item.unit_price)))
        for item in request.items
    ]
    tax_rate_dec = Decimal(str(request.tax_rate))
    discount_dec = Decimal(str(request.discount_amount))

    subtotal, tax_amount, total_amount, balance_due = calculate_invoice_totals(
        items_tuples, tax_rate_dec, discount_dec
    )

    now = datetime.now(timezone.utc)
    invoice = Invoice(
        id=uuid.uuid4(),
        business_id=business_id,
        customer_id=request.customer_id,
        invoice_number=request.invoice_number,
        status="DRAFT",
        issue_date=request.issue_date,
        due_date=request.due_date,
        subtotal=subtotal,
        tax_rate=tax_rate_dec,
        tax_amount=tax_amount,
        discount_amount=discount_dec,
        total_amount=total_amount,
        paid_amount=Decimal("0.00"),
        balance_due=balance_due,
        notes=request.notes,
        created_at=now,
        updated_at=now,
    )

    for item_req in request.items:
        qty_dec = Decimal(str(item_req.quantity))
        price_dec = Decimal(str(item_req.unit_price))
        line_tot = calculate_line_total(qty_dec, price_dec)
        item = InvoiceItem(
            id=uuid.uuid4(),
            invoice_id=invoice.id,
            description=item_req.description,
            quantity=qty_dec,
            unit_price=price_dec,
            line_total=line_tot,
            created_at=now,
        )
        invoice.items.append(item)

    db.add(invoice)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        err_str = str(exc.orig) if hasattr(exc, "orig") else str(exc)
        if (
            "uq_invoices_business_invoice_number" in err_str
            or "invoices.business_id, invoices.invoice_number" in err_str
            or "invoices.invoice_number" in err_str
        ):
            raise ConflictError(
                detail=f"Invoice number '{request.invoice_number}' already exists in this workspace.",
                code="INVOICE_NUMBER_ALREADY_EXISTS",
            ) from exc
        raise

    db.commit()
    db.refresh(invoice)
    return invoice


def get_invoices_for_workspace(
    db: Session,
    business_id: uuid.UUID,
    status: Optional[str] = None,
    customer_id: Optional[uuid.UUID] = None,
    search: Optional[str] = None,
    issue_date_from: Optional[date] = None,
    issue_date_to: Optional[date] = None,
    due_date_from: Optional[date] = None,
    due_date_to: Optional[date] = None,
    page: int = 1,
    page_size: int = 20,
    request_today_utc: Optional[date] = None,
) -> Tuple[List[Invoice], int]:
    """Retrieve paginated invoices for a workspace with explicit SQL status filter semantics."""
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

    ref_date = request_today_utc or datetime.now(timezone.utc).date()

    query = (
        db.query(Invoice)
        .options(joinedload(Invoice.customer))
        .filter(Invoice.business_id == business_id)
    )

    # 1. Apply status filter
    if status is not None and status.upper() != "ALL":
        status_upper = status.upper()
        if status_upper == "OVERDUE":
            query = query.filter(
                Invoice.status.in_(["SENT", "PARTIALLY_PAID"]),
                Invoice.due_date < ref_date,
                Invoice.balance_due > Decimal("0.00"),
            )
        elif status_upper == "SENT":
            query = query.filter(
                Invoice.status == "SENT",
                or_(
                    Invoice.due_date >= ref_date,
                    Invoice.balance_due <= Decimal("0.00"),
                ),
            )
        elif status_upper == "PARTIALLY_PAID":
            query = query.filter(
                Invoice.status == "PARTIALLY_PAID",
                or_(
                    Invoice.due_date >= ref_date,
                    Invoice.balance_due <= Decimal("0.00"),
                ),
            )
        elif status_upper == "DRAFT":
            query = query.filter(Invoice.status == "DRAFT")
        elif status_upper == "PAID":
            query = query.filter(Invoice.status == "PAID")
        elif status_upper == "CANCELED":
            query = query.filter(Invoice.status == "CANCELED")
        else:
            raise ValidationError(
                detail=f"Invalid status filter '{status}'.",
                code="INVALID_STATUS_FILTER",
            )

    # 2. Customer ID filter
    if customer_id is not None:
        query = query.filter(Invoice.customer_id == customer_id)

    # 3. Search on invoice_number
    if search is not None and search.strip():
        clean_search = escape_sql_wildcards(search.strip())
        query = query.filter(Invoice.invoice_number.ilike(f"%{clean_search}%"))

    # 4. Date range filters
    if issue_date_from is not None:
        query = query.filter(Invoice.issue_date >= issue_date_from)
    if issue_date_to is not None:
        query = query.filter(Invoice.issue_date <= issue_date_to)
    if due_date_from is not None:
        query = query.filter(Invoice.due_date >= due_date_from)
    if due_date_to is not None:
        query = query.filter(Invoice.due_date <= due_date_to)

    total_count = query.count()

    # Deterministic sorting
    query = query.order_by(Invoice.created_at.desc(), Invoice.id.desc())

    offset = (page - 1) * page_size
    items = query.offset(offset).limit(page_size).all()
    return items, total_count


def get_invoice_by_id(
    db: Session,
    business_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> Invoice:
    """Retrieve single invoice with items and customer eagerly loaded."""
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.customer), joinedload(Invoice.items))
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .one_or_none()
    )
    if not invoice:
        raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")
    return invoice


def update_invoice(
    db: Session,
    business_id: uuid.UUID,
    invoice_id: uuid.UUID,
    request: InvoiceUpdateRequest,
) -> Invoice:
    """Update a DRAFT invoice with full concurrency and numerical protection."""
    update_data = request.model_dump(exclude_unset=True)
    if not update_data:
        raise BadRequestError(
            detail="At least one field must be provided for update.",
            code="EMPTY_UPDATE_PAYLOAD",
        )

    # Check non-nullable fields explicitly passed as None
    for field_name in ("customer_id", "invoice_number", "issue_date", "due_date", "tax_rate", "discount_amount", "items"):
        if field_name in update_data and update_data[field_name] is None:
            raise ValidationError(
                detail=f"Field '{field_name}' cannot be null.",
                code="FIELD_CANNOT_BE_NULL",
            )

    # Branch 1: Customer reassignment requested
    if request.customer_id is not None:
        # 1. Preliminary unlocked check
        prelim_customer = (
            db.query(Customer)
            .filter(Customer.id == request.customer_id, Customer.business_id == business_id)
            .one_or_none()
        )
        if not prelim_customer:
            raise EntityNotFoundError("Customer not found", code="CUSTOMER_NOT_FOUND")

        # 2. Initial optimistic read of invoice
        observed_old_id = (
            db.query(Invoice.customer_id)
            .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
            .scalar()
        )
        if not observed_old_id:
            raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")

        for attempt in range(1, 4):  # Bounded retry: at most 3 attempts
            try:
                with db.begin_nested():  # SAVEPOINT
                    lock_customer_ids = sorted([observed_old_id, request.customer_id])

                    # Lock customers in canonical order with populate_existing()
                    locked_customers = (
                        db.query(Customer)
                        .filter(Customer.id.in_(lock_customer_ids), Customer.business_id == business_id)
                        .order_by(Customer.id.asc())
                        .with_for_update()
                        .populate_existing()
                        .all()
                    )

                    locked_new_cust = next((c for c in locked_customers if c.id == request.customer_id), None)
                    if not locked_new_cust:
                        raise EntityNotFoundError("Customer not found", code="CUSTOMER_NOT_FOUND")

                    # Lock invoice with populate_existing()
                    inv = (
                        db.query(Invoice)
                        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
                        .with_for_update()
                        .populate_existing()
                        .one_or_none()
                    )
                    if not inv:
                        raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")

                    if inv.customer_id != observed_old_id:
                        raise _ConcurrentRetryException()

                    if inv.status != "DRAFT":
                        raise ConflictError("Only DRAFT invoices can be edited", code="INVOICE_NOT_EDITABLE")

                    if not locked_new_cust.is_active:
                        raise ValidationError("Target customer is inactive", code="CUSTOMER_INACTIVE")

                    # Apply customer reassignment
                    inv.customer_id = request.customer_id
                    _apply_draft_updates(db, inv, request, update_data)
                    db.flush()
                db.commit()
                db.refresh(inv)
                return inv

            except _ConcurrentRetryException:
                refreshed_old_id = (
                    db.query(Invoice.customer_id)
                    .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
                    .scalar()
                )
                if not refreshed_old_id:
                    raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")
                observed_old_id = refreshed_old_id
                continue

        raise ConflictError(
            detail="Concurrent customer reassignment conflict; retry limit exceeded.",
            code="CONCURRENT_CUSTOMER_REASSIGNMENT_CONFLICT",
        )

    # Branch 2: Ordinary draft edits without customer change
    inv = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .with_for_update()
        .populate_existing()
        .one_or_none()
    )
    if not inv:
        raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")

    if inv.status != "DRAFT":
        raise ConflictError("Only DRAFT invoices can be edited", code="INVOICE_NOT_EDITABLE")

    _apply_draft_updates(db, inv, request, update_data)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        err_str = str(exc.orig) if hasattr(exc, "orig") else str(exc)
        if (
            "uq_invoices_business_invoice_number" in err_str
            or "invoices.business_id, invoices.invoice_number" in err_str
            or "invoices.invoice_number" in err_str
        ):
            raise ConflictError(
                detail=f"Invoice number '{inv.invoice_number}' already exists in this workspace.",
                code="INVOICE_NUMBER_ALREADY_EXISTS",
            ) from exc
        raise

    db.commit()
    db.refresh(inv)
    return inv


def _apply_draft_updates(
    db: Session,
    inv: Invoice,
    request: InvoiceUpdateRequest,
    update_data: dict,
) -> None:
    """Helper to apply and recalculate updated draft invoice fields."""
    # 1. Merged date validation
    effective_issue = request.issue_date if request.issue_date is not None else inv.issue_date
    effective_due = request.due_date if request.due_date is not None else inv.due_date
    if effective_due < effective_issue:
        raise ValidationError(
            detail="INVALID_DATE_RANGE: due_date cannot be earlier than issue_date.",
            code="INVALID_DATE_RANGE",
        )
    inv.issue_date = effective_issue
    inv.due_date = effective_due

    if request.invoice_number is not None:
        inv.invoice_number = request.invoice_number

    if "notes" in update_data:
        inv.notes = request.notes

    # 2. Recalculate totals if items, tax_rate, or discount_amount changed
    recalculate = ("items" in update_data) or ("tax_rate" in update_data) or ("discount_amount" in update_data)

    if "items" in update_data and request.items is not None:
        # Replace line items atomically
        for old_item in list(inv.items):
            db.delete(old_item)
        inv.items.clear()

        now = datetime.now(timezone.utc)
        for item_req in request.items:
            qty_dec = Decimal(str(item_req.quantity))
            price_dec = Decimal(str(item_req.unit_price))
            line_tot = calculate_line_total(qty_dec, price_dec)
            item = InvoiceItem(
                id=uuid.uuid4(),
                invoice_id=inv.id,
                description=item_req.description,
                quantity=qty_dec,
                unit_price=price_dec,
                line_total=line_tot,
                created_at=now,
            )
            inv.items.append(item)

    if recalculate:
        effective_tax_rate = Decimal(str(request.tax_rate)) if request.tax_rate is not None else inv.tax_rate
        effective_discount = Decimal(str(request.discount_amount)) if request.discount_amount is not None else inv.discount_amount

        items_tuples = [
            (item.quantity, item.unit_price)
            for item in inv.items
        ]
        subtotal, tax_amount, total_amount, balance_due = calculate_invoice_totals(
            items_tuples, effective_tax_rate, effective_discount
        )
        inv.subtotal = subtotal
        inv.tax_rate = effective_tax_rate
        inv.tax_amount = tax_amount
        inv.discount_amount = effective_discount
        inv.total_amount = total_amount
        inv.balance_due = total_amount - inv.paid_amount

    inv.updated_at = datetime.now(timezone.utc)


def transition_invoice_status(
    db: Session,
    business_id: uuid.UUID,
    invoice_id: uuid.UUID,
    action: str,
) -> Invoice:
    """Execute status transition on an invoice with row-level concurrency protection."""
    if action == "MARK_SENT":
        return _mark_invoice_sent(db, business_id, invoice_id)
    elif action == "CANCEL":
        return _cancel_invoice(db, business_id, invoice_id)
    else:
        raise BadRequestError(
            detail=f"Unsupported status transition action '{action}'.",
            code="INVALID_ACTION",
        )


def _mark_invoice_sent(
    db: Session,
    business_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> Invoice:
    """Transition DRAFT -> SENT with Customer-before-Invoice locking and bounded retry."""
    observed_customer_id = (
        db.query(Invoice.customer_id)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .scalar()
    )
    if not observed_customer_id:
        raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")

    for attempt in range(1, 4):  # Bounded retry: at most 3 attempts
        try:
            with db.begin_nested():  # SAVEPOINT
                # 1. Lock customer first with populate_existing()
                customer = (
                    db.query(Customer)
                    .filter(Customer.id == observed_customer_id, Customer.business_id == business_id)
                    .with_for_update()
                    .populate_existing()
                    .one_or_none()
                )
                if not customer:
                    raise EntityNotFoundError("Customer not found", code="CUSTOMER_NOT_FOUND")

                # 2. Lock invoice second with populate_existing()
                inv = (
                    db.query(Invoice)
                    .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
                    .with_for_update()
                    .populate_existing()
                    .one_or_none()
                )
                if not inv:
                    raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")

                # 3. Verify relationship has not changed
                if inv.customer_id != observed_customer_id:
                    raise _ConcurrentRetryException()

                # 4. Post-lock state validation
                if inv.status != "DRAFT":
                    raise ConflictError("Only DRAFT invoices can be marked SENT", code="INVALID_STATUS_TRANSITION")

                if inv.total_amount <= Decimal("0.00"):
                    raise ValidationError("Invoice total must be greater than zero to be sent", code="INVOICE_TOTAL_ZERO")

                if not customer.is_active:
                    raise ValidationError("Cannot issue invoice to an inactive customer", code="CUSTOMER_INACTIVE")

                # 5. Apply state transition
                inv.status = "SENT"
                inv.updated_at = datetime.now(timezone.utc)
                db.flush()
            db.commit()
            db.refresh(inv)
            return inv

        except _ConcurrentRetryException:
            refreshed_customer_id = (
                db.query(Invoice.customer_id)
                .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
                .scalar()
            )
            if not refreshed_customer_id:
                raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")
            observed_customer_id = refreshed_customer_id
            continue

    raise ConflictError(
        detail="Concurrent customer modification conflict; retry limit exceeded.",
        code="CONCURRENT_CUSTOMER_REASSIGNMENT_CONFLICT",
    )


def _cancel_invoice(
    db: Session,
    business_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> Invoice:
    """Transition DRAFT or SENT (with paid_amount=0) -> CANCELED preserving all historical numbers."""
    inv = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .with_for_update()
        .populate_existing()
        .one_or_none()
    )
    if not inv:
        raise EntityNotFoundError("Invoice not found", code="INVOICE_NOT_FOUND")

    if inv.status == "CANCELED":
        raise ConflictError("Invoice is already canceled", code="INVOICE_ALREADY_CANCELED")

    if inv.status == "PAID":
        raise ValidationError("Cannot cancel a paid invoice", code="CANNOT_CANCEL_PAID_INVOICE")

    if inv.status == "PARTIALLY_PAID":
        raise ValidationError("Cannot cancel a partially paid invoice in Phase 2.5", code="CANNOT_CANCEL_PARTIALLY_PAID_INVOICE")

    if inv.status == "SENT" and inv.paid_amount > Decimal("0.00"):
        raise ValidationError("Cannot cancel an invoice with recorded payments", code="CANNOT_CANCEL_PARTIALLY_PAID_INVOICE")

    # Invariants: preserve subtotal, tax_rate, tax_amount, discount_amount, total_amount, paid_amount, balance_due
    inv.status = "CANCELED"
    inv.updated_at = datetime.now(timezone.utc)
    db.flush()
    db.commit()
    db.refresh(inv)
    return inv
