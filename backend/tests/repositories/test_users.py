import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.repositories import users as users_repo
from tests.factories import create_user


def test_create_sets_id_and_created_at(db_session: Session) -> None:
    user = users_repo.create(
        db_session, email="asha@example.com", name="Asha Rao", password_hash="hash"
    )

    assert user.id is not None
    assert user.created_at.tzinfo is not None
    assert users_repo.get_by_id(db_session, user.id) is user


def test_get_by_email_is_case_insensitive(db_session: Session) -> None:
    user = create_user(db_session, email="asha@example.com")

    assert users_repo.get_by_email(db_session, "ASHA@Example.COM") is user
    assert users_repo.get_by_email(db_session, "nobody@example.com") is None


def test_email_uniqueness_ignores_case(db_session: Session) -> None:
    create_user(db_session, email="asha@example.com")

    with pytest.raises(IntegrityError):
        create_user(db_session, email="ASHA@example.com")
