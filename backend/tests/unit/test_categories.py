"""Unit tests for category domain service and seeding logic."""

import uuid
from datetime import date
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, ConflictError, EntityNotFoundError
from app.models.business import Business
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.category import CategoryCreateRequest, CategoryUpdateRequest
from app.services.category import (
    DEFAULT_CATEGORIES,
    create_category,
    delete_category,
    get_categories_for_workspace,
    seed_default_categories,
    update_category,
)


@pytest.fixture
def test_business(db: Session) -> Business:
    """Create a persistent business entity for testing."""
    biz = Business(name="Test Financial Corp", base_currency="INR")
    db.add(biz)
    db.commit()
    db.refresh(biz)
    return biz


def test_seed_default_categories_creates_9_defaults(db: Session, test_business: Business):
    """Verify seed_default_categories creates exactly 9 standard categories (3 Income, 6 Expense)."""
    seeded = seed_default_categories(db, test_business.id)
    assert len(seeded) == 9

    income_cats = [c for c in seeded if c.type == "INCOME"]
    expense_cats = [c for c in seeded if c.type == "EXPENSE"]
    assert len(income_cats) == 3
    assert len(expense_cats) == 6
    assert all(c.is_system_default is True for c in seeded)
    assert all(c.business_id == test_business.id for c in seeded)


def test_seed_default_categories_idempotency(db: Session, test_business: Business):
    """Verify running seed_default_categories multiple times creates zero duplicate rows."""
    first_run = seed_default_categories(db, test_business.id)
    assert len(first_run) == 9

    # Re-running must be completely conflict-safe and idempotent
    second_run = seed_default_categories(db, test_business.id)
    assert len(second_run) == 9

    all_cats = db.query(Category).filter(Category.business_id == test_business.id).all()
    assert len(all_cats) == 9


def test_case_insensitive_category_uniqueness(db: Session, test_business: Business):
    """Verify duplicate category names within same workspace and type are rejected case-insensitively."""
    seed_default_categories(db, test_business.id)

    # "Software & Subscriptions" exists as default EXPENSE category
    req = CategoryCreateRequest(
        name="software & subscriptions",  # lowercase duplicate
        type="EXPENSE",
        color_hex="#123456",
    )
    with pytest.raises(ConflictError) as exc_info:
        create_category(db, test_business.id, req)
    assert exc_info.value.code == "CATEGORY_ALREADY_EXISTS"


def test_category_same_name_different_type_permitted(db: Session, test_business: Business):
    """Verify identical category names are allowed if category types differ."""
    req_income = CategoryCreateRequest(
        name="Special Fees",
        type="INCOME",
        color_hex="#112233",
    )
    cat_inc = create_category(db, test_business.id, req_income)
    assert cat_inc.id is not None

    req_expense = CategoryCreateRequest(
        name="Special Fees",
        type="EXPENSE",
        color_hex="#445566",
    )
    cat_exp = create_category(db, test_business.id, req_expense)
    assert cat_exp.id is not None
    assert cat_exp.id != cat_inc.id


def test_system_default_category_cannot_be_deleted(db: Session, test_business: Business):
    """Verify system default categories cannot be deleted under any circumstances."""
    seeded = seed_default_categories(db, test_business.id)
    default_cat = seeded[0]

    with pytest.raises(ConflictError) as exc_info:
        delete_category(db, test_business.id, default_cat.id)
    assert exc_info.value.code == "CANNOT_DELETE_SYSTEM_CATEGORY"


def test_category_in_use_cannot_be_deleted(db: Session, test_business: Business):
    """Verify custom categories referenced by any transaction (active or soft-deleted) cannot be deleted."""
    req = CategoryCreateRequest(name="Equipment Rental", type="EXPENSE", color_hex="#AABBCC")
    cat = create_category(db, test_business.id, req)

    # Create active transaction referencing category
    tx = Transaction(
        business_id=test_business.id,
        category_id=cat.id,
        type="EXPENSE",
        amount=Decimal("250.00"),
        currency="INR",
        transaction_date=date(2026, 11, 21),
        description="Forklift rental",
    )
    db.add(tx)
    db.commit()

    with pytest.raises(ConflictError) as exc_info:
        delete_category(db, test_business.id, cat.id)
    assert exc_info.value.code == "CATEGORY_IN_USE"

    # Soft-delete the transaction: deletion of category must STILL be blocked
    tx.deleted_at = tx.created_at
    db.commit()

    with pytest.raises(ConflictError) as exc_info:
        delete_category(db, test_business.id, cat.id)
    assert exc_info.value.code == "CATEGORY_IN_USE"


def test_update_category_success_and_duplicate_rejection(db: Session, test_business: Business):
    """Verify category updating and duplicate conflict detection during update."""
    cat1 = create_category(db, test_business.id, CategoryCreateRequest(name="Tools", type="EXPENSE"))
    cat2 = create_category(db, test_business.id, CategoryCreateRequest(name="Hardware", type="EXPENSE"))

    # Successful update
    updated = update_category(
        db, test_business.id, cat1.id,
        CategoryUpdateRequest(description="Hand tools", color_hex="#00FF00")
    )
    assert updated.description == "Hand tools"
    assert updated.color_hex == "#00FF00"

    # Duplicate name update conflict
    with pytest.raises(ConflictError) as exc_info:
        update_category(
            db, test_business.id, cat1.id,
            CategoryUpdateRequest(name="hardware")  # Conflicts with cat2
        )
    assert exc_info.value.code == "CATEGORY_ALREADY_EXISTS"


def test_get_categories_for_workspace_filtering(db: Session, test_business: Business):
    """Verify get_categories_for_workspace returns all categories or filters by type."""
    seed_default_categories(db, test_business.id)

    all_cats = get_categories_for_workspace(db, test_business.id)
    assert len(all_cats) == 9

    income_cats = get_categories_for_workspace(db, test_business.id, type_filter="INCOME")
    assert len(income_cats) == 3

    expense_cats = get_categories_for_workspace(db, test_business.id, type_filter="EXPENSE")
    assert len(expense_cats) == 6

    with pytest.raises(BadRequestError):
        get_categories_for_workspace(db, test_business.id, type_filter="INVALID")


def test_unsupported_dialect_fails_explicitly(monkeypatch: pytest.MonkeyPatch, db: Session, test_business: Business):
    """Verify conflict-safe seeder raises explicit NotImplementedError on unsupported dialects."""
    class DummyDialect:
        name = "unsupported_db"

    class DummyBind:
        dialect = DummyDialect()

    monkeypatch.setattr(db, "get_bind", lambda: DummyBind())

    with pytest.raises(NotImplementedError, match="Unsupported database dialect"):
        seed_default_categories(db, test_business.id)
