"""Unit tests for transaction ledger domain service, financial calculations, and validation."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import uuid
import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, EntityNotFoundError, ValidationError as DomainValidationError
from app.models.business import Business
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.transaction import (
    TransactionCreateRequest,
    TransactionUpdateRequest,
    validate_monetary_amount,
)
from app.services.category import seed_default_categories
from app.services.transaction import (
    calculate_financial_summary,
    create_transaction,
    escape_sql_wildcards,
    get_transaction,
    list_transactions,
    soft_delete_transaction,
    update_transaction,
)


@pytest.fixture
def test_business(db: Session) -> Business:
    """Create a persistent business entity for unit testing."""
    biz = Business(name="Ledger Test Corp", base_currency="INR")
    db.add(biz)
    db.commit()
    db.refresh(biz)
    seed_default_categories(db, biz.id)
    return biz


def test_decimal_amount_string_only():
    """Verify that monetary amounts must be provided as strings and numeric types are rejected."""
    # Floating-point rejected
    with pytest.raises(ValidationError) as exc_info:
        TransactionCreateRequest(
            type="EXPENSE",
            amount=1250.50,  # type: ignore[arg-type]
            category_id=uuid.uuid4(),
            transaction_date=date.today(),
            description="Cloud servers",
        )
    assert "Amount must be provided as a string" in str(exc_info.value)

    # Integer rejected
    with pytest.raises(ValidationError) as exc_info:
        TransactionCreateRequest(
            type="EXPENSE",
            amount=1000,  # type: ignore[arg-type]
            category_id=uuid.uuid4(),
            transaction_date=date.today(),
            description="Office rent",
        )
    assert "Amount must be provided as a string" in str(exc_info.value)


def test_decimal_amount_regex_precision():
    """Verify rejection of more than 2 decimal places, invalid characters, and multiple leading zeroes."""
    # 3 decimal places rejected
    with pytest.raises(ValueError, match="at most 2 decimal places"):
        validate_monetary_amount("100.555")

    # Invalid characters rejected
    with pytest.raises(ValueError, match="at most 2 decimal places"):
        validate_monetary_amount("$100.00")

    # Multiple leading zeroes rejected
    with pytest.raises(ValueError, match="multiple leading zeroes"):
        validate_monetary_amount("007.50")

    # Exponent notation rejected
    with pytest.raises(ValueError, match="at most 2 decimal places"):
        validate_monetary_amount("1e5")

    # Valid string amounts
    assert validate_monetary_amount("100") == Decimal("100.00")
    assert validate_monetary_amount("100.5") == Decimal("100.50")
    assert validate_monetary_amount("100.50") == Decimal("100.50")


def test_decimal_amount_positivity():
    """Verify that zero and negative amounts are strictly rejected."""
    with pytest.raises(ValueError, match="strictly positive"):
        validate_monetary_amount("0")

    with pytest.raises(ValueError, match="strictly positive"):
        validate_monetary_amount("0.00")

    with pytest.raises(ValueError, match="at most 2 decimal places"):
        validate_monetary_amount("-50.00")


def test_decimal_amount_numeric15_2_maximum():
    """Verify enforcement of PostgreSQL NUMERIC(15,2) maximum boundary (9999999999999.99)."""
    # Max value accepted
    max_val = validate_monetary_amount("9999999999999.99")
    assert max_val == Decimal("9999999999999.99")

    # Exceeding max value rejected
    with pytest.raises(ValueError, match="exceeds maximum supported limit"):
        validate_monetary_amount("10000000000000.00")


def test_future_date_rejected_utc_comparison():
    """Verify that future dates beyond the current UTC calendar date are rejected."""
    future_date = datetime.now(timezone.utc).date() + timedelta(days=1)
    with pytest.raises(ValidationError) as exc_info:
        TransactionCreateRequest(
            type="EXPENSE",
            amount="500.00",
            category_id=uuid.uuid4(),
            transaction_date=future_date,
            description="Future Expense",
        )
    assert "Transaction date cannot be in the future" in str(exc_info.value)


def test_create_request_extra_fields_forbidden():
    """Verify that TransactionCreateRequest rejects unexpected extra payload keys."""
    with pytest.raises(ValidationError) as exc_info:
        TransactionCreateRequest(
            type="INCOME",
            amount="2500.00",
            category_id=uuid.uuid4(),
            transaction_date=datetime.now(timezone.utc).date(),
            description="Client invoice",
            extra_field="malicious",  # type: ignore[call-arg]
        )
    assert "Extra inputs are not permitted" in str(exc_info.value)


def test_create_request_prohibits_currency_and_business_id():
    """Verify that client-supplied currency and business_id are rejected in creation payloads."""
    with pytest.raises(ValidationError) as exc_info:
        TransactionCreateRequest(
            type="INCOME",
            amount="2500.00",
            category_id=uuid.uuid4(),
            transaction_date=datetime.now(timezone.utc).date(),
            description="Client invoice",
            currency="USD",  # type: ignore[call-arg]
        )
    assert "Extra inputs are not permitted" in str(exc_info.value)

    with pytest.raises(ValidationError) as exc_info:
        TransactionCreateRequest(
            type="INCOME",
            amount="2500.00",
            category_id=uuid.uuid4(),
            transaction_date=datetime.now(timezone.utc).date(),
            description="Client invoice",
            business_id=uuid.uuid4(),  # type: ignore[call-arg]
        )
    assert "Extra inputs are not permitted" in str(exc_info.value)


def test_update_request_prohibits_type_field():
    """Verify that TransactionUpdateRequest strictly rejects type mutations."""
    with pytest.raises(ValidationError) as exc_info:
        TransactionUpdateRequest.model_validate({"type": "INCOME", "amount": "200.00"})
    assert "Transaction type is immutable" in str(exc_info.value)


def test_patch_empty_body_rejected(db: Session, test_business: Business):
    """Verify that an empty PATCH request payload ({}) is rejected with BadRequestError and EMPTY_UPDATE_PAYLOAD."""
    cat = db.query(Category).filter(
        Category.business_id == test_business.id,
        Category.type == "INCOME",
    ).first()
    assert cat is not None
    tx = create_transaction(
        db,
        test_business.id,
        test_business.base_currency,
        TransactionCreateRequest(
            type="INCOME",
            amount="100.00",
            category_id=cat.id,
            transaction_date=datetime.now(timezone.utc).date(),
            description="Test initial",
        ),
    )
    with pytest.raises(BadRequestError) as exc_info:
        update_transaction(db, test_business.id, tx.id, TransactionUpdateRequest())
    assert exc_info.value.code == "EMPTY_UPDATE_PAYLOAD"
    assert exc_info.value.status_code == 400


def test_summary_future_end_date_rejected_validation_error(db: Session, test_business: Business):
    """Verify that calculating summary with future end_date raises DomainValidationError (HTTP 422)."""
    future_date = datetime.now(timezone.utc).date() + timedelta(days=2)
    with pytest.raises(DomainValidationError) as exc_info:
        calculate_financial_summary(
            db,
            test_business.id,
            test_business.base_currency,
            end_date=future_date,
        )
    assert exc_info.value.code == "FUTURE_END_DATE_NOT_PERMITTED"
    assert exc_info.value.status_code == 422


def test_patch_disallow_null_on_non_nullable_fields():
    """Verify explicit null on non-nullable fields is rejected while allowed on nullable fields."""
    # amount cannot be null
    with pytest.raises(ValidationError) as exc_info:
        TransactionUpdateRequest.model_validate({"amount": None})
    assert "Field 'amount' cannot be null" in str(exc_info.value)

    # description cannot be null
    with pytest.raises(ValidationError) as exc_info:
        TransactionUpdateRequest.model_validate({"description": None})
    assert "Field 'description' cannot be null" in str(exc_info.value)

    # counterparty and reference_number CAN be null
    req = TransactionUpdateRequest.model_validate({"counterparty": None, "reference_number": None})
    assert req.counterparty is None
    assert req.reference_number is None


def test_category_type_mismatch_rejected(db: Session, test_business: Business):
    """Verify creating a transaction with mismatched category type raises BadRequestError."""
    # Retrieve an INCOME category
    income_cat = db.query(Category).filter(
        Category.business_id == test_business.id,
        Category.type == "INCOME",
    ).first()
    assert income_cat is not None

    # Attempt to create an EXPENSE transaction pointing to INCOME category
    req = TransactionCreateRequest(
        type="EXPENSE",
        amount="1500.00",
        category_id=income_cat.id,
        transaction_date=datetime.now(timezone.utc).date(),
        description="Mismatched type test",
    )
    with pytest.raises(BadRequestError) as exc_info:
        create_transaction(db, test_business.id, test_business.base_currency, req)
    assert exc_info.value.code == "CATEGORY_TYPE_MISMATCH"


def test_soft_deleted_transaction_excluded_from_queries(db: Session, test_business: Business):
    """Verify that soft-deleted transactions are excluded from get, list, update, and delete."""
    cat = db.query(Category).filter(
        Category.business_id == test_business.id,
        Category.type == "EXPENSE",
    ).first()
    assert cat is not None

    req = TransactionCreateRequest(
        type="EXPENSE",
        amount="3000.00",
        category_id=cat.id,
        transaction_date=datetime.now(timezone.utc).date(),
        description="To be deleted",
    )
    tx = create_transaction(db, test_business.id, test_business.base_currency, req)

    # Soft-delete the transaction
    soft_delete_transaction(db, test_business.id, tx.id)

    # get_transaction raises 404
    with pytest.raises(EntityNotFoundError):
        get_transaction(db, test_business.id, tx.id)

    # list_transactions excludes it
    items, count = list_transactions(db, test_business.id)
    assert tx.id not in [item.id for item in items]
    assert count == 0

    # update_transaction raises 404
    with pytest.raises(EntityNotFoundError):
        update_transaction(
            db,
            test_business.id,
            tx.id,
            TransactionUpdateRequest(description="New Desc"),
        )

    # repeating soft_delete raises 404
    with pytest.raises(EntityNotFoundError):
        soft_delete_transaction(db, test_business.id, tx.id)


def test_financial_calculation_math(db: Session, test_business: Business):
    """Verify exact Decimal aggregation for income, expenses, net cash flow, and percentages."""
    income_cat = db.query(Category).filter(
        Category.business_id == test_business.id, Category.type == "INCOME"
    ).first()
    expense_cat = db.query(Category).filter(
        Category.business_id == test_business.id, Category.type == "EXPENSE"
    ).first()
    assert income_cat and expense_cat

    today = datetime.now(timezone.utc).date()

    # Create 2 income transactions: 7000.00 + 3000.00 = 10000.00
    create_transaction(
        db, test_business.id, test_business.base_currency,
        TransactionCreateRequest(
            type="INCOME", amount="7000.00", category_id=income_cat.id,
            transaction_date=today, description="Income 1"
        )
    )
    create_transaction(
        db, test_business.id, test_business.base_currency,
        TransactionCreateRequest(
            type="INCOME", amount="3000.00", category_id=income_cat.id,
            transaction_date=today, description="Income 2"
        )
    )

    # Create 1 expense transaction: 2500.50
    create_transaction(
        db, test_business.id, test_business.base_currency,
        TransactionCreateRequest(
            type="EXPENSE", amount="2500.50", category_id=expense_cat.id,
            transaction_date=today, description="Expense 1"
        )
    )

    summary = calculate_financial_summary(
        db, test_business.id, test_business.base_currency,
        start_date=today.replace(day=1), end_date=today
    )

    assert summary.total_income == "10000.00"
    assert summary.total_expenses == "2500.50"
    assert summary.net_cash_flow == "7499.50"
    assert summary.transaction_count == 3
    assert summary.cumulative_net_movement == "7499.50"
    assert len(summary.income_by_category) == 1
    assert summary.income_by_category[0].percentage == "100.00"
    assert summary.expenses_by_category[0].percentage == "100.00"


def test_search_wildcard_escaping():
    """Verify that SQL wildcard characters (%, _, \\) are escaped properly."""
    escaped = escape_sql_wildcards("100%_growth\\gain")
    assert escaped == "100\\%\\_growth\\\\gain"


def test_summary_percentage_decimal_quantization(db: Session, test_business: Business):
    """Verify category percentages use Decimal arithmetic, ROUND_HALF_UP, and fixed-point strings."""
    income_cats = db.query(Category).filter(
        Category.business_id == test_business.id, Category.type == "INCOME"
    ).all()
    assert len(income_cats) >= 2
    cat1, cat2 = income_cats[0], income_cats[1]

    today = datetime.now(timezone.utc).date()

    # Tx 1: 100.00
    create_transaction(
        db, test_business.id, test_business.base_currency,
        TransactionCreateRequest(
            type="INCOME", amount="100.00", category_id=cat1.id,
            transaction_date=today, description="Share 1"
        )
    )
    # Tx 2: 200.00
    create_transaction(
        db, test_business.id, test_business.base_currency,
        TransactionCreateRequest(
            type="INCOME", amount="200.00", category_id=cat2.id,
            transaction_date=today, description="Share 2"
        )
    )

    # Total = 300.00
    # cat1 share = 100 / 300 = 33.3333...% -> "33.33"
    # cat2 share = 200 / 300 = 66.6666...% -> "66.67"
    summary = calculate_financial_summary(
        db, test_business.id, test_business.base_currency,
        start_date=today.replace(day=1), end_date=today
    )

    percentages = {item.category_id: item.percentage for item in summary.income_by_category}
    assert percentages[cat1.id] == "33.33"
    assert percentages[cat2.id] == "66.67"
