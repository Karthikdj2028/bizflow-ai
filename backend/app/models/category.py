"""Category database model for categorized transaction ledgers."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional, TYPE_CHECKING
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.transaction import Transaction


class Category(Base):
    """Chart-of-accounts category entity owned by a single business workspace."""

    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    color_hex: Mapped[str] = mapped_column(
        String(7),
        nullable=False,
        default="#6366F1",
    )
    is_system_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
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
        overlaps="transactions",
    )
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction",
        back_populates="category",
        cascade="none",
        passive_deletes=True,
        foreign_keys="[Transaction.business_id, Transaction.category_id, Transaction.type]",
        overlaps="business,transactions",
    )

    __table_args__ = (
        # Composite unique constraint: target for Transaction composite foreign key
        UniqueConstraint("business_id", "id", "type", name="uq_categories_biz_id_type"),
        # Type domain check constraint
        CheckConstraint("type IN ('INCOME', 'EXPENSE')", name="chk_categories_type"),
        # Portable color hex check constraint
        CheckConstraint(
            "length(color_hex) = 7 AND color_hex LIKE '#%'",
            name="chk_categories_color",
        ),
        # Functional unique index: case-insensitive uniqueness per workspace and type
        Index(
            "uq_categories_biz_type_lower_name",
            "business_id",
            "type",
            func.lower(name),
            unique=True,
        ),
        # Operational query index
        Index(
            "idx_categories_biz_type",
            "business_id",
            "type",
            unique=False,
        ),
    )
