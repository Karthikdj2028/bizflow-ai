"""Authentication and registration REST endpoints.

Provides:
- POST /api/v1/auth/register (Atomic User + Business + Membership creation)
- POST /api/v1/auth/login (Credential verification and JWT issuance)
- GET /api/v1/auth/me (Identity introspection via CurrentUserDep)
"""

from typing import Annotated
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.api.dependencies import CurrentUserDep
from app.services.auth import register_user, authenticate_user
from app.schemas.auth import (
    UserRegisterRequest,
    UserLoginRequest,
    TokenResponse,
    UserResponse,
    AuthResponse,
)

router = APIRouter()
settings = get_settings()


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new user account",
    description="Atomically creates User, default Business workspace (INR), and OWNER membership.",
)
def register(
    request: UserRegisterRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    """Create a new user account, workspace, and return initial JWT."""
    user, _, _ = register_user(db=db, request=request)

    # Issue initial access token
    access_token = create_access_token(subject=user.id)
    token = TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return AuthResponse(
        user=UserResponse.model_validate(user),
        token=token,
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="User login",
    description="Authenticate with email and password to receive a signed JWT access token.",
)
def login(
    request: UserLoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    """Authenticate user credentials and issue signed JWT access token."""
    user = authenticate_user(db=db, request=request)

    access_token = create_access_token(subject=user.id)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current user profile",
    description="Retrieve profile details for the currently authenticated Bearer token holder.",
)
def get_current_user_profile(
    current_user: CurrentUserDep,
) -> UserResponse:
    """Return verified authenticated user profile."""
    return UserResponse.model_validate(current_user)
