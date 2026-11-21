"""FastAPI shared dependencies for authentication, database sessions, and multi-tenant workspace context."""

from dataclasses import dataclass
import uuid
from typing import Annotated, Final, FrozenSet
from fastapi import Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import decode_access_token
from app.core.exceptions import (
    AuthenticationError,
    BadRequestError,
    EntityNotFoundError,
    ForbiddenError,
)
from app.models.user import User
from app.models.business import Business
from app.models.membership import BusinessMembership, SUPPORTED_ROLES

# Standard HTTP Bearer scheme for Swagger UI and header extraction
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Retrieve and validate the currently authenticated user from Bearer JWT.

    Steps:
        1. Checks for Authorization header presence.
        2. Cryptographically verifies JWT signature, expiration, and algorithm.
        3. Extracts user UUID subject claim.
        4. Queries the database to ensure the user exists.
        5. Enforces that the user account is active (is_active == True).

    Args:
        credentials: Extracted Bearer token credentials.
        db: Active database session.

    Returns:
        User: Verified, active database User ORM model.

    Raises:
        AuthenticationError: If token is missing, invalid, expired, or user is inactive/non-existent.
    """
    if credentials is None or not credentials.credentials:
        raise AuthenticationError(
            detail="Missing Authorization header with Bearer token.",
            code="MISSING_AUTHENTICATION",
        )

    # Decode and verify JWT signature and claims
    claims = decode_access_token(credentials.credentials)
    user_id_str = claims.get("sub")

    try:
        user_uuid = uuid.UUID(user_id_str)
    except (ValueError, TypeError):
        raise AuthenticationError(
            detail="Token subject is not a valid UUID.",
            code="INVALID_TOKEN_SUBJECT",
        )

    user = db.get(User, user_uuid)
    if user is None:
        raise AuthenticationError(
            detail="Authenticated user no longer exists.",
            code="USER_NOT_FOUND",
        )

    if not user.is_active:
        raise AuthenticationError(
            detail="Authenticated user account is inactive.",
            code="ACCOUNT_INACTIVE",
        )

    return user


# Type-annotated dependency alias for convenient route injection
CurrentUserDep = Annotated[User, Depends(get_current_user)]


# ==============================================================================
# Multi-Tenant Workspace Context & Role Authorization Dependencies
# ==============================================================================

@dataclass(frozen=True)
class WorkspaceContext:
    """Immutable multi-tenant context passed to route handlers."""

    business: Business
    membership: BusinessMembership
    user: User

    @property
    def business_id(self) -> uuid.UUID:
        return self.business.id

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def role(self) -> str:
        return self.membership.role


def get_current_workspace(
    request: Request,
    current_user: CurrentUserDep,
    db: Annotated[Session, Depends(get_db)],
) -> WorkspaceContext:
    """Resolve and authenticate workspace tenancy context from X-Business-ID header.

    Enforces:
    1. Header presence: Returns 400 MISSING_BUSINESS_ID_HEADER if missing or blank.
    2. Header format: Returns 400 INVALID_BUSINESS_ID_FORMAT if not a valid UUID.
    3. Uniform 404 Anti-Enumeration: Returns identical 404 BUSINESS_NOT_FOUND whether
       the workspace does not exist or the authenticated user is not a member.

    Args:
        request: FastAPI raw request to extract X-Business-ID header directly.
        current_user: Validated, authenticated user.
        db: Active database session.

    Returns:
        WorkspaceContext: Immutable validated workspace context.

    Raises:
        BadRequestError: If X-Business-ID is missing or malformed.
        EntityNotFoundError: If business does not exist or user lacks membership.
    """
    x_business_id = request.headers.get("x-business-id")

    # 1. Header Presence Check
    if not x_business_id or not x_business_id.strip():
        raise BadRequestError(
            detail="Missing required 'X-Business-ID' header for workspace-scoped resource.",
            code="MISSING_BUSINESS_ID_HEADER",
        )

    # 2. UUID Format Check
    try:
        business_uuid = uuid.UUID(x_business_id.strip())
    except (ValueError, TypeError):
        raise BadRequestError(
            detail="The provided 'X-Business-ID' header is not a valid UUID.",
            code="INVALID_BUSINESS_ID_FORMAT",
        )

    # 3. Single-Query Membership Resolution with Anti-Enumeration
    result = db.execute(
        select(Business, BusinessMembership)
        .outerjoin(
            BusinessMembership,
            (BusinessMembership.business_id == Business.id) & (BusinessMembership.user_id == current_user.id),
        )
        .where(Business.id == business_uuid)
    ).first()

    # Uniform 404: Nonexistent workspace and unpermitted workspace return identical 404
    if result is None or result[1] is None:
        raise EntityNotFoundError(
            detail="Requested business workspace not found.",
            code="BUSINESS_NOT_FOUND",
        )

    business, membership = result
    return WorkspaceContext(
        business=business,
        membership=membership,
        user=current_user,
    )


CurrentBusinessDep = Annotated[WorkspaceContext, Depends(get_current_workspace)]


def RequireRoles(*allowed_roles: str):
    """Dependency factory enforcing strict role-based access control.

    Fails closed at construction time if allowed_roles is empty or contains
    unrecognized role strings. Exact, case-sensitive matching is enforced at runtime.

    Args:
        *allowed_roles: Whitelist of permitted role names from SUPPORTED_ROLES.

    Returns:
        Callable dependency that inspects WorkspaceContext.role.

    Raises:
        ValueError: If allowed_roles is empty or contains unknown/malformed roles.
    """
    if not allowed_roles:
        raise ValueError("CRITICAL SECURITY ERROR: RequireRoles requires at least one allowed role.")

    invalid_roles = set(allowed_roles) - SUPPORTED_ROLES
    if invalid_roles:
        raise ValueError(
            f"CRITICAL SECURITY ERROR: Invalid role(s) specified in RequireRoles: {sorted(invalid_roles)}. "
            f"Allowed roles are: {sorted(SUPPORTED_ROLES)}"
        )

    frozen_allowed: Final[FrozenSet[str]] = frozenset(allowed_roles)

    def role_checker(context: CurrentBusinessDep) -> WorkspaceContext:
        if context.role not in frozen_allowed:
            raise ForbiddenError(
                detail=(
                    f"Insufficient role permissions for this operation. "
                    f"Required: {', '.join(sorted(frozen_allowed))}. Your role: '{context.role}'."
                ),
                code="INSUFFICIENT_ROLE_PERMISSIONS",
            )
        return context

    return role_checker


# Semantic reusable role dependencies
RequireOwner = Annotated[WorkspaceContext, Depends(RequireRoles("OWNER"))]
RequireAdmin = Annotated[WorkspaceContext, Depends(RequireRoles("OWNER", "ADMIN"))]
RequireMember = Annotated[WorkspaceContext, Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))]
RequireViewer = Annotated[WorkspaceContext, Depends(RequireRoles("OWNER", "ADMIN", "MEMBER", "VIEWER"))]
