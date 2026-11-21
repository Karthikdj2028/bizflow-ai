"""Pydantic v2 schemas for workspace discovery and tenancy responses."""

import uuid
from datetime import datetime
from typing import List
from pydantic import BaseModel, ConfigDict, Field


class WorkspaceSummaryResponse(BaseModel):
    """Public summary representation of a business workspace."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Unique workspace business UUID.")
    name: str = Field(..., description="Workspace business organization name.")
    base_currency: str = Field(..., description="ISO 4217 base currency code (e.g. INR).")
    role: str = Field(..., description="Authenticated user's role in this workspace.")
    created_at: datetime = Field(..., description="Workspace creation timestamp in UTC.")


class WorkspaceListResponse(BaseModel):
    """Envelope containing list of accessible business workspaces."""

    items: List[WorkspaceSummaryResponse] = Field(..., description="List of workspaces accessible to the user.")
    total: int = Field(..., description="Total number of accessible workspaces.")
