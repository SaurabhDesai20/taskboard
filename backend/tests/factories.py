"""Test data builders. They write through the ORM and flush; the per-test transaction rolls back."""

import itertools
from datetime import datetime
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE, create_access_token, hash_password
from app.models.user import User

DEFAULT_PASSWORD = "correct-horse-battery"

_sequence = itertools.count(1)


def create_user(
    db: Session,
    *,
    email: str | None = None,
    name: str | None = None,
    password: str = DEFAULT_PASSWORD,
) -> User:
    n = next(_sequence)
    user = User(
        email=email or f"user{n}@example.com",
        name=name or f"User {n}",
        password_hash=hash_password(password),
    )
    db.add(user)
    db.flush()
    return user


def access_token_for(
    user_id: UUID,
    *,
    now: datetime | None = None,
    expires_minutes: int | None = None,
    secret: str | None = None,
) -> str:
    settings = get_settings()
    return create_access_token(
        user_id,
        secret=secret or settings.jwt_secret.get_secret_value(),
        expires_minutes=expires_minutes or settings.jwt_expire_minutes,
        now=now,
    )


def log_in(client: TestClient, user: User) -> None:
    """Give the client a valid session cookie for `user`, without calling /auth/login."""
    client.cookies.set(ACCESS_TOKEN_COOKIE, access_token_for(user.id))
