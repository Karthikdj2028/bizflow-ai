"""BizFlow AI — FastAPI Application Entrypoint.

Initializes the FastAPI application instance with CORS middleware, root
health check route, and API v1 router aggregator.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router
from app.api.v1.endpoints.health import get_health
from app.core.config import get_settings
from app.core.exceptions import setup_exception_handlers

settings = get_settings()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Intelligent Business Financial Management and Decision Support Platform API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Register centralized RFC 9457 Problem Details exception handlers
setup_exception_handlers(app)

# Configure Cross-Origin Resource Sharing (CORS)
if settings.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Root-level health check endpoint (standard container orchestration probe: GET /health)
app.add_api_route(
    "/health",
    get_health,
    methods=["GET"],
    tags=["System"],
    summary="Root Health Check",
    description="Root health endpoint for uptime monitors and load balancers.",
)

# Mount API v1 router (/api/v1/health, etc.)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/", tags=["System"], include_in_schema=False)
def root_redirect() -> dict[str, str]:
    """Root entrypoint providing basic service metadata."""
    return {
        "project": settings.PROJECT_NAME,
        "status": "online",
        "docs": "/docs",
        "health": "/health",
    }
