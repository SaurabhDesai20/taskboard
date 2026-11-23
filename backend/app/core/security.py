"""Password hashing (argon2id) and access tokens (JWT, HS256).

Pure helpers with no HTTP or database knowledge. The cookie that carries the token is set
in app/api/cookies.py; app/services/auth.py decides when tokens are issued and accepted.
"""

from datetime import UTC, datetime, timedelta
from functools import lru_cache
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

ACCESS_TOKEN_COOKIE = "access_token"
JWT_ALGORITHM = "HS256"

# Module-level so tests can swap in cheap parameters (see tests/conftest.py).
password_hasher = PasswordHasher()


class InvalidTokenError(Exception):
    """The token is malformed, has a bad signature, is expired or lacks a valid subject."""


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


@lru_cache
def _dummy_password_hash() -> str:
    return hash_password("dummy-password-for-timing")


def burn_password_check(password: str) -> None:
    """Spend the same time as a real verify, so unknown emails can't be told apart by timing."""
    verify_password(_dummy_password_hash(), password)


def create_access_token(
    user_id: UUID, *, secret: str, expires_minutes: int, now: datetime | None = None
) -> str:
    issued_at = now or datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, *, secret: str) -> UUID:
    """Return the user id in the token's `sub` claim, or raise InvalidTokenError."""
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat", "sub"]},
        )
        return UUID(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
        raise InvalidTokenError(str(exc)) from exc
