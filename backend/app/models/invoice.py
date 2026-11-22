"""Invoice and InvoiceItem database models for multi-line accounts receivable."""

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional, TYPE_CHECKING
import uuid

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.customer import Customer


class Invoice(Base):
    """Invoice aggregate root entity owned by a workspace."""

    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )
    invoice_number: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        default="DRAFT",
        nullable=False,
    )
    issue_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    due_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    subtotal: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        default=Decimal("0.00"),
        nullable=False,
    )
    tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(7, 4),
        default=Decimal("0.0000"),
        nullable=False,
    )
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        default=Decimal("0.00"),
        nullable=False,
    )
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        default=Decimal("0.00"),
        nullable=False,
    )
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        default=Decimal("0.00"),
        nullable=False,
    )
    paid_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        default=Decimal("0.00"),
        nullable=False,
    )
    balance_due: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        default=Decimal("0.00"),
        nullable=False,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
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
        back_populates="invoices",
        foreign_keys=[business_id],
        overlaps="business,customer,invoices",
    )
    customer: Mapped["Customer"] = relationship(
        "Customer",
        back_populates="invoices",
        foreign_keys="[Invoice.business_id, Invoice.customer_id]",
        overlaps="business,customer,invoices",
    )
    items: Mapped[List["InvoiceItem"]] = relationship(
        "InvoiceItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceItem.created_at.asc(), InvoiceItem.id.asc()",
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id", "customer_id"],
            ["customers.business_id", "customers.id"],
            name="fk_invoices_business_customer",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("business_id", "invoice_number", name="uq_invoices_business_invoice_number"),
        Index("ix_invoices_business_status", "business_id", "status"),
        Index("ix_invoices_business_created", "business_id", "created_at", "id"),
        CheckConstraint("length(trim(invoice_number)) > 0", name="ck_invoices_number_not_empty"),
        CheckConstraint("status IN ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELED')", name="ck_invoices_status"),
        CheckConstraint("due_date >= issue_date", name="ck_invoices_due_date_after_issue"),
        CheckConstraint("subtotal >= 0", name="ck_invoices_subtotal_non_negative"),
        CheckConstraint("tax_rate >= 0.0000 AND tax_rate <= 1.0000", name="ck_invoices_tax_rate_bounds"),
        CheckConstraint("tax_amount >= 0", name="ck_invoices_tax_amount_non_negative"),
        CheckConstraint("discount_amount >= 0", name="ck_invoices_discount_non_negative"),
        CheckConstraint("discount_amount <= subtotal + tax_amount", name="ck_invoices_discount_limit"),
        CheckConstraint("total_amount = subtotal + tax_amount - discount_amount", name="ck_invoices_total_equality"),
        CheckConstraint("paid_amount >= 0", name="ck_invoices_paid_amount_non_negative"),
        CheckConstraint("paid_amount <= total_amount", name="ck_invoices_paid_amount_bounds"),
        CheckConstraint("balance_due = total_amount - paid_amount", name="ck_invoices_balance_due_equality"),
        CheckConstraint(
            "(status = 'DRAFT' AND paid_amount = 0 AND balance_due = total_amount) OR "
            "(status = 'SENT' AND total_amount > 0 AND paid_amount = 0 AND balance_due = total_amount) OR "
            "(status = 'PARTIALLY_PAID' AND total_amount > 0 AND paid_amount > 0 AND paid_amount < total_amount AND balance_due = total_amount - paid_amount) OR "
            "(status = 'PAID' AND total_amount > 0 AND paid_amount = total_amount AND balance_due = 0) OR "
            "(status = 'CANCELED' AND balance_due = total_amount - paid_amount)",
            name="ck_invoices_status_financial_invariants",
        ),
    )


class InvoiceItem(Base):
    """Line item belonging to an invoice."""

    __tablename__ = "invoice_items"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )
    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        nullable=False,
    )
    line_total: Mapped[Decimal] = mapped_column(
        Numeric(15, 2),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    invoice: Mapped["Invoice"] = relationship(
        "Invoice",
        back_populates="items",
    )

    __table_args__ = (
        Index("ix_invoice_items_invoice_id", "invoice_id"),
        CheckConstraint("length(trim(description)) > 0", name="ck_invoice_items_description_not_empty"),
        CheckConstraint("quantity > 0", name="ck_invoice_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_invoice_items_unit_price_non_negative"),
        CheckConstraint("line_total >= 0", name="ck_invoice_items_line_total_non_negative"),
    )
