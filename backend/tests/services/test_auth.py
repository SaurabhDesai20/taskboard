import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, Unauthorized
from app.core.security import verify_password
from app.repositories import users as users_repo
from app.schemas.auth import RegisterRequest
from app.services import auth as auth_service
from tests.factories import DEFAULT_PASSWORD, access_token_for, create_user


def test_register_stores_argon2_hash_and_returns_token(db_session: Session) -> None:
    result = auth_service.register(
        db_session,
        RegisterRequest(email="asha@example.com", name="Asha Rao", password=DEFAULT_PASSWORD),
        get_settings(),
    )

    stored = users_repo.get_by_id(db_session, result.user.id)
    assert stored is not None
    assert stored.email == "asha@example.com"
    assert stored.password_hash.startswith("$argon2id$")
    assert verify_password(stored.password_hash, DEFAULT_PASSWORD)
    assert auth_service.authenticate(db_session, result.access_token, get_settings()) is stored


def test_register_maps_concurrent_duplicate_to_email_taken(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-check can miss a registration that commits in between; the constraint can't."""
    create_user(db_session, email="asha@example.com")
    monkeypatch.setattr(users_repo, "get_by_email", lambda _db, _email: None)

    with pytest.raises(Conflict) as exc_info:
        auth_service.register(
            db_session,
            RegisterRequest(email="ASHA@example.com", name="Asha", password=DEFAULT_PASSWORD),
            get_settings(),
        )

    assert exc_info.value.details == {"reason": "email_taken"}
    assert exc_info.value.message == "An account with this email already exists"


@pytest.mark.parametrize("token", [None, ""])
def test_authenticate_without_token_is_unauthorized(db_session: Session, token: str | None) -> None:
    with pytest.raises(Unauthorized):
        auth_service.authenticate(db_session, token, get_settings())


def test_authenticate_returns_token_user(db_session: Session) -> None:
    user = create_user(db_session)

    assert auth_service.authenticate(db_session, access_token_for(user.id), get_settings()) is user
