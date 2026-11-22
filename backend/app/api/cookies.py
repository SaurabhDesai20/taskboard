"""The session cookie (docs/api-contract.md section 1.3)."""

from starlette.responses import Response

from app.core.config import Settings
from app.core.security import ACCESS_TOKEN_COOKIE


def set_access_token_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        ACCESS_TOKEN_COOKIE,
        token,
        max_age=settings.jwt_expire_minutes * 60,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )


def clear_access_token_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        ACCESS_TOKEN_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )
