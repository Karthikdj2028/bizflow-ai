"""Pydantic v2 schemas for multi-line invoice management and RFC 9457 serialization."""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import re
from typing import Any, List, Literal, Optional
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator


def _validate_decimal_scale(value: Any, max_scale: int, field_name: str) -> Decimal:
    """Validate decimal scale and format without silent rounding."""
    if value is None:
        raise ValueError(f"{field_name} cannot be null.")

    if isinstance(value, float):
        raise ValueError(f"Floating-point values are strictly forbidden for {field_name}. Use string representation.")

    str_val = str(value).strip()
    if not str_val:
        raise ValueError(f"{field_name} cannot be empty.")

    try:
        dec_val = Decimal(str_val)
    except (InvalidOperation, ValueError):
        raise ValueError(f"Invalid decimal format for {field_name}: '{str_val}'")

    if not dec_val.is_finite():
        raise ValueError(f"{field_name} must be a finite number.")

    # Check decimal scale
    parts = str_val.split(".")
    if len(parts) == 2:
        scale = len(parts[1])
        if scale > max_scale:
            raise ValueError(f"MAX_SCALE_EXCEEDED: {field_name} may have at most {max_scale} decimal places.")

    return dec_val


class InvoiceItemCreateRequest(BaseModel):
    """Line item creation payload."""

    model_config = ConfigDict(extra="forbid")

    description: str = Field(..., min_length=1, max_length=255, description="Item description")
    quantity: str = Field(..., description="Quantity as string with at most 2 decimal places")
    unit_price: str = Field(..., description="Unit price as string with at most 2 decimal places")

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("description cannot be empty or whitespace only.")
        return trimmed

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: Any) -> str:
        dec = _validate_decimal_scale(v, 2, "quantity")
        if dec <= Decimal("0.00"):
            raise ValueError("quantity must be strictly positive (> 0).")
        if dec > Decimal("10000000.00"):
            raise ValueError("quantity exceeds maximum allowed limit (10,000,000.00).")
        return str(dec)

    @field_validator("unit_price")
    @classmethod
    def validate_unit_price(cls, v: Any) -> str:
        dec = _validate_decimal_scale(v, 2, "unit_price")
        if dec < Decimal("0.00"):
            raise ValueError("unit_price must be non-negative (>= 0).")
        if dec > Decimal("100000000.00"):
            raise ValueError("unit_price exceeds maximum allowed limit (100,000,000.00).")
        return str(dec)


class InvoiceCreateRequest(BaseModel):
    """Invoice creation request body."""

    model_config = ConfigDict(extra="forbid")

    customer_id: uuid.UUID = Field(..., description="Target customer ID in current workspace")
    invoice_number: str = Field(..., min_length=1, max_length=64, description="Unique invoice number")
    issue_date: date = Field(..., description="Invoice issue date")
    due_date: date = Field(..., description="Invoice payment due date")
    tax_rate: str = Field(default="0.0000", description="Tax rate fractional decimal [0.0000, 1.0000]")
    discount_amount: str = Field(default="0.00", description="Total discount amount")
    notes: Optional[str] = Field(default=None, max_length=2000, description="Optional notes or payment instructions")
    items: List[InvoiceItemCreateRequest] = Field(..., min_length=1, description="List of multi-line items")

    @field_validator("invoice_number")
    @classmethod
    def validate_invoice_number(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("invoice_number cannot be empty or whitespace only.")
        return trimmed

    @field_validator("tax_rate")
    @classmethod
    def validate_tax_rate(cls, v: Any) -> str:
        dec = _validate_decimal_scale(v, 4, "tax_rate")
        if dec < Decimal("0.0000") or dec > Decimal("1.0000"):
            raise ValueError("tax_rate must be between 0.0000 and 1.0000 (0% to 100%).")
        return str(dec)

    @field_validator("discount_amount")
    @classmethod
    def validate_discount_amount(cls, v: Any) -> str:
        dec = _validate_decimal_scale(v, 2, "discount_amount")
        if dec < Decimal("0.00"):
            raise ValueError("discount_amount must be non-negative (>= 0).")
        return str(dec)

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            return trimmed if trimmed else None
        return None

    @model_validator(mode="after")
    def validate_dates(self) -> "InvoiceCreateRequest":
        if self.due_date < self.issue_date:
            raise ValueError("INVALID_DATE_RANGE: due_date cannot be earlier than issue_date.")
        return self


class InvoiceUpdateRequest(BaseModel):
    """Invoice partial update request body. Prohibits null for non-nullable fields."""

    model_config = ConfigDict(extra="forbid")

    customer_id: Optional[uuid.UUID] = Field(default=None)
    invoice_number: Optional[str] = Field(default=None, min_length=1, max_length=64)
    issue_date: Optional[date] = Field(default=None)
    due_date: Optional[date] = Field(default=None)
    tax_rate: Optional[str] = Field(default=None)
    discount_amount: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None, max_length=2000)
    items: Optional[List[InvoiceItemCreateRequest]] = Field(default=None, min_length=1)

    @field_validator("invoice_number")
    @classmethod
    def validate_invoice_number(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if not trimmed:
                raise ValueError("invoice_number cannot be empty or whitespace only.")
            return trimmed
        return v

    @field_validator("tax_rate")
    @classmethod
    def validate_tax_rate(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            dec = _validate_decimal_scale(v, 4, "tax_rate")
            if dec < Decimal("0.0000") or dec > Decimal("1.0000"):
                raise ValueError("tax_rate must be between 0.0000 and 1.0000.")
            return str(dec)
        return v

    @field_validator("discount_amount")
    @classmethod
    def validate_discount_amount(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            dec = _validate_decimal_scale(v, 2, "discount_amount")
            if dec < Decimal("0.00"):
                raise ValueError("discount_amount must be non-negative (>= 0).")
            return str(dec)
        return v


class InvoiceStatusTransitionRequest(BaseModel):
    """Request body for invoice state machine transitions."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["MARK_SENT", "CANCEL"] = Field(..., description="State machine transition action")


class InvoiceItemResponse(BaseModel):
    """Line item serialization schema."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    invoice_id: uuid.UUID
    description: str
    quantity: str
    unit_price: str
    line_total: str
    created_at: datetime

    @field_serializer("quantity")
    def serialize_quantity(self, val: Any) -> str:
        return f"{Decimal(str(val)):.2f}"

    @field_serializer("unit_price")
    def serialize_unit_price(self, val: Any) -> str:
        return f"{Decimal(str(val)):.2f}"

    @field_serializer("line_total")
    def serialize_line_total(self, val: Any) -> str:
        return f"{Decimal(str(val)):.2f}"


class InvoiceListItemResponse(BaseModel):
    """Summary item for invoice pagination list."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    customer_id: uuid.UUID
    customer_name: str
    invoice_number: str
    status: str
    persisted_status: str
    issue_date: date
    due_date: date
    subtotal: str
    tax_rate: str
    tax_amount: str
    discount_amount: str
    total_amount: str
    paid_amount: str
    balance_due: str
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("subtotal", "tax_amount", "discount_amount", "total_amount", "paid_amount", "balance_due")
    def serialize_currency(self, val: Any) -> str:
        return f"{Decimal(str(val)):.2f}"

    @field_serializer("tax_rate")
    def serialize_tax_rate(self, val: Any) -> str:
        return f"{Decimal(str(val)):.4f}"


class InvoiceDetailResponse(InvoiceListItemResponse):
    """Complete invoice detail response including multi-line items."""

    items: List[InvoiceItemResponse] = Field(default_factory=list)


class InvoicePaginationResponse(BaseModel):
    """Paginated list envelope."""

    items: List[InvoiceListItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
