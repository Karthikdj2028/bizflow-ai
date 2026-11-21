"""Opt-in PostgreSQL verification tests for Checkpoint 2.1.

Verifies:
- Migration 0002 applied and schema presence (categories, transactions).
- Case-insensitive functional unique index on (business_id, type, lower(name)).
- Composite FK rejecting cross-tenant category assignment.
- Composite FK rejecting category/transaction type mismatch.
- Deferred category deletion restriction firing on commit.
- Business deletion cascading successfully to categories and transactions.
- Disposable database downgrade to 0001 and re-upgrade to head on bizflow_test.
"""

from decimal import Decimal
from datetime import date
from pathlib import Path
import pytest
from sqlalchemy import create_engine, Engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from alembic.config import Config
from alembic import command

from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership
from app.models.category import Category
from app.models.transaction import Transaction


@pytest.mark.postgres
def test_migration_0002_applied_and_tables_exist(pg_engine: Engine) -> None:
    """Verify migration 0002 is applied and financial core tables exist in bizflow_test."""
    inspector = inspect(pg_engine)
    table_names = set(inspector.get_table_names())
    assert "categories" in table_names
    assert "transactions" in table_names

    with pg_engine.connect() as conn:
        current_rev = conn.execute(text("SELECT version_num FROM alembic_version;")).scalar()
        assert current_rev == "0002_financial_management_core"


@pytest.mark.postgres
def test_case_insensitive_unique_category_index(pg_engine: Engine) -> None:
    """Verify PostgreSQL case-insensitive functional unique index rejects duplicate names."""
    with Session(pg_engine) as session:
        biz = Business(name="CI Index Test Business", base_currency="INR")
        session.add(biz)
        session.flush()

        cat1 = Category(
            business_id=biz.id,
            name="Office Supplies",
            type="EXPENSE",
            is_system_default=False,
        )
        session.add(cat1)
        session.commit()

        # Attempt to insert case-insensitive duplicate in the same business and type
        cat2 = Category(
            business_id=biz.id,
            name="office supplies",
            type="EXPENSE",
            is_system_default=False,
        )
        session.add(cat2)
        with pytest.raises(IntegrityError) as exc_info:
            session.commit()
        session.rollback()

        # Check constraint/index name in error
        assert "uq_categories_biz_type_lower_name" in str(exc_info.value).lower() or "unique" in str(exc_info.value).lower()

        # Clean up
        session.delete(cat1)
        session.delete(biz)
        session.commit()


@pytest.mark.postgres
def test_composite_fk_rejects_cross_tenant_category(pg_engine: Engine) -> None:
    """Verify composite FK prevents assigning a category owned by another business."""
    with Session(pg_engine) as session:
        biz_a = Business(name="Business A", base_currency="INR")
        biz_b = Business(name="Business B", base_currency="INR")
        session.add_all([biz_a, biz_b])
        session.flush()

        cat_a = Category(
            business_id=biz_a.id,
            name="Consulting",
            type="INCOME",
            is_system_default=False,
        )
        session.add(cat_a)
        session.commit()

        # Transaction in Business B referencing Category from Business A
        txn_b = Transaction(
            business_id=biz_b.id,
            category_id=cat_a.id,
            type="INCOME",
            amount=Decimal("1500.00"),
            currency="INR",
            transaction_date=date.today(),
            description="Cross-tenant test",
        )
        session.add(txn_b)

        # Deferred composite FK fires at commit boundary
        with pytest.raises(IntegrityError) as exc_info:
            session.commit()
        session.rollback()

        assert "fk_transactions_categories_composite" in str(exc_info.value) or "foreignkey" in str(exc_info.value).lower() or "violates foreign key constraint" in str(exc_info.value).lower()

        # Clean up
        session.delete(cat_a)
        session.delete(biz_a)
        session.delete(biz_b)
        session.commit()


@pytest.mark.postgres
def test_composite_fk_rejects_type_mismatch(pg_engine: Engine) -> None:
    """Verify composite FK rejects transaction referencing category with different type."""
    with Session(pg_engine) as session:
        biz = Business(name="Type Mismatch Business", base_currency="INR")
        session.add(biz)
        session.flush()

        cat = Category(
            business_id=biz.id,
            name="Software License",
            type="EXPENSE",
            is_system_default=False,
        )
        session.add(cat)
        session.commit()

        # Transaction with type INCOME referencing EXPENSE category
        txn = Transaction(
            business_id=biz.id,
            category_id=cat.id,
            type="INCOME",
            amount=Decimal("500.00"),
            currency="INR",
            transaction_date=date.today(),
            description="Type mismatch test",
        )
        session.add(txn)

        with pytest.raises(IntegrityError) as exc_info:
            session.commit()
        session.rollback()

        assert "fk_transactions_categories_composite" in str(exc_info.value) or "violates foreign key constraint" in str(exc_info.value).lower()

        # Clean up
        session.delete(cat)
        session.delete(biz)
        session.commit()


@pytest.mark.postgres
def test_deferred_category_deletion_restriction(pg_engine: Engine) -> None:
    """Verify deleting a category referenced by a transaction is restricted at commit."""
    with Session(pg_engine) as session:
        biz = Business(name="Category Deletion Guard Business", base_currency="INR")
        session.add(biz)
        session.flush()

        cat = Category(
            business_id=biz.id,
            name="Marketing Campaign",
            type="EXPENSE",
            is_system_default=False,
        )
        session.add(cat)
        session.flush()

        txn = Transaction(
            business_id=biz.id,
            category_id=cat.id,
            type="EXPENSE",
            amount=Decimal("2500.00"),
            currency="INR",
            transaction_date=date.today(),
            description="Marketing spend",
        )
        session.add(txn)
        session.commit()

        # Delete category directly via SQL/session
        session.delete(cat)
        # In PostgreSQL, with DEFERRABLE INITIALLY DEFERRED, flush succeeds:
        session.flush()

        # At commit boundary, PostgreSQL evaluates constraint and rejects
        with pytest.raises(IntegrityError) as exc_info:
            session.commit()
        session.rollback()

        assert "fk_transactions_categories_composite" in str(exc_info.value) or "violates foreign key constraint" in str(exc_info.value).lower()

        # Clean up in correct order: transaction first, then category, then business
        session.delete(txn)
        session.delete(cat)
        session.delete(biz)
        session.commit()


@pytest.mark.postgres
def test_business_deletion_cascades_without_fk_violation(pg_engine: Engine) -> None:
    """Verify deleting a business cascades to categories & transactions without FK violations."""
    with Session(pg_engine) as session:
        biz = Business(name="Cascade Delete Business", base_currency="INR")
        session.add(biz)
        session.flush()

        cat = Category(
            business_id=biz.id,
            name="Equipment",
            type="EXPENSE",
            is_system_default=False,
        )
        session.add(cat)
        session.flush()

        txn = Transaction(
            business_id=biz.id,
            category_id=cat.id,
            type="EXPENSE",
            amount=Decimal("8000.00"),
            currency="INR",
            transaction_date=date.today(),
            description="Office Chairs",
        )
        session.add(txn)
        session.commit()

        # Now delete the business tenant root
        # Because fk_transactions_categories_composite is DEFERRABLE INITIALLY DEFERRED,
        # cascading deletes on both categories and transactions resolve cleanly at commit!
        biz_id = biz.id
        session.delete(biz)
        session.commit()

        # Verify all records for this business were cascaded
        remaining_cats = session.query(Category).filter(Category.business_id == biz_id).count()
        remaining_txns = session.query(Transaction).filter(Transaction.business_id == biz_id).count()
        assert remaining_cats == 0
        assert remaining_txns == 0


@pytest.mark.postgres
def test_disposable_database_downgrade_and_reupgrade(pg_engine: Engine) -> None:
    """Verify Alembic downgrade to 0001 and re-upgrade to head on bizflow_test."""
    import os
    raw_url = os.getenv("TEST_DATABASE_URL", "")
    escaped_url = raw_url.replace("%", "%%")

    backend_dir = Path(__file__).resolve().parent.parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", escaped_url)

    # Downgrade bizflow_test to 0001_initial_core_schema
    command.downgrade(alembic_cfg, "0001_initial_core_schema")

    inspector = inspect(pg_engine)
    tables_after_downgrade = set(inspector.get_table_names())
    assert "categories" not in tables_after_downgrade
    assert "transactions" not in tables_after_downgrade
    assert "users" in tables_after_downgrade
    assert "businesses" in tables_after_downgrade

    with pg_engine.connect() as conn:
        rev_downgraded = conn.execute(text("SELECT version_num FROM alembic_version;")).scalar()
        assert rev_downgraded == "0001_initial_core_schema"

    # Re-upgrade bizflow_test to head
    command.upgrade(alembic_cfg, "head")

    inspector_reupgraded = inspect(pg_engine)
    tables_after_reupgrade = set(inspector_reupgraded.get_table_names())
    assert "categories" in tables_after_reupgrade
    assert "transactions" in tables_after_reupgrade

    with pg_engine.connect() as conn:
        rev_reupgraded = conn.execute(text("SELECT version_num FROM alembic_version;")).scalar()
        assert rev_reupgraded == "0002_financial_management_core"
