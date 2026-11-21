"""Application settings and environment configuration management.

Uses Pydantic BaseSettings to load and validate environment variables with
type safety and explicit fallback defaults for local development.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, List
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEV_JWT_SECRET = "development-insecure-secret-key-at-least-32-bytes-long"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
ROOT_ENV_PATH = REPO_ROOT / ".env"


def resolve_env_file() -> str | None:
    """Resolve canonical .env path, supporting standard BIZFLOW_ENV_FILE override."""
    override = os.getenv("BIZFLOW_ENV_FILE")
    if override is not None:
        return override if override and override.lower() != "none" else None
    return str(ROOT_ENV_PATH)


class Settings(BaseSettings):
    """Global application settings schema."""

    # Application Metadata
    PROJECT_NAME: str = "BizFlow AI"
    APP_ENV: str = "development"
    DEBUG: bool = True
    PORT: int = 8000
    HOST: str = "127.0.0.1"
    API_V1_PREFIX: str = "/api/v1"

    # Database Configuration (PostgreSQL 16+ via Psycopg 3)
    DATABASE_URL: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/bizflow_dev",
        description="SQLAlchemy synchronous connection URL for PostgreSQL",
    )

    # Authentication & Security
    JWT_SECRET: str = Field(
        default="development-insecure-secret-key-at-least-32-bytes-long",
        description="Cryptographic secret key for signing JWT tokens",
    )
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15

    # Default Workspace Currency
    DEFAULT_CURRENCY: str = "INR"

    # CORS Whitelist
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    model_config = SettingsConfigDict(
        env_file=str(ROOT_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    def __init__(self, *args, **kwargs):
        if "_env_file" not in kwargs:
            kwargs["_env_file"] = resolve_env_file()
        super().__init__(*args, **kwargs)

    @model_validator(mode="after")
    def validate_security_configuration(self) -> "Settings":
        """Validate critical security configurations across environments."""
        # 1. Strict Algorithm Lockdown: Only HS256 is permitted
        if self.JWT_ALGORITHM != "HS256":
            raise ValueError(
                f"Unsupported JWT_ALGORITHM '{self.JWT_ALGORITHM}'. Only 'HS256' is permitted."
            )

        env = self.APP_ENV.lower().strip()
        if env == "production":
            # 2. Reject default development secret
            if not self.JWT_SECRET or self.JWT_SECRET == INSECURE_DEV_JWT_SECRET:
                raise ValueError(
                    "CRITICAL SECURITY CONFIGURATION ERROR: When APP_ENV='production', "
                    "JWT_SECRET must be explicitly set via environment variable and cannot "
                    "use the development fallback default."
                )

            # 3. Minimum Byte Length (at least 32 bytes = 256 bits)
            secret_bytes = self.JWT_SECRET.encode("utf-8")
            if len(secret_bytes) < 32:
                raise ValueError(
                    f"CRITICAL SECURITY CONFIGURATION ERROR: Production JWT_SECRET length "
                    f"({len(secret_bytes)} bytes) is too short. Minimum requirement is 32 bytes."
                )

            # 4. Weak-Secret Heuristic Guard (Note: Does not prove true entropy; guards against trivial repetition)
            distinct_chars = len(set(self.JWT_SECRET))
            if distinct_chars < 16:
                raise ValueError(
                    f"CRITICAL SECURITY CONFIGURATION ERROR: Production JWT_SECRET failed weak-key heuristic "
                    f"({distinct_chars} distinct characters). Generate a secure random key using "
                    "`python -c 'import secrets; print(secrets.token_urlsafe(32))'`."
                )

            # 5. Production Debug Guard
            if self.DEBUG:
                raise ValueError(
                    "CRITICAL SECURITY CONFIGURATION ERROR: DEBUG must be set to False when APP_ENV='production'."
                )

        return self


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings instance.

    Uses lru_cache to avoid reading the .env file repeatedly across requests.
    """
    return Settings()


def configure_alembic_url(alembic_cfg: Any, fallback_url: str | None = None) -> str:
    """Ensure Alembic Config has a valid, percent-escaped sqlalchemy.url.

    If sqlalchemy.url is already set (e.g. by test runner), preserves it unchanged.
    If unset, populates it from fallback_url (or get_settings().DATABASE_URL)
    with percent characters escaped as '%%' for ConfigParser compatibility.

    Returns:
        str: The effective unescaped URL retrieved from Alembic Config.
    """
    existing_url = alembic_cfg.get_main_option("sqlalchemy.url")
    if not existing_url:
        url_to_set = fallback_url or get_settings().DATABASE_URL
        alembic_cfg.set_main_option("sqlalchemy.url", url_to_set.replace("%", "%%"))
    return alembic_cfg.get_main_option("sqlalchemy.url")
