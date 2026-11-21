"""Health check endpoint handler."""

from fastapi import APIRouter
from app.core.config import get_settings

router = APIRouter()
settings = get_settings()


@router.get(
    "/health",
    tags=["System"],
    summary="Health check probe",
    description="Returns the current operational status of the BizFlow AI API.",
)
def get_health() -> dict[str, str]:
    """Return API operational status and metadata."""
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "environment": settings.APP_ENV,
        "version": "0.1.0",
    }
