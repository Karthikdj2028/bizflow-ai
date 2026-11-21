"""Pydantic v2 schemas for authentication, user registration, and tokens."""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserRegisterRequest(BaseModel):
    """Payload schema for user registration."""

    email: EmailStr
    password: str = Field(
        ...,
        min_length=8,
        description="Password must be at least 8 characters and at most 72 UTF-8 bytes.",
    )
    full_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="User's full legal or display name.",
    )
    initial_business_name: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Optional name for initial business workspace.",
    )

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        """Trim whitespace and normalize email address to lowercase."""
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str) -> str:
        """Ensure full name is not blank or whitespace only."""
        clean = v.strip()
        if not clean:
            raise ValueError("Full name cannot be blank or whitespace only.")
        return clean

    @field_validator("password")
    @classmethod
    def validate_password_byte_length(cls, v: str) -> str:
        """Enforce strict 72-byte UTF-8 limit for bcrypt compatibility."""
        encoded_len = len(v.encode("utf-8"))
        if encoded_len > 72:
            raise ValueError(
                f"Password exceeds 72-byte UTF-8 limit for bcrypt (encoded length is {encoded_len} bytes)."
            )
        return v


class UserLoginRequest(BaseModel):
    """Payload schema for user login credentials."""

    email: EmailStr
    password: str = Field(..., min_length=1)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        """Normalize email address on login to prevent casing mismatch."""
        if isinstance(v, str):
            return v.strip().lower()
        return v


class TokenResponse(BaseModel):
    """Standard Bearer token response schema."""

    access_token: str = Field(..., description="Signed JWT access token.")
    token_type: str = Field(default="bearer", description="Token type (Bearer).")
    expires_in: int = Field(..., description="Token lifespan in seconds.")


class UserResponse(BaseModel):
    """Safe public user profile schema. Never serializes password_hash."""

    id: uuid.UUID
    email: EmailStr
    full_name: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    """Composite response returned upon successful registration."""

    user: UserResponse
    token: TokenResponse
