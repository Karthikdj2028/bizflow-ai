"""Business membership junction model for role-based multi-tenancy."""

import uuid
from datetime import datetime, timezone
from typing import Final, FrozenSet, TYPE_CHECKING
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.business import Business

# Canonical definition of supported workspace membership roles
SUPPORTED_ROLES: Final[FrozenSet[str]] = frozenset({"OWNER", "ADMIN", "MEMBER", "VIEWER"})


class BusinessMembership(Base):
    """Junction entity connecting users to businesses with role-based permissions."""

    __tablename__ = "business_memberships"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint("user_id", "business_id", name="uq_user_business_membership"),
        CheckConstraint(
            "role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')",
            name="chk_membership_role",
        ),
        Index("idx_membership_user_id", "user_id"),
        Index("idx_membership_business_id", "business_id"),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="memberships",
    )
    business: Mapped["Business"] = relationship(
        "Business",
        back_populates="memberships",
    )

    def __repr__(self) -> str:
        return f"<BusinessMembership id={self.id} user_id={self.user_id} business_id={self.business_id} role={self.role}>"
