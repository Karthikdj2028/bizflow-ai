"""Customer database model for accounts receivable and client management."""

from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.business import Business


class Customer(Base):
    """Customer profile entity owned by a single business workspace."""

    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    email: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    phone: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    billing_address: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    payment_terms_days: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=30,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
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
        back_populates="customers",
    )

    __table_args__ = (
        CheckConstraint(
            "payment_terms_days >= 0",
            name="chk_customers_payment_terms",
        ),
        CheckConstraint(
            "length(trim(name)) > 0",
            name="chk_customers_name_not_empty",
        ),
        Index("idx_customers_biz_name", "business_id", "name"),
        Index("idx_customers_biz_active", "business_id", "is_active"),
        Index("idx_customers_biz_created", "business_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Customer id={self.id} business_id={self.business_id} name={self.name} is_active={self.is_active}>"
