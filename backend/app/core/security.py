"""Cryptographic password hashing and JSON Web Token (JWT) service.

Implements:
- Direct bcrypt password hashing (cost factor 12) with explicit UTF-8 72-byte boundary checks.
- Timezone-aware UTC JWT token generation and verification using PyJWT (HS256 algorithm).
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Union
import bcrypt
import jwt
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError

settings = get_settings()

# Bcrypt strictly enforces a maximum input limit of 72 bytes.
BCRYPT_MAX_BYTES = 72
BCRYPT_ROUNDS = 12

# Valid, precomputed bcrypt cost-12 hash of a dummy string.
# Prefix: $2b$, Cost: 12, Salt: 22 chars, Checksum: 31 chars. Total length: 60 chars.
# Used for constant-work timing mitigation during nonexistent user login checks.
DUMMY_BCRYPT_HASH = "$2b$12$e8Y6lRj1ZgQ4V2zX9q5mfe.6vR1L6xGZ5q3k9V0xX1k8v2q9m7e2q"


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt with 12 salt rounds.

    Args:
        password: Raw password string.

    Returns:
        str: Bcrypt hashed password string.

    Raises:
        ValueError: If password exceeds the 72-byte UTF-8 bcrypt limit.
    """
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > BCRYPT_MAX_BYTES:
        raise ValueError(
            f"Password length ({len(password_bytes)} bytes) exceeds the bcrypt limit of {BCRYPT_MAX_BYTES} bytes."
        )

    salt = bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    hashed_bytes = bcrypt.hashpw(password_bytes, salt)
    return hashed_bytes.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Safely verify a plaintext password against a stored bcrypt hash.

    Args:
        plain_password: The plaintext password to test.
        hashed_password: Stored bcrypt hash.

    Returns:
        bool: True if password matches, False otherwise (including on malformed hashes).
    """
    try:
        password_bytes = plain_password.encode("utf-8")
        if len(password_bytes) > BCRYPT_MAX_BYTES:
            return False

        hash_bytes = hashed_password.encode("utf-8")
        return bcrypt.checkpw(password_bytes, hash_bytes)
    except (ValueError, TypeError):
        # Gracefully handle malformed, corrupted, or incompatible hash strings
        return False


def create_access_token(
    subject: Union[str, uuid.UUID],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a signed JWT access token with UTC expiration.

    Args:
        subject: Unique identifier for token holder (typically user UUID).
        expires_delta: Optional custom lifetime duration.

    Returns:
        str: Encoded, signed JWT string.

    Raises:
        ValueError: If the configured JWT_SECRET is empty or insecure.
    """
    if not settings.JWT_SECRET or len(settings.JWT_SECRET.strip()) < 16:
        raise ValueError("JWT_SECRET must be configured with a secure key of at least 16 characters.")

    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: Dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "iss": settings.PROJECT_NAME,
    }

    token = jwt.encode(
        payload,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    return token


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and cryptographically verify a JWT access token.

    Args:
        token: Raw JWT string from Authorization header.

    Returns:
        Dict[str, Any]: Verified claims dictionary.

    Raises:
        AuthenticationError: If token is expired, has an invalid signature,
                             unsupported algorithm, or is missing the subject.
    """
    try:
        payload: Dict[str, Any] = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],  # Enforce HS256 strictly
            issuer=settings.PROJECT_NAME,  # Enforce issuer verification
            options={"require": ["sub", "exp", "iat", "iss"]},
        )
        sub = payload.get("sub")
        if not sub:
            raise AuthenticationError(
                detail="Token payload is missing subject identity.",
                code="INVALID_TOKEN_CLAIMS",
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthenticationError(
            detail="Authentication token has expired. Please log in again.",
            code="TOKEN_EXPIRED",
        )
    except jwt.InvalidIssuerError:
        raise AuthenticationError(
            detail="Token issuer is invalid or does not match this application.",
            code="INVALID_TOKEN_ISSUER",
        )
    except jwt.MissingRequiredClaimError:
        raise AuthenticationError(
            detail="Token payload is missing required claims.",
            code="INVALID_TOKEN_CLAIMS",
        )
    except jwt.InvalidAlgorithmError:
        raise AuthenticationError(
            detail="Token signed with unsupported cryptographic algorithm.",
            code="INVALID_TOKEN_ALGORITHM",
        )
    except jwt.PyJWTError:
        raise AuthenticationError(
            detail="Invalid or malformed authentication token.",
            code="INVALID_TOKEN",
        )
