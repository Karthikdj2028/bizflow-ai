"""Domain service for business workspace queries and tenancy safeguards."""

import uuid
from typing import Any, Dict, List
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.exceptions import ConflictError
from app.models.business import Business
from app.models.membership import BusinessMembership


def get_user_workspaces(db: Session, user_id: uuid.UUID) -> List[Dict[str, Any]]:
    """Query and return all business workspaces accessible to a user.

    Args:
        db: Active database session.
        user_id: UUID of the authenticated user.

    Returns:
        List[Dict[str, Any]]: List of dictionary summaries with business metadata and user's role.
    """
    rows = db.execute(
        select(Business, BusinessMembership.role)
        .join(BusinessMembership, BusinessMembership.business_id == Business.id)
        .where(BusinessMembership.user_id == user_id)
        .order_by(Business.name.asc())
    ).all()

    workspaces = []
    for business, role in rows:
        workspaces.append({
            "id": business.id,
            "name": business.name,
            "base_currency": business.base_currency,
            "role": role,
            "created_at": business.created_at,
        })
    return workspaces


def assert_not_last_owner(
    db: Session,
    business_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Ensure that an operation does not remove or demote the sole remaining OWNER.

    IMPORTANT ARCHITECTURAL NOTE:
    This is a reusable domain safeguard helper, not a globally auto-injected route middleware.
    When future Phase 2 member-removal and role-demotion endpoints are implemented,
    the mutating service must invoke this helper inside an atomic transaction block
    (with db.begin():) after acquiring a pessimistic row lock (e.g. SELECT ... FOR UPDATE
    on the parent Business row in PostgreSQL) to prevent concurrency race conditions where
    two simultaneous requests both demote or delete the only two remaining owners.

    Args:
        db: Active database session.
        business_id: UUID of the target business workspace.
        user_id: UUID of the user whose membership is being removed or demoted.

    Raises:
        ConflictError: If the target user is an OWNER and is the only remaining OWNER.
    """
    membership = db.scalar(
        select(BusinessMembership).where(
            BusinessMembership.business_id == business_id,
            BusinessMembership.user_id == user_id,
        )
    )
    if membership is None or membership.role != "OWNER":
        return

    # Count all remaining owners in this workspace
    owner_count = db.scalar(
        select(func.count(BusinessMembership.id)).where(
            BusinessMembership.business_id == business_id,
            BusinessMembership.role == "OWNER",
        )
    ) or 0

    if owner_count <= 1:
        raise ConflictError(
            detail="Cannot remove or demote the sole remaining OWNER of this workspace. Transfer ownership first.",
            code="CANNOT_REMOVE_LAST_OWNER",
        )
