"""Transaction database model for income and expense ledgers."""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional, TYPE_CHECKING
from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.category import Category


class Transaction(Base):
    """Financial transaction ledger record belonging to a business workspace."""

    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        nullable=False,
    )
    currency: Mapped[str] = mapped_column(
        String(3),
        nullable=False,
    )
    transaction_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    counterparty: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    reference_number: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    payment_method: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="OTHER",
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    business: Mapped["Business"] = relationship(
        "Business",
        overlaps="category,transactions",
    )
    category: Mapped["Category"] = relationship(
        "Category",
        back_populates="transactions",
        foreign_keys="[Transaction.business_id, Transaction.category_id, Transaction.type]",
        overlaps="business,transactions",
    )

    __table_args__ = (
        # Composite foreign key enforcing tenant, category existence, and category type matching
        # with DEFERRABLE INITIALLY DEFERRED to permit clean business deletion cascades in PostgreSQL
        ForeignKeyConstraint(
            ["business_id", "category_id", "type"],
            ["categories.business_id", "categories.id", "categories.type"],
            name="fk_transactions_categories_composite",
            ondelete="NO ACTION",
            deferrable=True,
            initially="DEFERRED",
        ),
        # Type domain check constraint
        CheckConstraint(
            "type IN ('INCOME', 'EXPENSE')",
            name="chk_transactions_type",
        ),
        # Monetary positivity constraint
        CheckConstraint(
            "amount > 0",
            name="chk_transactions_amount_positive",
        ),
        # Currency code length check constraint
        CheckConstraint(
            "length(currency) = 3",
            name="chk_transactions_currency_length",
        ),
        # Payment method domain check constraint
        CheckConstraint(
            "payment_method IN ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'OTHER')",
            name="chk_transactions_payment_method",
        ),
        # Partial operational index for active transactions (excludes soft-deleted)
        Index(
            "idx_tx_active_biz_date",
            "business_id",
            "transaction_date",
            "created_at",
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
        # Category lookup index
        Index(
            "idx_tx_active_biz_category",
            "business_id",
            "category_id",
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )
