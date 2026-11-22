"""Registration, login and session (access token) checks. docs/api-contract.md section 3.2."""

from dataclasses import dataclass

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import Conflict, Unauthorized
from app.core.security import (
    InvalidTokenError,
    burn_password_check,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.repositories import users as users_repo
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.user import UserRead

EMAIL_UNIQUE_CONSTRAINT = "uq_users_email"
EMAIL_TAKEN_MESSAGE = "An account with this email already exists"
INVALID_CREDENTIALS_MESSAGE = "Invalid email or password"


@dataclass(frozen=True)
class AuthResult:
    """A logged-in user plus the access token the router puts in the session cookie."""

    user: UserRead
    access_token: str


def register(db: Session, data: RegisterRequest, settings: Settings) -> AuthResult:
    if users_repo.get_by_email(db, data.email) is not None:
        raise _email_taken()
    try:
        user = users_repo.create(
            db, email=data.email, name=data.name, password_hash=hash_password(data.password)
        )
        db.commit()
    except IntegrityError as exc:
        # A concurrent registration with the same email won the race.
        db.rollback()
        if _is_email_unique_violation(exc):
            raise _email_taken() from exc
        raise
    return _issue_session(user, settings)


def login(db: Session, data: LoginRequest, settings: Settings) -> AuthResult:
    # Unknown email and wrong password give the same response, in about the same time.
    user = users_repo.get_by_email(db, data.email)
    if user is None:
        burn_password_check(data.password)
        raise Unauthorized(INVALID_CREDENTIALS_MESSAGE)
    if not verify_password(user.password_hash, data.password):
        raise Unauthorized(INVALID_CREDENTIALS_MESSAGE)
    return _issue_session(user, settings)


def authenticate(db: Session, access_token: str | None, settings: Settings) -> User:
    """Resolve the session cookie to its user, or raise Unauthorized.

    Covers a missing, malformed, tampered or expired token and a user deleted since login.
    """
    if not access_token:
        raise Unauthorized()
    try:
        user_id = decode_access_token(access_token, secret=settings.jwt_secret.get_secret_value())
    except InvalidTokenError as exc:
        raise Unauthorized() from exc
    user = users_repo.get_by_id(db, user_id)
    if user is None:
        raise Unauthorized()
    return user


def _issue_session(user: User, settings: Settings) -> AuthResult:
    token = create_access_token(
        user.id,
        secret=settings.jwt_secret.get_secret_value(),
        expires_minutes=settings.jwt_expire_minutes,
    )
    return AuthResult(user=UserRead.model_validate(user), access_token=token)


def _email_taken() -> Conflict:
    return Conflict(EMAIL_TAKEN_MESSAGE, {"reason": "email_taken"})


def _is_email_unique_violation(exc: IntegrityError) -> bool:
    orig = exc.orig
    return (
        isinstance(orig, UniqueViolation) and orig.diag.constraint_name == EMAIL_UNIQUE_CONSTRAINT
    )
