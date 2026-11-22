"""Pydantic v2 schemas for customer management and validation."""

from datetime import datetime
from typing import List, Optional
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class CustomerCreateRequest(BaseModel):
    """Payload schema for registering a new customer entity."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Customer or client organization name.",
    )
    email: Optional[EmailStr] = Field(
        default=None,
        max_length=255,
        description="Optional customer billing or contact email.",
    )
    phone: Optional[str] = Field(
        default=None,
        max_length=50,
        description="Optional primary phone number.",
    )
    billing_address: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Optional billing or physical mailing address.",
    )
    payment_terms_days: int = Field(
        default=30,
        ge=0,
        description="Agreed invoice payment terms in days (e.g. 0 for Due on Receipt, 15, 30, 60).",
    )
    is_active: bool = Field(
        default=True,
        description="Whether the customer profile is active for new transactions/invoices.",
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Customer name cannot be empty or whitespace only.")
        return trimmed

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str):
            clean = v.strip()
            return clean.lower() if clean else None
        return v

    @field_validator("phone", "billing_address", mode="before")
    @classmethod
    def trim_optional_strings(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str):
            clean = v.strip()
            return clean if clean else None
        return v


class CustomerUpdateRequest(BaseModel):
    """Payload schema for modifying an existing customer profile.

    Supports partial updates. Explicit null clears optional fields (email, phone, billing_address).
    """

    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Updated customer name.",
    )
    email: Optional[EmailStr] = Field(
        default=None,
        max_length=255,
        description="Updated contact email or null to clear.",
    )
    phone: Optional[str] = Field(
        default=None,
        max_length=50,
        description="Updated phone number or null to clear.",
    )
    billing_address: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Updated billing address or null to clear.",
    )
    payment_terms_days: Optional[int] = Field(
        default=None,
        ge=0,
        description="Updated payment terms in days.",
    )
    is_active: Optional[bool] = Field(
        default=None,
        description="Active/inactive status toggle.",
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            raise ValueError("Customer name cannot be null.")
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Customer name cannot be empty or whitespace only.")
        return trimmed

    @field_validator("payment_terms_days")
    @classmethod
    def validate_payment_terms_days(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            raise ValueError("Payment terms cannot be null.")
        return v

    @field_validator("is_active")
    @classmethod
    def validate_is_active(cls, v: Optional[bool]) -> Optional[bool]:
        if v is None:
            raise ValueError("is_active cannot be null.")
        return v

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str):
            clean = v.strip()
            return clean.lower() if clean else None
        return v

    @field_validator("phone", "billing_address", mode="before")
    @classmethod
    def trim_optional_strings(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str):
            clean = v.strip()
            return clean if clean else None
        return v


class CustomerResponse(BaseModel):
    """Customer profile entity serialization schema."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    billing_address: Optional[str] = None
    payment_terms_days: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CustomerListResponse(BaseModel):
    """Paginated collection of customer profiles."""

    items: List[CustomerResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
