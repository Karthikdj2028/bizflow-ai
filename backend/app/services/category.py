"""Domain service for category management and conflict-safe default seeding."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.exceptions import BadRequestError, ConflictError, EntityNotFoundError
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.category import CategoryCreateRequest, CategoryUpdateRequest

DEFAULT_CATEGORIES = (
    # Income (3)
    {
        "name": "Sales & Services",
        "type": "INCOME",
        "color_hex": "#10B981",
        "description": "Core operating revenue from clients and customers",
    },
    {
        "name": "Consulting & Advisory",
        "type": "INCOME",
        "color_hex": "#059669",
        "description": "Professional fees and contract consulting",
    },
    {
        "name": "Other Income",
        "type": "INCOME",
        "color_hex": "#34D399",
        "description": "Incidental receipts, interest, and refunds",
    },
    # Expense (6)
    {
        "name": "Software & Subscriptions",
        "type": "EXPENSE",
        "color_hex": "#6366F1",
        "description": "Cloud hosting, SaaS tools, and developer licenses",
    },
    {
        "name": "Rent & Office Space",
        "type": "EXPENSE",
        "color_hex": "#8B5CF6",
        "description": "Office lease, co-working desks, and utilities",
    },
    {
        "name": "Marketing & Advertising",
        "type": "EXPENSE",
        "color_hex": "#EC4899",
        "description": "Campaigns, digital advertising, and promotional materials",
    },
    {
        "name": "Professional Services",
        "type": "EXPENSE",
        "color_hex": "#F59E0B",
        "description": "Legal, accounting, and advisory fees",
    },
    {
        "name": "Travel & Entertainment",
        "type": "EXPENSE",
        "color_hex": "#F97316",
        "description": "Client meals, flights, and business transit",
    },
    {
        "name": "General & Administrative",
        "type": "EXPENSE",
        "color_hex": "#64748B",
        "description": "Office supplies, bank charges, and sundry costs",
    },
)

SUPPORTED_CATEGORY_TYPES = frozenset({"INCOME", "EXPENSE"})


def seed_default_categories(db: Session, business_id: uuid.UUID) -> List[Category]:
    """Seed the 9 standard default categories for a business workspace safely.

    Uses dialect-specific conflict-safe insertion targeting the functional unique index
    (business_id, type, lower(name)) to guarantee idempotency without race conditions.
    """
    bind = db.get_bind()
    dialect_name = bind.dialect.name
    now = datetime.now(timezone.utc)

    for cat in DEFAULT_CATEGORIES:
        cat_id = uuid.uuid4()
        if dialect_name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as pg_insert

            stmt = (
                pg_insert(Category)
                .values(
                    id=cat_id,
                    business_id=business_id,
                    name=cat["name"],
                    type=cat["type"],
                    description=cat["description"],
                    color_hex=cat["color_hex"],
                    is_system_default=True,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_nothing(
                    index_elements=["business_id", "type", func.lower(Category.name)]
                )
            )
            db.execute(stmt)
        elif dialect_name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert

            stmt = (
                sqlite_insert(Category)
                .values(
                    id=cat_id,
                    business_id=business_id,
                    name=cat["name"],
                    type=cat["type"],
                    description=cat["description"],
                    color_hex=cat["color_hex"],
                    is_system_default=True,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_nothing()
            )
            db.execute(stmt)
        else:
            raise NotImplementedError(
                f"Unsupported database dialect for conflict-safe seeding: {dialect_name}"
            )

    db.flush()
    return list(
        db.scalars(
            select(Category)
            .where(
                Category.business_id == business_id,
                Category.is_system_default.is_(True),
            )
            .order_by(Category.name.asc())
        ).all()
    )


def get_categories_for_workspace(
    db: Session,
    business_id: uuid.UUID,
    type_filter: Optional[str] = None,
) -> List[Category]:
    """Retrieve all categories for a business workspace.

    Strictly read-only query.
    """
    query = select(Category).where(Category.business_id == business_id)

    if type_filter:
        normalized_type = type_filter.upper().strip()
        if normalized_type not in SUPPORTED_CATEGORY_TYPES:
            raise BadRequestError(
                detail=f"Invalid category type filter '{type_filter}'. Must be 'INCOME' or 'EXPENSE'.",
                code="INVALID_CATEGORY_TYPE",
            )
        query = query.where(Category.type == normalized_type)

    query = query.order_by(
        Category.is_system_default.desc(),
        Category.name.asc(),
    )
    return list(db.scalars(query).all())


def create_category(
    db: Session,
    business_id: uuid.UUID,
    request: CategoryCreateRequest,
) -> Category:
    """Create a new custom category for a business workspace."""
    normalized_name = request.name.strip()

    # Pre-check for duplicate name within workspace and category type (case-insensitive)
    existing = db.scalar(
        select(Category.id).where(
            Category.business_id == business_id,
            Category.type == request.type,
            func.lower(Category.name) == normalized_name.lower(),
        )
    )
    if existing is not None:
        raise ConflictError(
            detail=f"Category '{normalized_name}' already exists for type '{request.type}'.",
            code="CATEGORY_ALREADY_EXISTS",
        )

    category = Category(
        business_id=business_id,
        name=normalized_name,
        type=request.type,
        description=request.description.strip() if request.description else None,
        color_hex=request.color_hex,
        is_system_default=False,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


def update_category(
    db: Session,
    business_id: uuid.UUID,
    category_id: uuid.UUID,
    request: CategoryUpdateRequest,
) -> Category:
    """Update an existing category's name, description, or color.

    Category type cannot be modified.
    """
    category = db.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.business_id == business_id,
        )
    )
    if category is None:
        raise EntityNotFoundError(
            detail="Category not found.",
            code="CATEGORY_NOT_FOUND",
        )

    if request.name is not None:
        normalized_name = request.name.strip()
        if normalized_name.lower() != category.name.lower():
            # Check for conflict with other categories of the same type
            existing = db.scalar(
                select(Category.id).where(
                    Category.business_id == business_id,
                    Category.type == category.type,
                    func.lower(Category.name) == normalized_name.lower(),
                    Category.id != category.id,
                )
            )
            if existing is not None:
                raise ConflictError(
                    detail=f"Category '{normalized_name}' already exists for type '{category.type}'.",
                    code="CATEGORY_ALREADY_EXISTS",
                )
        category.name = normalized_name

    if request.description is not None:
        category.description = request.description.strip() if request.description else None

    if request.color_hex is not None:
        category.color_hex = request.color_hex

    category.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(category)
    return category


def delete_category(
    db: Session,
    business_id: uuid.UUID,
    category_id: uuid.UUID,
) -> None:
    """Delete a custom category.

    System default categories cannot be deleted under any circumstances.
    Categories referenced by any transactions (active or soft-deleted) cannot be deleted.
    """
    category = db.scalar(
        select(Category).where(
            Category.id == category_id,
            Category.business_id == business_id,
        )
    )
    if category is None:
        raise EntityNotFoundError(
            detail="Category not found.",
            code="CATEGORY_NOT_FOUND",
        )

    if category.is_system_default:
        raise ConflictError(
            detail="System default categories cannot be deleted.",
            code="CANNOT_DELETE_SYSTEM_CATEGORY",
        )

    # Check for existing transactions referencing this category (including soft-deleted)
    tx_count = db.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.business_id == business_id,
            Transaction.category_id == category_id,
        )
    ) or 0

    if tx_count > 0:
        raise ConflictError(
            detail="Cannot delete category because it is referenced by existing transactions.",
            code="CATEGORY_IN_USE",
        )

    db.delete(category)
    db.commit()
