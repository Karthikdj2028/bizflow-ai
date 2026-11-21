"""Pydantic v2 schemas for transaction ledger management and financial calculations."""

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any, List, Literal, Optional
import uuid
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

MONETARY_REGEX = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d{1,2})?$")
MAX_NUMERIC_15_2 = Decimal("9999999999999.99")
SUPPORTED_PAYMENT_METHODS = frozenset(
    {"CASH", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "UPI", "OTHER"}
)


def validate_monetary_amount(v: Any) -> Decimal:
    """Validate string-only monetary input, positive bound, and maximum numeric limit."""
    if not isinstance(v, str):
        raise ValueError(
            "Amount must be provided as a string (e.g. '1250.50'). Numeric types (float, int) are strictly rejected."
        )

    clean = v.strip()
    if not MONETARY_REGEX.match(clean):
        raise ValueError(
            "Amount must have at most 2 decimal places and contain no invalid characters or multiple leading zeroes."
        )

    amount = Decimal(clean)
    if amount <= Decimal("0.00"):
        raise ValueError("Amount must be strictly positive (> 0.00).")
    if amount > MAX_NUMERIC_15_2:
        raise ValueError("Amount exceeds maximum supported limit (9999999999999.99).")

    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def validate_not_future_date(v: date) -> date:
    """Ensure date does not exceed the current UTC calendar date."""
    current_utc_date = datetime.now(timezone.utc).date()
    if v > current_utc_date:
        raise ValueError("Transaction date cannot be in the future.")
    return v


class TransactionCreateRequest(BaseModel):
    """Payload schema for recording a new transaction entry."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["INCOME", "EXPENSE"] = Field(
        ...,
        description="Transaction cash flow classification ('INCOME' or 'EXPENSE').",
    )
    amount: str = Field(
        ...,
        description="Monetary transaction amount as fixed-point string with at most 2 decimal places (e.g. '1250.50').",
    )
    category_id: uuid.UUID = Field(
        ...,
        description="UUID of the workspace category classifying this transaction.",
    )
    transaction_date: date = Field(
        ...,
        description="Calendar date on which the transaction occurred (YYYY-MM-DD). Cannot be in the future.",
    )
    description: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Operational description or memorandum.",
    )
    counterparty: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Optional customer, client, vendor, or payer entity name.",
    )
    reference_number: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Optional invoice reference, check number, or receipt code.",
    )
    payment_method: Literal[
        "CASH", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "UPI", "OTHER"
    ] = Field(
        default="OTHER",
        description="Method of payment used.",
    )

    @field_validator("amount", mode="before")
    @classmethod
    def check_amount(cls, v: Any) -> str:
        parsed = validate_monetary_amount(v)
        return f"{parsed:.2f}"

    @field_validator("transaction_date")
    @classmethod
    def check_date(cls, v: date) -> date:
        return validate_not_future_date(v)

    @field_validator("description")
    @classmethod
    def check_description(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Description cannot be blank or whitespace only.")
        return trimmed

    @field_validator("counterparty")
    @classmethod
    def check_counterparty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            return trimmed if trimmed else None
        return None

    @field_validator("reference_number")
    @classmethod
    def check_reference_number(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            return trimmed if trimmed else None
        return None


class TransactionUpdateRequest(BaseModel):
    """Payload schema for modifying an existing transaction."""

    model_config = ConfigDict(extra="forbid")

    amount: Optional[str] = Field(
        default=None,
        description="Updated monetary amount.",
    )
    category_id: Optional[uuid.UUID] = Field(
        default=None,
        description="Updated category UUID within the same workspace.",
    )
    transaction_date: Optional[date] = Field(
        default=None,
        description="Updated transaction calendar date (cannot be in the future).",
    )
    description: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Updated operational memorandum.",
    )
    counterparty: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Updated counterparty entity (can be set to null).",
    )
    reference_number: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Updated reference code (can be set to null).",
    )
    payment_method: Optional[
        Literal["CASH", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "UPI", "OTHER"]
    ] = Field(
        default=None,
        description="Updated payment method.",
    )

    @model_validator(mode="before")
    @classmethod
    def validate_patch_body(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        # 1. Reject immutable type field explicitly
        if "type" in data:
            raise ValueError("Transaction type is immutable and cannot be modified.")

        # 2. Reject non-nullable fields explicitly passed as null
        non_nullable_fields = ("amount", "category_id", "transaction_date", "description", "payment_method")
        for field in non_nullable_fields:
            if field in data and data[field] is None:
                raise ValueError(f"Field '{field}' cannot be null.")

        return data

    @field_validator("amount", mode="before")
    @classmethod
    def check_amount(cls, v: Any) -> Optional[str]:
        if v is not None:
            parsed = validate_monetary_amount(v)
            return f"{parsed:.2f}"
        return None

    @field_validator("transaction_date")
    @classmethod
    def check_date(cls, v: Optional[date]) -> Optional[date]:
        if v is not None:
            return validate_not_future_date(v)
        return None

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if not trimmed:
                raise ValueError("Description cannot be blank or whitespace only.")
            return trimmed
        return None

    @field_validator("counterparty")
    @classmethod
    def check_counterparty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            return trimmed if trimmed else None
        return None

    @field_validator("reference_number")
    @classmethod
    def check_reference_number(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            return trimmed if trimmed else None
        return None


class TransactionResponse(BaseModel):
    """Public serialized representation of a transaction."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Unique transaction UUID.")
    business_id: uuid.UUID = Field(..., description="Workspace tenant UUID.")
    category_id: uuid.UUID = Field(..., description="Category UUID.")
    category_name: Optional[str] = Field(default=None, description="Category display name.")
    category_color: Optional[str] = Field(default=None, description="Category hex color code.")
    type: str = Field(..., description="Cash flow classification ('INCOME' or 'EXPENSE').")
    amount: str = Field(..., description="Monetary transaction amount as fixed-point string.")
    currency: str = Field(..., description="ISO 4217 currency code inherited from workspace.")
    transaction_date: date = Field(..., description="Calendar date of transaction.")
    description: str = Field(..., description="Operational memorandum.")
    counterparty: Optional[str] = Field(default=None, description="Counterparty name.")
    reference_number: Optional[str] = Field(default=None, description="Reference number.")
    payment_method: str = Field(..., description="Payment method used.")
    created_at: datetime = Field(..., description="Creation timestamp in UTC.")
    updated_at: datetime = Field(..., description="Last modification timestamp in UTC.")

    @field_validator("amount", mode="before")
    @classmethod
    def convert_amount_to_str(cls, v: Any) -> str:
        if isinstance(v, Decimal):
            return f"{v:.2f}"
        return str(v)

    @field_serializer("amount", when_used="always")
    def serialize_amount(self, v: Any) -> str:
        if isinstance(v, Decimal):
            return f"{v:.2f}"
        return str(v)


class TransactionListResponse(BaseModel):
    """Envelope for paginated transaction listings."""

    items: List[TransactionResponse] = Field(..., description="Page items.")
    total: int = Field(..., description="Total matching active transaction count.")
    page: int = Field(..., description="Current page index.")
    page_size: int = Field(..., description="Items per page.")
    total_pages: int = Field(..., description="Total number of available pages.")


class CategoryBreakdownResponse(BaseModel):
    """Category aggregated share within period financial calculation."""

    category_id: uuid.UUID = Field(..., description="Category UUID.")
    category_name: str = Field(..., description="Category display name.")
    category_color: str = Field(..., description="Category hex color.")
    total_amount: str = Field(..., description="Total aggregated amount as fixed-point decimal string.")
    count: int = Field(..., description="Number of transactions in this category.")
    percentage: str = Field(..., description="Share percentage of type total (fixed-point string e.g. '76.47').")


class FinancialSummaryPeriod(BaseModel):
    """Effective date bounds of financial aggregation."""

    start_date: date = Field(..., description="Inclusive start date.")
    end_date: date = Field(..., description="Inclusive end date.")


class FinancialSummaryResponse(BaseModel):
    """Aggregate financial calculations and cash movement overview."""

    period: FinancialSummaryPeriod = Field(..., description="Effective date range.")
    currency: str = Field(..., description="Workspace base currency code.")
    total_income: str = Field(..., description="Total period income as fixed-point decimal string.")
    total_expenses: str = Field(..., description="Total period expenses as fixed-point decimal string.")
    net_cash_flow: str = Field(..., description="Period net cash movement (income - expenses).")
    transaction_count: int = Field(..., description="Total transaction count in period.")
    cumulative_net_movement: str = Field(
        ...,
        description="Workspace-wide recorded historical net cash movement through end_date.",
    )
    income_by_category: List[CategoryBreakdownResponse] = Field(
        ...,
        description="Income transactions aggregated by category.",
    )
    expenses_by_category: List[CategoryBreakdownResponse] = Field(
        ...,
        description="Expense transactions aggregated by category.",
    )
