"""Unit tests for demo transaction data seeder.

Verifies:
- Exact 50 demo transactions per category (450 total across 9 categories).
- Repeatability and strict idempotency (zero duplicates on multiple runs).
- Multi-tenant business data isolation between workspaces.
- Decimal precision, positivity, and valid payment methods.
- Full bootstrapping of demo user and workspace.
"""

from datetime import datetime, timezone
from decimal import Decimal
import uuid
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.business import Business
from app.models.category import Category
from app.models.membership import BusinessMembership
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import SUPPORTED_PAYMENT_METHODS
from app.services.category import DEFAULT_CATEGORIES
from app.services.demo_data import (
    CATEGORY_CODES,
    seed_demo_transactions,
    seed_demo_workspace_and_data,
)


@pytest.fixture
def test_business(db: Session) -> Business:
    """Fixture to create a test business workspace."""
    biz = Business(
        id=uuid.uuid4(),
        name="Alpha Corp Test Workspace",
        base_currency="USD",
    )
    db.add(biz)
    db.commit()
    return biz


@pytest.fixture
def second_business(db: Session) -> Business:
    """Fixture to create a second business workspace for tenancy tests."""
    biz = Business(
        id=uuid.uuid4(),
        name="Beta Logistics Test Workspace",
        base_currency="EUR",
    )
    db.add(biz)
    db.commit()
    return biz


def test_seed_demo_transactions_creates_exact_counts(db: Session, test_business: Business):
    """Verify that exactly 50 demo transactions are created for each of the 9 categories (450 total)."""
    res = seed_demo_transactions(db, test_business.id, target_per_category=50)

    assert res["categories_found"] == 9
    assert res["transactions_created"] == 450
    assert res["total_demo_transactions"] == 450

    # Verify per-category database row counts
    categories = db.scalars(
        select(Category).where(Category.business_id == test_business.id)
    ).all()
    assert len(categories) == 9

    total_db_count = 0
    for cat in categories:
        count = db.scalar(
            select(func.count(Transaction.id)).where(
                Transaction.business_id == test_business.id,
                Transaction.category_id == cat.id,
                Transaction.deleted_at.is_(None),
            )
        )
        assert count == 50, f"Category '{cat.name}' expected 50 transactions, got {count}"
        total_db_count += count

    assert total_db_count == 450


def test_seed_demo_transactions_is_idempotent_and_repeatable(db: Session, test_business: Business):
    """Verify that running seeder repeatedly does not produce duplicate transactions."""
    # Run 1: Initial seed
    res1 = seed_demo_transactions(db, test_business.id, target_per_category=50)
    assert res1["transactions_created"] == 450
    assert res1["total_demo_transactions"] == 450

    # Run 2: Immediately re-run on same workspace
    res2 = seed_demo_transactions(db, test_business.id, target_per_category=50)
    assert res2["transactions_created"] == 0
    assert res2["total_demo_transactions"] == 450

    # Run 3: Third re-run to confirm stability
    res3 = seed_demo_transactions(db, test_business.id, target_per_category=50)
    assert res3["transactions_created"] == 0
    assert res3["total_demo_transactions"] == 450

    # Final DB count check
    total_in_db = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.business_id == test_business.id,
            Transaction.deleted_at.is_(None),
        )
    )
    assert total_in_db == 450


def test_seed_demo_transactions_multi_tenant_isolation(
    db: Session, test_business: Business, second_business: Business
):
    """Verify strict multi-tenant isolation: seeding Workspace A does not contaminate Workspace B."""
    # Seed Workspace A only
    res_a = seed_demo_transactions(db, test_business.id, target_per_category=50)
    assert res_a["transactions_created"] == 450

    # Workspace B must have 0 transactions
    count_b_initial = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.business_id == second_business.id
        )
    )
    assert count_b_initial == 0

    # Now seed Workspace B
    res_b = seed_demo_transactions(db, second_business.id, target_per_category=50)
    assert res_b["transactions_created"] == 450

    # Both workspaces have exactly 450, completely isolated
    count_a = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.business_id == test_business.id
        )
    )
    count_b = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.business_id == second_business.id
        )
    )
    assert count_a == 450
    assert count_b == 450

    # Total in DB is 900 across both workspaces
    total = db.scalar(select(func.count(Transaction.id)))
    assert total == 900


def test_seed_demo_transactions_financial_integrity_and_validity(
    db: Session, test_business: Business
):
    """Verify that all generated transactions meet strict financial standards and domain rules."""
    seed_demo_transactions(db, test_business.id, target_per_category=50)

    txs = db.scalars(
        select(Transaction).where(Transaction.business_id == test_business.id)
    ).all()
    assert len(txs) == 450

    today = datetime.now(timezone.utc).date()

    for tx in txs:
        # Amount checks
        assert isinstance(tx.amount, Decimal), "Amount must be stored as Decimal"
        assert tx.amount > Decimal("0.00"), "Amount must be strictly positive"
        assert tx.amount == tx.amount.quantize(Decimal("0.01")), "Must have at most 2 decimal places"

        # Date checks
        assert tx.transaction_date <= today, "Transaction date cannot be in the future"

        # Type checks
        assert tx.type in ("INCOME", "EXPENSE"), "Type must be INCOME or EXPENSE"
        assert tx.category.type == tx.type, "Transaction type must match category type"

        # Currency and payment method
        assert tx.currency == test_business.base_currency
        assert tx.payment_method in SUPPORTED_PAYMENT_METHODS

        # Description and reference
        assert tx.description.startswith("[Demo]")
        assert tx.reference_number.startswith("DEMO-")
        assert len(tx.counterparty) > 0


def test_seed_demo_workspace_and_data_bootstraps_new_environment(db: Session):
    """Verify that seed_demo_workspace_and_data creates user, workspace, and demo data from scratch."""
    user, biz, res = seed_demo_workspace_and_data(
        db,
        email="fresh_demo@bizflow.ai",
        business_name="Fresh Demo Enterprise",
        currency="USD",
    )

    assert user.email == "fresh_demo@bizflow.ai"
    assert biz.name == "Fresh Demo Enterprise"
    assert res["transactions_created"] == 450

    # Verify membership
    membership = db.scalar(
        select(BusinessMembership).where(
            BusinessMembership.user_id == user.id,
            BusinessMembership.business_id == biz.id,
        )
    )
    assert membership is not None
    assert membership.role == "OWNER"

    # Idempotent re-run on fresh_demo
    user2, biz2, res2 = seed_demo_workspace_and_data(
        db,
        email="fresh_demo@bizflow.ai",
        business_name="Fresh Demo Enterprise",
        currency="USD",
    )
    assert user2.id == user.id
    assert biz2.id == biz.id
    assert res2["transactions_created"] == 0
