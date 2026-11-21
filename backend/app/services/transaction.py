"""Domain service for transaction ledger management and financial calculations."""

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import math
from typing import List, Optional, Tuple
import uuid
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import BadRequestError, EntityNotFoundError, ValidationError
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.transaction import (
    CategoryBreakdownResponse,
    FinancialSummaryPeriod,
    FinancialSummaryResponse,
    TransactionCreateRequest,
    TransactionResponse,
    TransactionUpdateRequest,
)


def escape_sql_wildcards(term: str) -> str:
    """Escape LIKE/ILIKE special wildcard characters (% and _) and backslashes."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _attach_category_metadata(tx: Transaction) -> None:
    """Populate category display properties onto the Transaction instance for response serialization."""
    if tx.category is not None:
        tx.category_name = tx.category.name
        tx.category_color = tx.category.color_hex
    else:
        tx.category_name = None
        tx.category_color = None


def create_transaction(
    db: Session,
    business_id: uuid.UUID,
    base_currency: str,
    request: TransactionCreateRequest,
) -> Transaction:
    """Record a new income or expense transaction in the workspace ledger."""
    # 1. Verify category exists within this business workspace
    category = db.scalar(
        select(Category).where(
            Category.id == request.category_id,
            Category.business_id == business_id,
        )
    )
    if category is None:
        raise EntityNotFoundError(
            detail=f"Category '{request.category_id}' not found in active workspace.",
            code="CATEGORY_NOT_FOUND",
        )

    # 2. Verify category cash flow type matches transaction type
    if category.type != request.type:
        raise BadRequestError(
            detail=f"Category type '{category.type}' does not match transaction type '{request.type}'.",
            code="CATEGORY_TYPE_MISMATCH",
        )

    # 3. Instantiate and persist transaction
    now = datetime.now(timezone.utc)
    tx = Transaction(
        id=uuid.uuid4(),
        business_id=business_id,
        category_id=category.id,
        type=request.type,
        amount=Decimal(request.amount),
        currency=base_currency,
        transaction_date=request.transaction_date,
        description=request.description,
        counterparty=request.counterparty,
        reference_number=request.reference_number,
        payment_method=request.payment_method,
        created_at=now,
        updated_at=now,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    _attach_category_metadata(tx)
    return tx


def get_transaction(
    db: Session,
    business_id: uuid.UUID,
    transaction_id: uuid.UUID,
) -> Transaction:
    """Retrieve an active transaction by UUID within the workspace scope."""
    tx = db.scalar(
        select(Transaction)
        .options(joinedload(Transaction.category))
        .where(
            Transaction.id == transaction_id,
            Transaction.business_id == business_id,
            Transaction.deleted_at.is_(None),
        )
    )
    if tx is None:
        raise EntityNotFoundError(
            detail=f"Transaction '{transaction_id}' not found.",
            code="TRANSACTION_NOT_FOUND",
        )

    _attach_category_metadata(tx)
    return tx


def list_transactions(
    db: Session,
    business_id: uuid.UUID,
    type_filter: Optional[str] = None,
    category_id: Optional[uuid.UUID] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    search: Optional[str] = None,
    sort_by: str = "transaction_date",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Transaction], int]:
    """Query, filter, sort, and paginate active transactions for the workspace."""
    # Validate pagination bounds
    if page < 1:
        raise BadRequestError("Page index must be greater than or equal to 1.", code="INVALID_PAGE")
    if page_size < 1 or page_size > 100:
        raise BadRequestError("Page size must be between 1 and 100.", code="INVALID_PAGE_SIZE")

    # Validate date range if both provided
    if start_date is not None and end_date is not None and start_date > end_date:
        raise BadRequestError("Start date cannot be later than end date.", code="INVALID_DATE_RANGE")

    # Base filtering: tenant and active records
    base_conditions = [
        Transaction.business_id == business_id,
        Transaction.deleted_at.is_(None),
    ]

    if type_filter:
        base_conditions.append(Transaction.type == type_filter)
    if category_id:
        base_conditions.append(Transaction.category_id == category_id)
    if start_date:
        base_conditions.append(Transaction.transaction_date >= start_date)
    if end_date:
        base_conditions.append(Transaction.transaction_date <= end_date)
    if search:
        escaped_search = escape_sql_wildcards(search.strip())
        pattern = f"%{escaped_search}%"
        base_conditions.append(
            or_(
                Transaction.description.ilike(pattern, escape="\\"),
                Transaction.counterparty.ilike(pattern, escape="\\"),
            )
        )

    # 1. Total count query
    count_stmt = select(func.count(Transaction.id)).where(*base_conditions)
    total_count = db.scalar(count_stmt) or 0

    # 2. Deterministic sort selection
    sort_column_map = {
        "transaction_date": Transaction.transaction_date,
        "amount": Transaction.amount,
        "created_at": Transaction.created_at,
    }
    primary_sort_col = sort_column_map.get(sort_by, Transaction.transaction_date)
    primary_order = primary_sort_col.desc() if sort_order.lower() == "desc" else primary_sort_col.asc()
    tie_breaker = Transaction.id.desc()

    # 3. Paginated items query with eager loaded category
    offset = (page - 1) * page_size
    items_stmt = (
        select(Transaction)
        .options(joinedload(Transaction.category))
        .where(*base_conditions)
        .order_by(primary_order, tie_breaker)
        .offset(offset)
        .limit(page_size)
    )
    items = list(db.scalars(items_stmt).all())

    for tx in items:
        _attach_category_metadata(tx)

    return items, total_count


def update_transaction(
    db: Session,
    business_id: uuid.UUID,
    transaction_id: uuid.UUID,
    request: TransactionUpdateRequest,
) -> Transaction:
    """Modify an existing transaction record with audit timestamp updating."""
    fields_set = request.model_fields_set
    if not fields_set:
        raise BadRequestError(
            detail="Empty update payload. At least one field must be provided.",
            code="EMPTY_UPDATE_PAYLOAD",
        )

    tx = db.scalar(
        select(Transaction)
        .options(joinedload(Transaction.category))
        .where(
            Transaction.id == transaction_id,
            Transaction.business_id == business_id,
            Transaction.deleted_at.is_(None),
        )
    )
    if tx is None:
        raise EntityNotFoundError(
            detail=f"Transaction '{transaction_id}' not found.",
            code="TRANSACTION_NOT_FOUND",
        )

    fields_set = request.model_fields_set

    # 1. If updating category, verify existence and type matching against immutable transaction type
    if "category_id" in fields_set and request.category_id is not None:
        cat = db.scalar(
            select(Category).where(
                Category.id == request.category_id,
                Category.business_id == business_id,
            )
        )
        if cat is None:
            raise EntityNotFoundError(
                detail=f"Category '{request.category_id}' not found in active workspace.",
                code="CATEGORY_NOT_FOUND",
            )
        if cat.type != tx.type:
            raise BadRequestError(
                detail=f"Category type '{cat.type}' does not match immutable transaction type '{tx.type}'.",
                code="CATEGORY_TYPE_MISMATCH",
            )
        tx.category_id = cat.id

    # 2. Update remaining fields
    if "amount" in fields_set and request.amount is not None:
        tx.amount = Decimal(request.amount)
    if "transaction_date" in fields_set and request.transaction_date is not None:
        tx.transaction_date = request.transaction_date
    if "description" in fields_set and request.description is not None:
        tx.description = request.description
    if "counterparty" in fields_set:
        tx.counterparty = request.counterparty
    if "reference_number" in fields_set:
        tx.reference_number = request.reference_number
    if "payment_method" in fields_set and request.payment_method is not None:
        tx.payment_method = request.payment_method

    tx.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(tx)

    _attach_category_metadata(tx)
    return tx


def soft_delete_transaction(
    db: Session,
    business_id: uuid.UUID,
    transaction_id: uuid.UUID,
) -> None:
    """Mark an active transaction as soft-deleted."""
    tx = db.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.business_id == business_id,
            Transaction.deleted_at.is_(None),
        )
    )
    if tx is None:
        raise EntityNotFoundError(
            detail=f"Transaction '{transaction_id}' not found.",
            code="TRANSACTION_NOT_FOUND",
        )

    now = datetime.now(timezone.utc)
    tx.deleted_at = now
    tx.updated_at = now
    db.commit()


def calculate_financial_summary(
    db: Session,
    business_id: uuid.UUID,
    currency: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    category_id: Optional[uuid.UUID] = None,
) -> FinancialSummaryResponse:
    """Calculate period income, expenses, net cash flow, and workspace-wide cumulative movement."""
    current_utc_date = datetime.now(timezone.utc).date()

    # 1. Establish deterministic date boundaries
    effective_end_date = end_date if end_date is not None else current_utc_date
    effective_start_date = (
        start_date
        if start_date is not None
        else effective_end_date.replace(day=1)
    )

    # 2. Validate date range constraints
    if effective_start_date > effective_end_date:
        raise BadRequestError(
            detail="Start date cannot be later than end date.",
            code="INVALID_DATE_RANGE",
        )
    if effective_end_date > current_utc_date:
        raise ValidationError(
            detail="End date cannot be in the future.",
            code="FUTURE_END_DATE_NOT_PERMITTED",
        )

    # 3. Query period metrics: Income and Expense totals
    period_conditions = [
        Transaction.business_id == business_id,
        Transaction.deleted_at.is_(None),
        Transaction.transaction_date >= effective_start_date,
        Transaction.transaction_date <= effective_end_date,
    ]
    if category_id is not None:
        period_conditions.append(Transaction.category_id == category_id)

    metrics_stmt = (
        select(
            Transaction.type,
            func.coalesce(func.sum(Transaction.amount), Decimal("0.00")).label("total_amount"),
            func.count(Transaction.id).label("tx_count"),
        )
        .where(*period_conditions)
        .group_by(Transaction.type)
    )
    metrics_rows = db.execute(metrics_stmt).fetchall()

    total_income = Decimal("0.00")
    total_expenses = Decimal("0.00")
    total_count = 0

    for row in metrics_rows:
        row_type, row_sum, row_cnt = row[0], Decimal(str(row[1])), int(row[2])
        total_count += row_cnt
        if row_type == "INCOME":
            total_income = row_sum
        elif row_type == "EXPENSE":
            total_expenses = row_sum

    net_cash_flow = total_income - total_expenses

    # 4. Query category breakdowns in period (honors category_id filter if provided)
    cat_stmt = (
        select(
            Transaction.category_id,
            Category.name.label("category_name"),
            Category.color_hex.label("category_color"),
            Transaction.type,
            func.coalesce(func.sum(Transaction.amount), Decimal("0.00")).label("total_amount"),
            func.count(Transaction.id).label("tx_count"),
        )
        .join(Category, Category.id == Transaction.category_id)
        .where(*period_conditions)
        .group_by(Transaction.category_id, Category.name, Category.color_hex, Transaction.type)
        .order_by(func.sum(Transaction.amount).desc())
    )
    cat_rows = db.execute(cat_stmt).fetchall()

    income_breakdown: List[CategoryBreakdownResponse] = []
    expense_breakdown: List[CategoryBreakdownResponse] = []

    for row in cat_rows:
        c_id, c_name, c_color, c_type, c_amount, c_cnt = (
            row[0],
            row[1],
            row[2],
            row[3],
            Decimal(str(row[4])),
            int(row[5]),
        )
        if c_type == "INCOME":
            share = (
                (c_amount / total_income) * Decimal("100")
                if total_income > Decimal("0.00")
                else Decimal("0.00")
            )
            pct_str = f"{share.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):.2f}"
            income_breakdown.append(
                CategoryBreakdownResponse(
                    category_id=c_id,
                    category_name=c_name,
                    category_color=c_color,
                    total_amount=f"{c_amount:.2f}",
                    count=c_cnt,
                    percentage=pct_str,
                )
            )
        elif c_type == "EXPENSE":
            share = (
                (c_amount / total_expenses) * Decimal("100")
                if total_expenses > Decimal("0.00")
                else Decimal("0.00")
            )
            pct_str = f"{share.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):.2f}"
            expense_breakdown.append(
                CategoryBreakdownResponse(
                    category_id=c_id,
                    category_name=c_name,
                    category_color=c_color,
                    total_amount=f"{c_amount:.2f}",
                    count=c_cnt,
                    percentage=pct_str,
                )
            )

    # 5. Query workspace-wide cumulative net movement through end_date (ALWAYS ignores category_id)
    cum_stmt = select(
        func.coalesce(
            func.sum(
                case(
                    (Transaction.type == "INCOME", Transaction.amount),
                    else_=-Transaction.amount,
                )
            ),
            Decimal("0.00"),
        )
    ).where(
        Transaction.business_id == business_id,
        Transaction.deleted_at.is_(None),
        Transaction.transaction_date <= effective_end_date,
    )
    cum_result = db.scalar(cum_stmt)
    cumulative_net_movement = Decimal(str(cum_result)) if cum_result is not None else Decimal("0.00")

    return FinancialSummaryResponse(
        period=FinancialSummaryPeriod(
            start_date=effective_start_date,
            end_date=effective_end_date,
        ),
        currency=currency,
        total_income=f"{total_income:.2f}",
        total_expenses=f"{total_expenses:.2f}",
        net_cash_flow=f"{net_cash_flow:.2f}",
        transaction_count=total_count,
        cumulative_net_movement=f"{cumulative_net_movement:.2f}",
        income_by_category=income_breakdown,
        expenses_by_category=expense_breakdown,
    )
