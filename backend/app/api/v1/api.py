"""API v1 router aggregator.

Mounts all modular sub-routers under the /api/v1 prefix.
"""

from fastapi import APIRouter
from app.api.v1.endpoints import health, auth, workspaces

api_router = APIRouter()

# Mount system health routes under /api/v1
api_router.include_router(health.router, prefix="", tags=["System"])

# Mount authentication routes under /api/v1/auth
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])

# Mount workspace multi-tenancy routes under /api/v1/workspaces
api_router.include_router(workspaces.router, prefix="/workspaces", tags=["Workspaces"])
