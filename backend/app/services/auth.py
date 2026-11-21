"""Authentication and user management domain service.

Implements atomic multi-record registration (User + Business + Membership)
and secure authentication with anti-enumeration protections.
"""

from typing import Tuple
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.core.exceptions import AppException, AuthenticationError, ConflictError
from app.core.security import DUMMY_BCRYPT_HASH, hash_password, verify_password
from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership
from app.schemas.auth import UserRegisterRequest, UserLoginRequest


def _is_email_unique_violation(exc: IntegrityError) -> bool:
    """Accurately identify if an IntegrityError originated from the users.email unique constraint.

    Handles PostgreSQL (Psycopg 3/2) SQLSTATE 23505 and constraint diagnostics,
    as well as SQLite UNIQUE constraint messages for local hermetic testing.
    """
    orig = getattr(exc, "orig", None)
    if orig is None:
        return False

    # 1. PostgreSQL (Psycopg 3 / Psycopg 2) Diagnostics
    pgcode = getattr(orig, "pgcode", None) or getattr(orig, "sqlstate", None)
    if pgcode == "23505":  # PostgreSQL unique_violation SQLSTATE
        diag = getattr(orig, "diag", None)
        constraint_name = getattr(diag, "constraint_name", None) if diag else None
        if constraint_name in ("uq_users_email", "ix_users_email"):
            return True

    # 2. SQLite Diagnostics
    orig_msg = str(orig)
    if "UNIQUE constraint failed: users.email" in orig_msg:
        return True

    return False


def register_user(
    db: Session,
    request: UserRegisterRequest,
) -> Tuple[User, Business, BusinessMembership]:
    """Register a new user, default business workspace, and OWNER membership atomically.

    All duplicate checks, entity instantiations, and database writes execute
    within an explicit atomic transaction block (with db.begin():). If any step
    fails or a duplicate email is detected, all operations roll back cleanly.

    Args:
        db: Active database session.
        request: Validated registration payload.

    Returns:
        Tuple[User, Business, BusinessMembership]: Created entities.

    Raises:
        ConflictError: If email is already registered.
    """
    try:
        with db.begin():
            # Check for existing email within the atomic transaction block
            existing_user = db.scalar(
                select(User).where(User.email == request.email)
            )
            if existing_user is not None:
                raise ConflictError(
                    detail="An account with this email address already exists.",
                    code="EMAIL_ALREADY_EXISTS",
                )

            # 1. Hash password with bcrypt work factor 12
            hashed_pwd = hash_password(request.password)

            # 2. Instantiate User entity
            user = User(
                email=request.email,
                password_hash=hashed_pwd,
                full_name=request.full_name,
                is_active=True,
            )
            db.add(user)
            db.flush()  # Generate user.id for foreign key reference

            # 3. Instantiate default Business workspace (Default Currency: INR)
            workspace_name = (
                request.initial_business_name.strip()
                if request.initial_business_name and request.initial_business_name.strip()
                else f"{request.full_name}'s Workspace"
            )
            business = Business(
                name=workspace_name,
                base_currency="INR",
            )
            db.add(business)
            db.flush()  # Generate business.id for foreign key reference

            # 4. Instantiate BusinessMembership connecting user and business as OWNER
            membership = BusinessMembership(
                user_id=user.id,
                business_id=business.id,
                role="OWNER",
            )
            db.add(membership)

        # Upon clean exit of with db.begin():, all entities are committed together.
        db.refresh(user)
        db.refresh(business)
        db.refresh(membership)
        return user, business, membership

    except ConflictError:
        # Pre-check conflict or explicit conflict; transaction already rolled back
        raise

    except IntegrityError as exc:
        # Transaction is rolled back automatically by with db.begin(): context manager
        if _is_email_unique_violation(exc):
            raise ConflictError(
                detail="An account with this email address already exists.",
                code="EMAIL_ALREADY_EXISTS",
            ) from exc

        # Unrelated constraint violation: do not leak raw SQL or internals
        raise AppException(
            detail="A database integrity constraint prevented registration.",
            status_code=500,
            code="INTERNAL_DATABASE_ERROR",
        ) from exc


def authenticate_user(
    db: Session,
    request: UserLoginRequest,
) -> User:
    """Authenticate user credentials and return verified user.

    Uses a single generic 401 response for both non-existent users and incorrect
    passwords to prevent account enumeration attacks.
    Executes dummy bcrypt verification for nonexistent accounts to mitigate timing attacks.

    Args:
        db: Active database session.
        request: Validated login credentials.

    Returns:
        User: Authenticated active user entity.

    Raises:
        AuthenticationError: If credentials are invalid or account is deactivated.
    """
    user = db.scalar(
        select(User).where(User.email == request.email)
    )

    # Mitigate account enumeration by running bcrypt verification against the precomputed dummy hash
    if user is None:
        verify_password(request.password, DUMMY_BCRYPT_HASH)
        raise AuthenticationError(
            detail="Invalid email or password.",
            code="INVALID_CREDENTIALS",
        )

    if not verify_password(request.password, user.password_hash):
        raise AuthenticationError(
            detail="Invalid email or password.",
            code="INVALID_CREDENTIALS",
        )

    if not user.is_active:
        raise AuthenticationError(
            detail="Your account has been deactivated. Please contact an administrator.",
            code="ACCOUNT_INACTIVE",
        )

    return user
