"""RFC 9457 Problem Details domain exceptions and centralized handlers.

Conforms to RFC 9457 (Problem Details for HTTP APIs, obsoleting RFC 7807),
returning media type: application/problem+json.
"""

from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppException(Exception):
    """Base domain exception with RFC 9457 Problem Details attributes."""

    def __init__(
        self,
        detail: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        title: Optional[str] = None,
        code: Optional[str] = None,
        errors: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.title = title or self._default_title_for_status(status_code)
        self.code = code or "BAD_REQUEST"
        self.errors = errors

    @staticmethod
    def _default_title_for_status(status_code: int) -> str:
        titles = {
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            409: "Conflict",
            422: "Unprocessable Entity",
            500: "Internal Server Error",
        }
        return titles.get(status_code, "HTTP Error")


class AuthenticationError(AppException):
    """Raised when authentication credentials or token are invalid."""

    def __init__(self, detail: str = "Invalid credentials", code: str = "INVALID_CREDENTIALS") -> None:
        super().__init__(
            detail=detail,
            status_code=status.HTTP_401_UNAUTHORIZED,
            title="Unauthorized",
            code=code,
        )


class ConflictError(AppException):
    """Raised when a resource state conflict occurs (e.g. duplicate email)."""

    def __init__(self, detail: str, code: str = "RESOURCE_CONFLICT") -> None:
        super().__init__(
            detail=detail,
            status_code=status.HTTP_409_CONFLICT,
            title="Conflict",
            code=code,
        )


class BadRequestError(AppException):
    """Raised when request payload or headers fail validation."""

    def __init__(self, detail: str, code: str = "BAD_REQUEST") -> None:
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
            title="Bad Request",
            code=code,
        )


class ForbiddenError(AppException):
    """Raised when authenticated user lacks permissions for an operation."""

    def __init__(self, detail: str, code: str = "FORBIDDEN") -> None:
        super().__init__(
            detail=detail,
            status_code=status.HTTP_403_FORBIDDEN,
            title="Forbidden",
            code=code,
        )


class EntityNotFoundError(AppException):
    """Raised when a requested resource does not exist."""

    def __init__(self, detail: str = "Resource not found", code: str = "NOT_FOUND") -> None:
        super().__init__(
            detail=detail,
            status_code=status.HTTP_404_NOT_FOUND,
            title="Not Found",
            code=code,
        )


class ValidationError(AppException):
    """Raised when input validation fails domain business rules."""

    def __init__(
        self,
        detail: str,
        code: str = "VALIDATION_ERROR",
        errors: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            title="Unprocessable Entity",
            code=code,
            errors=errors,
        )


def setup_exception_handlers(app: FastAPI) -> None:
    """Register centralized RFC 9457 Problem Details exception handlers."""

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        content: Dict[str, Any] = {
            "type": f"https://errors.bizflow.ai/{exc.code.lower().replace('_', '-')}",
            "title": exc.title,
            "status": exc.status_code,
            "detail": exc.detail,
            "instance": request.url.path,
            "code": exc.code,
        }
        if exc.errors:
            content["errors"] = exc.errors

        headers = {}
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            headers["WWW-Authenticate"] = "Bearer"

        return JSONResponse(
            status_code=exc.status_code,
            content=content,
            media_type="application/problem+json",
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors_list: List[Dict[str, Any]] = []
        for err in exc.errors():
            loc = err.get("loc", ())
            # Skip initial 'body' / 'query' / 'path' prefix for cleaner field names
            field_name = ".".join(str(x) for x in loc[1:]) if len(loc) > 1 else str(loc[0]) if loc else "body"
            errors_list.append({
                "field": field_name,
                "message": err.get("msg", "Validation error"),
                "type": err.get("type", "value_error"),
            })

        content: Dict[str, Any] = {
            "type": "https://errors.bizflow.ai/validation-error",
            "title": "Unprocessable Entity",
            "status": status.HTTP_422_UNPROCESSABLE_ENTITY,
            "detail": "One or more input parameters failed validation.",
            "instance": request.url.path,
            "code": "REQUEST_VALIDATION_FAILED",
            "errors": errors_list,
        }
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=content,
            media_type="application/problem+json",
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        content: Dict[str, Any] = {
            "type": "https://errors.bizflow.ai/http-error",
            "title": AppException._default_title_for_status(exc.status_code),
            "status": exc.status_code,
            "detail": str(exc.detail),
            "instance": request.url.path,
            "code": f"HTTP_{exc.status_code}",
        }
        headers = dict(exc.headers or {})
        return JSONResponse(
            status_code=exc.status_code,
            content=content,
            media_type="application/problem+json",
            headers=headers,
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Never expose internal exception details or tracebacks in production
        content: Dict[str, Any] = {
            "type": "https://errors.bizflow.ai/internal-server-error",
            "title": "Internal Server Error",
            "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
            "detail": "An unexpected internal server error occurred. Please try again later.",
            "instance": request.url.path,
            "code": "INTERNAL_SERVER_ERROR",
        }
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=content,
            media_type="application/problem+json",
        )
