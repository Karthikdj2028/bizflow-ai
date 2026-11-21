"""Unit tests for password hashing service and JWT token handling.

Verifies:
- Bcrypt cost factor 12 hashing and verification.
- Enforcing the 72-byte UTF-8 limit (acceptance at boundary, rejection when exceeding).
- Multi-byte Unicode password handling.
- Graceful handling of malformed stored hashes without throwing unhandled exceptions.
- JWT creation with UTC claims, validation of signatures, expiration, algorithm restrictions (HS256).
"""

from datetime import timedelta
import secrets
import uuid
import bcrypt
import pytest
import jwt
from pydantic import ValidationError
from app.core.config import get_settings, Settings, INSECURE_DEV_JWT_SECRET
from app.core.exceptions import AuthenticationError
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    BCRYPT_MAX_BYTES,
    DUMMY_BCRYPT_HASH,
)

settings = get_settings()


# ==============================================================================
# Password Hashing & Verification Tests
# ==============================================================================

def test_hash_password_success() -> None:
    """Verify that hash_password returns a valid bcrypt hash string."""
    raw_pwd = "SecurePassword123!"
    hashed = hash_password(raw_pwd)

    assert hashed is not None
    assert hashed != raw_pwd
    assert hashed.startswith("$2b$12$")  # bcrypt identifier with 12 cost rounds


def test_verify_password_correct() -> None:
    """Verify that correct password verification succeeds."""
    raw_pwd = "MySecretPassphrase456"
    hashed = hash_password(raw_pwd)

    assert verify_password(raw_pwd, hashed) is True


def test_verify_password_incorrect() -> None:
    """Verify that incorrect password verification fails."""
    raw_pwd = "CorrectPassword"
    wrong_pwd = "WrongPassword"
    hashed = hash_password(raw_pwd)

    assert verify_password(wrong_pwd, hashed) is False


def test_password_72_byte_exact_boundary() -> None:
    """Verify that a password of exactly 72 bytes is successfully hashed and verified."""
    exact_72_bytes_pwd = "A" * BCRYPT_MAX_BYTES
    assert len(exact_72_bytes_pwd.encode("utf-8")) == 72

    hashed = hash_password(exact_72_bytes_pwd)
    assert verify_password(exact_72_bytes_pwd, hashed) is True


def test_password_exceeding_72_bytes_rejected() -> None:
    """Verify that passwords exceeding 72 UTF-8 bytes are rejected by hash_password."""
    oversized_pwd = "A" * (BCRYPT_MAX_BYTES + 1)
    assert len(oversized_pwd.encode("utf-8")) == 73

    with pytest.raises(ValueError, match="exceeds the bcrypt limit of 72 bytes"):
        hash_password(oversized_pwd)


def test_unicode_multi_byte_password_handling() -> None:
    """Verify handling of multi-byte UTF-8 characters (e.g. Rupee ₹ = 3 bytes, emojis = 4 bytes)."""
    # '₹' is 3 bytes in UTF-8
    unicode_pwd = "RupeeKey₹2026_Secure!"
    byte_len = len(unicode_pwd.encode("utf-8"))
    assert byte_len > len(unicode_pwd)  # Byte count exceeds character count

    hashed = hash_password(unicode_pwd)
    assert verify_password(unicode_pwd, hashed) is True
    assert verify_password("RupeeKey$2026_Secure!", hashed) is False


def test_unicode_password_byte_boundary_calculation() -> None:
    """Verify byte calculation for unicode characters: 24 '₹' symbols = 72 bytes."""
    # 24 * 3 bytes = 72 bytes
    pwd_24_rupees = "₹" * 24
    assert len(pwd_24_rupees.encode("utf-8")) == 72

    hashed = hash_password(pwd_24_rupees)
    assert verify_password(pwd_24_rupees, hashed) is True

    # 25 * 3 bytes = 75 bytes -> must be rejected
    pwd_25_rupees = "₹" * 25
    assert len(pwd_25_rupees.encode("utf-8")) == 75
    with pytest.raises(ValueError, match="exceeds the bcrypt limit"):
        hash_password(pwd_25_rupees)


def test_verify_password_malformed_hash() -> None:
    """Verify that malformed or non-bcrypt hashes return False without crashing."""
    assert verify_password("password", "invalid_plain_string") is False
    assert verify_password("password", "$2b$invalid_hash_string") is False
    assert verify_password("password", "") is False


# ==============================================================================
# JWT Generation & Decoding Tests
# ==============================================================================

def test_jwt_create_and_decode_valid() -> None:
    """Verify that create_access_token produces a decodable token with subject."""
    test_uuid = uuid.uuid4()
    token = create_access_token(subject=test_uuid)

    claims = decode_access_token(token)
    assert claims["sub"] == str(test_uuid)
    assert "exp" in claims
    assert "iat" in claims
    assert claims["iss"] == settings.PROJECT_NAME


def test_jwt_expiration() -> None:
    """Verify that an expired token raises AuthenticationError with TOKEN_EXPIRED code."""
    test_uuid = uuid.uuid4()
    # Create token that expired 10 minutes ago
    expired_token = create_access_token(
        subject=test_uuid,
        expires_delta=timedelta(minutes=-10),
    )

    with pytest.raises(AuthenticationError) as exc_info:
        decode_access_token(expired_token)
    assert exc_info.value.code == "TOKEN_EXPIRED"
    assert exc_info.value.status_code == 401


def test_jwt_invalid_signature() -> None:
    """Verify that token signed with a different key is rejected."""
    test_uuid = uuid.uuid4()
    # Sign token using an unauthorized rogue secret with valid required claims
    rogue_token = jwt.encode(
        {
            "sub": str(test_uuid),
            "exp": 9999999999,
            "iat": 1000000000,
            "iss": settings.PROJECT_NAME,
        },
        "rogue-unauthorized-secret-key-12345",
        algorithm="HS256",
    )

    with pytest.raises(AuthenticationError) as exc_info:
        decode_access_token(rogue_token)
    assert exc_info.value.code == "INVALID_TOKEN"
    assert exc_info.value.status_code == 401


def test_jwt_unsupported_algorithm_rejected() -> None:
    """Verify that algorithm confusion attacks (e.g. none or RS256) are rejected."""
    test_uuid = uuid.uuid4()
    # Attempt algorithm: 'none'
    none_token = jwt.encode(
        {
            "sub": str(test_uuid),
            "exp": 9999999999,
            "iat": 1000000000,
            "iss": settings.PROJECT_NAME,
        },
        key="",
        algorithm="none",
    )

    with pytest.raises(AuthenticationError):
        decode_access_token(none_token)


def test_jwt_missing_subject_rejected() -> None:
    """Verify that a token missing the 'sub' identity claim is rejected."""
    bad_payload = {"exp": 9999999999, "iat": 1000000000, "iss": settings.PROJECT_NAME}
    token_no_sub = jwt.encode(bad_payload, settings.JWT_SECRET, algorithm="HS256")

    with pytest.raises(AuthenticationError) as exc_info:
        decode_access_token(token_no_sub)
    assert exc_info.value.code == "INVALID_TOKEN_CLAIMS"


def test_jwt_malformed_string_rejected() -> None:
    """Verify that an arbitrary malformed string is rejected."""
    with pytest.raises(AuthenticationError) as exc_info:
        decode_access_token("this.is.not.a.valid.jwt")
    assert exc_info.value.code == "INVALID_TOKEN"


# ==============================================================================
# Security Hardening & Settings Configuration Validation Tests
# ==============================================================================

def test_settings_production_rejects_default_secret() -> None:
    """Verify that Settings rejects the known default development JWT_SECRET when in production."""
    with pytest.raises(ValidationError, match="cannot use the development fallback default"):
        Settings(
            APP_ENV="production",
            DEBUG=False,
            JWT_SECRET=INSECURE_DEV_JWT_SECRET,
        )


def test_settings_production_rejects_short_secret() -> None:
    """Verify that Settings rejects a JWT_SECRET with fewer than 32 bytes in production."""
    short_secret = "short-key-less-than-32-bytes"
    assert len(short_secret.encode("utf-8")) < 32

    with pytest.raises(ValidationError, match="too short. Minimum requirement is 32 bytes"):
        Settings(
            APP_ENV="production",
            DEBUG=False,
            JWT_SECRET=short_secret,
        )


def test_settings_production_rejects_low_entropy_heuristic() -> None:
    """Verify that Settings rejects low-entropy repetitive secrets (weak-key heuristic) in production."""
    low_entropy_secret = "a" * 32
    assert len(low_entropy_secret.encode("utf-8")) == 32

    with pytest.raises(ValidationError, match="failed weak-key heuristic"):
        Settings(
            APP_ENV="production",
            DEBUG=False,
            JWT_SECRET=low_entropy_secret,
        )


def test_settings_production_rejects_debug_true() -> None:
    """Verify that Settings rejects DEBUG=True when in production environment."""
    valid_secret = secrets.token_urlsafe(32)

    with pytest.raises(ValidationError, match="DEBUG must be set to False when APP_ENV='production'"):
        Settings(
            APP_ENV="production",
            DEBUG=True,
            JWT_SECRET=valid_secret,
        )


def test_settings_rejects_non_hs256_algorithm() -> None:
    """Verify that Settings enforces strict HS256 algorithm lockdown."""
    with pytest.raises(ValidationError, match="Only 'HS256' is permitted"):
        Settings(JWT_ALGORITHM="none")

    with pytest.raises(ValidationError, match="Only 'HS256' is permitted"):
        Settings(JWT_ALGORITHM="HS384")

    with pytest.raises(ValidationError, match="Only 'HS256' is permitted"):
        Settings(JWT_ALGORITHM="RS256")


def test_settings_development_accepts_default_secret() -> None:
    """Verify that Settings allows convenient default secret in development environment."""
    cfg = Settings(APP_ENV="development")
    assert cfg.APP_ENV == "development"
    assert cfg.JWT_SECRET == INSECURE_DEV_JWT_SECRET


def test_settings_test_accepts_test_environment() -> None:
    """Verify that Settings allows test environment configuration."""
    cfg = Settings(APP_ENV="test")
    assert cfg.APP_ENV == "test"


def test_jwt_issuer_valid() -> None:
    """Verify that a valid token includes issuer claim and decodes successfully."""
    test_uuid = uuid.uuid4()
    token = create_access_token(test_uuid)
    payload = decode_access_token(token)

    assert payload["sub"] == str(test_uuid)
    assert payload["iss"] == settings.PROJECT_NAME


def test_jwt_issuer_mismatched_rejected() -> None:
    """Verify that a token with an unauthorized issuer claim is rejected with INVALID_TOKEN_ISSUER."""
    test_uuid = uuid.uuid4()
    forged_token = jwt.encode(
        {
            "sub": str(test_uuid),
            "exp": 9999999999,
            "iat": 1000000000,
            "iss": "RogueUntrustedApplication",
        },
        settings.JWT_SECRET,
        algorithm="HS256",
    )

    with pytest.raises(AuthenticationError) as exc_info:
        decode_access_token(forged_token)
    assert exc_info.value.code == "INVALID_TOKEN_ISSUER"
    assert exc_info.value.status_code == 401


def test_jwt_missing_issuer_rejected() -> None:
    """Verify that a token missing the required 'iss' claim is rejected with INVALID_TOKEN_CLAIMS."""
    test_uuid = uuid.uuid4()
    token_without_iss = jwt.encode(
        {
            "sub": str(test_uuid),
            "exp": 9999999999,
            "iat": 1000000000,
        },
        settings.JWT_SECRET,
        algorithm="HS256",
    )

    with pytest.raises(AuthenticationError) as exc_info:
        decode_access_token(token_without_iss)
    assert exc_info.value.code == "INVALID_TOKEN_CLAIMS"
    assert exc_info.value.status_code == 401


def test_dummy_bcrypt_hash_cost_12() -> None:
    """Verify that DUMMY_BCRYPT_HASH is a valid bcrypt hash with cost 12 that verifies cleanly."""
    parts = DUMMY_BCRYPT_HASH.split("$")
    assert parts[1] == "2b"
    assert int(parts[2]) == 12
    assert len(DUMMY_BCRYPT_HASH) == 60

    # Ensure bcrypt verification executes without malformed hash errors and returns False
    result = verify_password("some_random_password_xyz", DUMMY_BCRYPT_HASH)
    assert result is False
