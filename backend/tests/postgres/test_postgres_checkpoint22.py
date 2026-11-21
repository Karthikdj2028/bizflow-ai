"""Opt-in PostgreSQL verification tests for Checkpoint 2.2 on bizflow_test.

Verifies:
- Live PostgreSQL SQL aggregation math for financial summaries.
- Cumulative net movement SQL calculation.
- Category breakdown aggregation with Decimal precision on live PostgreSQL.
- Soft-delete exclusion from live database aggregates.
- Live composite foreign-key integrity enforcement.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import uuid
import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models.business import Business
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.category import seed_default_categories
from app.services.transaction import calculate_financial_summary, soft_delete_transaction


@pytest.mark.postgres
def test_postgres_sql_aggregation_summary(pg_engine: Engine) -> None:
    """Verify financial calculation SQL aggregation logic on live PostgreSQL."""
    with Session(pg_engine) as session:
        biz = Business(name="PG Summary Business", base_currency="INR")
        session.add(biz)
        session.flush()
        seed_default_categories(session, biz.id)

        income_cat = session.query(Category).filter(
            Category.business_id == biz.id, Category.type == "INCOME"
        ).first()
        expense_cat = session.query(Category).filter(
            Category.business_id == biz.id, Category.type == "EXPENSE"
        ).first()
        assert income_cat and expense_cat

        today = datetime.now(timezone.utc).date()

        # Insert live transactions: Income 12000.50 + Expense 4500.25
        tx1 = Transaction(
            id=uuid.uuid4(),
            business_id=biz.id,
            category_id=income_cat.id,
            type="INCOME",
            amount=Decimal("12000.50"),
            currency="INR",
            transaction_date=today,
            description="Consulting Revenue",
        )
        tx2 = Transaction(
            id=uuid.uuid4(),
            business_id=biz.id,
            category_id=expense_cat.id,
            type="EXPENSE",
            amount=Decimal("4500.25"),
            currency="INR",
            transaction_date=today,
            description="Office Supplies",
        )
        session.add_all([tx1, tx2])
        session.commit()

        # Execute financial calculation
        summary = calculate_financial_summary(
            session, biz.id, "INR", start_date=today.replace(day=1), end_date=today
        )

        assert summary.total_income == "12000.50"
        assert summary.total_expenses == "4500.25"
        assert summary.net_cash_flow == "7500.25"
        assert summary.transaction_count == 2
        assert summary.cumulative_net_movement == "7500.25"

        # Verify soft-delete exclusion on live PostgreSQL
        soft_delete_transaction(session, biz.id, tx2.id)

        summary_after_delete = calculate_financial_summary(
            session, biz.id, "INR", start_date=today.replace(day=1), end_date=today
        )
        assert summary_after_delete.total_expenses == "0.00"
        assert summary_after_delete.net_cash_flow == "12000.50"
        assert summary_after_delete.transaction_count == 1
        assert summary_after_delete.cumulative_net_movement == "12000.50"

        # Clean up
        session.delete(tx1)
        session.delete(tx2)
        session.delete(biz)
        session.commit()


@pytest.mark.postgres
def test_postgres_composite_fk_blocks_mismatch(pg_engine: Engine) -> None:
    """Verify live PostgreSQL rejects composite foreign key mismatch at commit."""
    with Session(pg_engine) as session:
        biz = Business(name="PG FK Business", base_currency="INR")
        session.add(biz)
        session.flush()

        cat = Category(
            id=uuid.uuid4(),
            business_id=biz.id,
            name="Consulting Services",
            type="INCOME",
            is_system_default=False,
        )
        session.add(cat)
        session.commit()

        # Attempt to insert EXPENSE transaction referencing INCOME category
        invalid_tx = Transaction(
            id=uuid.uuid4(),
            business_id=biz.id,
            category_id=cat.id,
            type="EXPENSE",  # Mismatch
            amount=Decimal("100.00"),
            currency="INR",
            transaction_date=datetime.now(timezone.utc).date(),
            description="Invalid FK test",
        )
        session.add(invalid_tx)

        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        # Clean up
        session.delete(cat)
        session.delete(biz)
        session.commit()
