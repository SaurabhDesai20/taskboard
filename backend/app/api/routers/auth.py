"""Auth endpoints (docs/api-contract.md section 3.2).

Register and login are rate-limited (section 1.5, 429 `rate_limited`): see app/api/rate_limit.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.api.cookies import clear_access_token_cookie, set_access_token_cookie
from app.api.deps import AppSettings, CurrentUser, DbSession, get_current_user
from app.api.rate_limit import limit_by_ip, login_body
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.errors import error_responses
from app.schemas.user import UserRead
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=UserRead,
    dependencies=[Depends(limit_by_ip("register"))],
    responses=error_responses(403, 409, 422, 429),
)
def register(
    body: RegisterRequest, response: Response, db: DbSession, settings: AppSettings
) -> UserRead:
    result = auth_service.register(db, body, settings)
    set_access_token_cookie(response, result.access_token, settings)
    return result.user


@router.post(
    "/login",
    response_model=UserRead,
    dependencies=[Depends(limit_by_ip("login"))],
    responses=error_responses(401, 403, 422, 429),
)
def login(
    body: Annotated[LoginRequest, Depends(login_body)],
    response: Response,
    db: DbSession,
    settings: AppSettings,
) -> UserRead:
    result = auth_service.login(db, body, settings)
    set_access_token_cookie(response, result.access_token, settings)
    return result.user


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user)],
    responses=error_responses(401, 403),
)
def logout(response: Response, settings: AppSettings) -> None:
    # Tokens are stateless JWTs, so logging out only clears the cookie.
    clear_access_token_cookie(response, settings)


@router.get("/me", response_model=UserRead, responses=error_responses(401))
def me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
