"""Workspace tenancy REST endpoints.

Provides:
- GET /api/v1/workspaces: List all workspaces accessible by the authenticated user (header-free).
- GET /api/v1/workspaces/current: Inspect the currently active workspace resolved via X-Business-ID.
"""

from typing import Annotated
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.dependencies import CurrentUserDep, CurrentBusinessDep
from app.services.workspace import get_user_workspaces
from app.schemas.workspace import WorkspaceListResponse, WorkspaceSummaryResponse

router = APIRouter()


@router.get(
    "",
    response_model=WorkspaceListResponse,
    status_code=status.HTTP_200_OK,
    summary="List accessible workspaces",
    description="Retrieve all business workspaces accessible to the authenticated user. Does NOT require X-Business-ID.",
)
def list_workspaces(
    current_user: CurrentUserDep,
    db: Annotated[Session, Depends(get_db)],
) -> WorkspaceListResponse:
    """Return list of all business workspaces where the user has an active membership."""
    workspaces = get_user_workspaces(db=db, user_id=current_user.id)
    return WorkspaceListResponse(
        items=workspaces,
        total=len(workspaces),
    )


@router.get(
    "/current",
    response_model=WorkspaceSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get active workspace context",
    description="Inspect the currently active workspace resolved from the required X-Business-ID header.",
)
def get_current_workspace_info(
    context: CurrentBusinessDep,
) -> WorkspaceSummaryResponse:
    """Return active workspace metadata and user's verified role."""
    return WorkspaceSummaryResponse(
        id=context.business.id,
        name=context.business.name,
        base_currency=context.business.base_currency,
        role=context.role,
        created_at=context.business.created_at,
    )
