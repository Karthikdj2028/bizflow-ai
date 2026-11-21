"""Pydantic v2 schemas for category management and validation."""

import re
import uuid
from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

COLOR_HEX_REGEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class CategoryCreateRequest(BaseModel):
    """Payload for creating a custom category."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Category name (e.g. 'Software & Subscriptions').",
    )
    type: Literal["INCOME", "EXPENSE"] = Field(
        ...,
        description="Category cash flow type (INCOME or EXPENSE).",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Optional human-readable description.",
    )
    color_hex: str = Field(
        default="#6366F1",
        description="Hexadecimal color code for UI badging (e.g. '#6366F1').",
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Category name cannot be empty or blank.")
        return trimmed

    @field_validator("color_hex")
    @classmethod
    def validate_color_hex(cls, v: str) -> str:
        trimmed = v.strip()
        if not COLOR_HEX_REGEX.match(trimmed):
            raise ValueError(
                f"Invalid color_hex '{trimmed}'. Must be a 7-character hexadecimal color code (e.g. '#6366F1')."
            )
        return trimmed.upper()


class CategoryUpdateRequest(BaseModel):
    """Payload for modifying an existing category."""

    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100,
        description="Updated category name.",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Updated description.",
    )
    color_hex: Optional[str] = Field(
        default=None,
        description="Updated hexadecimal color code.",
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if not trimmed:
                raise ValueError("Category name cannot be empty or blank.")
            return trimmed
        return None

    @field_validator("color_hex")
    @classmethod
    def validate_color_hex(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if not COLOR_HEX_REGEX.match(trimmed):
                raise ValueError(
                    f"Invalid color_hex '{trimmed}'. Must be a 7-character hexadecimal color code (e.g. '#6366F1')."
                )
            return trimmed.upper()
        return None


class CategoryResponse(BaseModel):
    """Public representation of a category."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    name: str
    type: str
    description: Optional[str] = None
    color_hex: str
    is_system_default: bool
    created_at: datetime
    updated_at: datetime


class CategoryListResponse(BaseModel):
    """Response envelope for category list queries."""

    items: List[CategoryResponse]
    total: int
