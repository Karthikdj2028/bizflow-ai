"""Category API endpoints for workspace chart-of-accounts management."""

import uuid
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.api.dependencies import CurrentBusinessDep, RequireRoles
from app.core.database import get_db
from app.schemas.category import (
    CategoryCreateRequest,
    CategoryListResponse,
    CategoryResponse,
    CategoryUpdateRequest,
)
from app.services.category import (
    create_category as svc_create_category,
    delete_category as svc_delete_category,
    get_categories_for_workspace as svc_get_categories,
    update_category as svc_update_category,
)

router = APIRouter(prefix="/categories", tags=["Categories"])


@router.get(
    "",
    response_model=CategoryListResponse,
    status_code=status.HTTP_200_OK,
    summary="List workspace categories",
    description="Retrieve all chart-of-accounts categories for the active workspace. Strictly read-only.",
)
def get_categories(
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
    type: Annotated[
        Optional[str],
        Query(
            description="Optional filter by category type ('INCOME' or 'EXPENSE').",
            examples=["INCOME", "EXPENSE"],
        ),
    ] = None,
) -> CategoryListResponse:
    """List all categories (system defaults + custom) for the active workspace."""
    categories = svc_get_categories(db, context.business_id, type_filter=type)
    return CategoryListResponse(
        items=[CategoryResponse.model_validate(c) for c in categories],
        total=len(categories),
    )


@router.post(
    "",
    response_model=CategoryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create custom category",
    description="Create a custom category for the active workspace. Requires OWNER, ADMIN, or MEMBER role.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN", "MEMBER"))],
)
def create_category(
    request: CategoryCreateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> CategoryResponse:
    """Create a new custom category."""
    category = svc_create_category(db, context.business_id, request)
    return CategoryResponse.model_validate(category)


@router.patch(
    "/{category_id}",
    response_model=CategoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Update category",
    description="Update a category's name, description, or color. Requires OWNER or ADMIN role. Category type is immutable.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN"))],
)
def update_category(
    category_id: uuid.UUID,
    request: CategoryUpdateRequest,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> CategoryResponse:
    """Update category properties."""
    category = svc_update_category(db, context.business_id, category_id, request)
    return CategoryResponse.model_validate(category)


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete custom category",
    description="Delete a custom category. Requires OWNER or ADMIN role. System default categories and categories with transactions cannot be deleted.",
    dependencies=[Depends(RequireRoles("OWNER", "ADMIN"))],
)
def delete_category(
    category_id: uuid.UUID,
    context: CurrentBusinessDep,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a custom category."""
    svc_delete_category(db, context.business_id, category_id)
