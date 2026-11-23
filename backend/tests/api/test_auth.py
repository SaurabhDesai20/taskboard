"""POST /auth/register, /auth/login, /auth/logout and GET /auth/me (contract section 3.2)."""

from datetime import UTC, datetime, timedelta
from http.cookies import Morsel, SimpleCookie
from typing import Any
from uuid import UUID

import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE
from app.repositories import users as users_repo
from app.schemas.user import UserRead
from tests.factories import DEFAULT_PASSWORD, access_token_for, create_user, log_in

REGISTER = "/api/auth/register"
LOGIN = "/api/auth/login"
LOGOUT = "/api/auth/logout"
ME = "/api/auth/me"

USER_FIELDS = {"id", "email", "name", "created_at"}
UNAUTHORIZED = {
    "error": {"code": "unauthorized", "message": "Authentication required", "details": {}}
}
INVALID_CREDENTIALS = {
    "error": {"code": "unauthorized", "message": "Invalid email or password", "details": {}}
}
EMAIL_TAKEN = {
    "error": {
        "code": "conflict",
        "message": "An account with this email already exists",
        "details": {"reason": "email_taken"},
    }
}


def register_payload(**overrides: str) -> dict[str, str]:
    payload = {"email": "asha@example.com", "name": "Asha Rao", "password": DEFAULT_PASSWORD}
    return payload | overrides


def session_cookie(response: httpx2.Response) -> Morsel[str]:
    [header] = response.headers.get_list("set-cookie")
    cookie = SimpleCookie()
    cookie.load(header)
    return cookie[ACCESS_TOKEN_COOKIE]


def user_json(user: Any) -> dict[str, Any]:
    return UserRead.model_validate(user).model_dump(mode="json")


def validation_fields(response: httpx2.Response) -> set[tuple[str, str]]:
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["message"] == "Request validation failed"
    errors = error["details"]["errors"]
    for item in errors:
        assert set(item) == {"field", "location", "message"}
        assert item["message"]
    return {(item["field"], item["location"]) for item in errors}


# --- register ---------------------------------------------------------------------------


def test_register_creates_user_and_sets_session_cookie(client: TestClient) -> None:
    response = client.post(REGISTER, json=register_payload())

    assert response.status_code == 201
    body = response.json()
    assert set(body) == USER_FIELDS
    assert UUID(body["id"]).version == 4
    assert body["email"] == "asha@example.com"
    assert body["name"] == "Asha Rao"
    assert body["created_at"].endswith("Z")
    cookie = session_cookie(response)
    assert cookie.value
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "lax"
    assert cookie["path"] == "/"
    assert cookie["max-age"] == str(get_settings().jwt_expire_minutes * 60)
    assert not cookie["secure"]
    me = client.get(ME)
    assert me.status_code == 200
    assert me.json() == body


def test_register_marks_cookie_secure_when_configured(app: FastAPI, client: TestClient) -> None:
    secure_settings = get_settings().model_copy(update={"cookie_secure": True})
    app.dependency_overrides[get_settings] = lambda: secure_settings

    response = client.post(REGISTER, json=register_payload())

    assert response.status_code == 201
    assert session_cookie(response)["secure"] is True


def test_register_trims_and_lowercases_email_and_trims_name(client: TestClient) -> None:
    response = client.post(
        REGISTER, json=register_payload(email="  Asha.Rao@Example.COM ", name="  Asha Rao  ")
    )

    assert response.status_code == 201
    assert response.json()["email"] == "asha.rao@example.com"
    assert response.json()["name"] == "Asha Rao"


@pytest.mark.parametrize(
    "second_email", ["asha@example.com", "ASHA@Example.com", "  Asha@EXAMPLE.com  "]
)
def test_register_duplicate_email_conflicts(client: TestClient, second_email: str) -> None:
    assert client.post(REGISTER, json=register_payload()).status_code == 201
    client.cookies.clear()

    response = client.post(REGISTER, json=register_payload(email=second_email, name="Other"))

    assert response.status_code == 409
    assert response.json() == EMAIL_TAKEN
    assert "set-cookie" not in response.headers


def test_register_validation_errors_use_contract_shape(client: TestClient) -> None:
    response = client.post(
        REGISTER, json={"email": "not-an-email", "name": "   ", "password": "short"}
    )

    assert response.status_code == 422
    assert validation_fields(response) == {
        ("email", "body"),
        ("name", "body"),
        ("password", "body"),
    }
    assert "set-cookie" not in response.headers


def test_register_missing_fields_are_reported(client: TestClient) -> None:
    response = client.post(REGISTER, json={})

    assert response.status_code == 422
    assert validation_fields(response) == {
        ("email", "body"),
        ("name", "body"),
        ("password", "body"),
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("email", "not-an-email"),
        ("email", "a" * 64 + "@" + ".".join(["b" * 60] * 4) + ".com"),  # over 254 chars
        ("name", ""),
        ("name", "   "),
        ("name", "n" * 101),
        ("password", "p" * 7),
        ("password", "p" * 129),
    ],
)
def test_register_rejects_out_of_range_fields(client: TestClient, field: str, value: str) -> None:
    response = client.post(REGISTER, json=register_payload(**{field: value}))

    assert response.status_code == 422
    assert validation_fields(response) == {(field, "body")}


@pytest.mark.parametrize(
    ("field", "value"),
    [("name", "n" * 100), ("password", "p" * 8), ("password", "p" * 128)],
)
def test_register_accepts_boundary_lengths(client: TestClient, field: str, value: str) -> None:
    response = client.post(REGISTER, json=register_payload(**{field: value}))

    assert response.status_code == 201


# --- login ------------------------------------------------------------------------------


def test_login_returns_user_and_sets_session_cookie(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, email="asha@example.com", name="Asha Rao")

    response = client.post(
        LOGIN, json={"email": "  ASHA@Example.com ", "password": DEFAULT_PASSWORD}
    )

    assert response.status_code == 200
    assert response.json() == user_json(user)
    cookie = session_cookie(response)
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "lax"
    assert cookie["path"] == "/"
    assert cookie["max-age"] == str(get_settings().jwt_expire_minutes * 60)
    assert client.get(ME).json() == user_json(user)


def test_login_wrong_password_and_unknown_email_get_identical_401(
    client: TestClient, db_session: Session
) -> None:
    create_user(db_session, email="asha@example.com")

    wrong_password = client.post(
        LOGIN, json={"email": "asha@example.com", "password": "not-the-password"}
    )
    unknown_email = client.post(
        LOGIN, json={"email": "nobody@example.com", "password": DEFAULT_PASSWORD}
    )

    for response in (wrong_password, unknown_email):
        assert response.status_code == 401
        assert response.json() == INVALID_CREDENTIALS
        assert "set-cookie" not in response.headers
    assert wrong_password.content == unknown_email.content


def test_login_validation_error(client: TestClient) -> None:
    response = client.post(LOGIN, json={"email": "not-an-email", "password": ""})

    assert response.status_code == 422
    assert validation_fields(response) == {("email", "body"), ("password", "body")}


def test_passwords_are_not_trimmed(client: TestClient) -> None:
    padded = "  padded-password  "
    assert client.post(REGISTER, json=register_payload(password=padded)).status_code == 201
    client.cookies.clear()

    trimmed = client.post(LOGIN, json={"email": "asha@example.com", "password": padded.strip()})
    exact = client.post(LOGIN, json={"email": "asha@example.com", "password": padded})

    assert trimmed.status_code == 401
    assert exact.status_code == 200


# --- logout -----------------------------------------------------------------------------


def test_logout_clears_session_cookie(client: TestClient) -> None:
    assert client.post(REGISTER, json=register_payload()).status_code == 201

    response = client.post(LOGOUT)

    assert response.status_code == 204
    assert response.content == b""
    cookie = session_cookie(response)
    assert cookie.value == ""
    assert cookie["max-age"] == "0"
    assert cookie["path"] == "/"
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "lax"
    assert client.get(ME).json() == UNAUTHORIZED


def test_logout_requires_session(client: TestClient) -> None:
    response = client.post(LOGOUT)

    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED


# --- me / get_current_user --------------------------------------------------------------


def test_me_returns_current_user(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="asha@example.com", name="Asha Rao")
    log_in(client, user)

    response = client.get(ME)

    assert response.status_code == 200
    assert response.json() == user_json(user)
    assert set(response.json()) == USER_FIELDS


def test_me_without_cookie_is_unauthorized(client: TestClient) -> None:
    response = client.get(ME)

    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED


def test_me_with_expired_token_is_unauthorized(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session)
    issued = datetime.now(UTC) - timedelta(minutes=61)
    client.cookies.set(
        ACCESS_TOKEN_COOKIE, access_token_for(user.id, now=issued, expires_minutes=60)
    )

    response = client.get(ME)

    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED


def _swap_payload(token: str, other: str) -> str:
    header, _payload, signature = token.split(".")
    return ".".join([header, other.split(".")[1], signature])


@pytest.mark.parametrize("tamper", ["other_secret", "swapped_payload", "garbage", "truncated"])
def test_me_with_tampered_token_is_unauthorized(
    client: TestClient, db_session: Session, tamper: str
) -> None:
    user = create_user(db_session)
    other = create_user(db_session)
    valid = access_token_for(user.id)
    tokens = {
        "other_secret": access_token_for(user.id, secret="another-secret-" + "x" * 32),
        "swapped_payload": _swap_payload(valid, access_token_for(other.id)),
        "garbage": "not-a-jwt",
        "truncated": valid.rsplit(".", 1)[0],
    }
    client.cookies.set(ACCESS_TOKEN_COOKIE, tokens[tamper])

    response = client.get(ME)

    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED


def test_me_for_deleted_user_is_unauthorized(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session)
    log_in(client, user)
    db_session.delete(user)
    db_session.flush()

    response = client.get(ME)

    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED


# --- password hash never leaves the API ---------------------------------------------------


def test_responses_never_include_password_or_hash(client: TestClient, db_session: Session) -> None:
    registered = client.post(REGISTER, json=register_payload())
    logged_in = client.post(LOGIN, json={"email": "asha@example.com", "password": DEFAULT_PASSWORD})
    me = client.get(ME)
    stored = users_repo.get_by_email(db_session, "asha@example.com")
    assert stored is not None

    for response in (registered, logged_in, me):
        assert response.status_code in (200, 201)
        assert set(response.json()) == USER_FIELDS
        assert "password" not in response.text
        assert DEFAULT_PASSWORD not in response.text
        assert stored.password_hash not in response.text
