"""Shared FastAPI dependencies.

Phase 2 adds require_role(min_role).
"""

from typing import Annotated

from fastapi import Depends
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import ACCESS_TOKEN_COOKIE
from app.db.session import get_db
from app.models.user import User
from app.services import auth as auth_service

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]

# Reads the cookie and documents it as the OpenAPI security scheme. auto_error=False so that
# a missing cookie reaches the auth service and gets the contract's 401 envelope.
access_token_cookie = APIKeyCookie(
    name=ACCESS_TOKEN_COOKIE,
    scheme_name="CookieAuth",
    description="httpOnly session cookie set by POST /api/auth/register and /api/auth/login",
    auto_error=False,
)


def get_current_user(
    db: DbSession,
    settings: AppSettings,
    access_token: Annotated[str | None, Depends(access_token_cookie)],
) -> User:
    """The logged-in user. 401 `unauthorized` for a missing, invalid or expired cookie."""
    return auth_service.authenticate(db, access_token, settings)


CurrentUser = Annotated[User, Depends(get_current_user)]

__all__ = ["AppSettings", "CurrentUser", "DbSession", "get_current_user", "get_db"]
