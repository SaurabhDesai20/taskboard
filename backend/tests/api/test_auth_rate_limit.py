"""429 `rate_limited` on POST /auth/login and /auth/register (contract sections 1.5 and 3.2).

The rest of the suite runs with the limits off; these tests build apps with small limits.
"""

from collections.abc import Callable, Iterator

import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.repositories import users as users_repo
from tests.api.helpers import assert_error
from tests.conftest import CSRF_HEADERS
from tests.factories import DEFAULT_PASSWORD, create_user

LOGIN = "/api/auth/login"
REGISTER = "/api/auth/register"
PER_IP = 4
PER_EMAIL = 2


@pytest.fixture
def limited_app(app_with: Callable[..., FastAPI]) -> FastAPI:
    return app_with(
        auth_rate_limit_per_minute=PER_IP, auth_rate_limit_per_email_per_minute=PER_EMAIL
    )


@pytest.fixture
def limited_client(limited_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(limited_app, headers=CSRF_HEADERS) as client:
        yield client


def login(client: TestClient, email: str, password: str = "wrong-password") -> httpx2.Response:
    return client.post(LOGIN, json={"email": email, "password": password})


def register(client: TestClient, n: int) -> httpx2.Response:
    body = {"email": f"new{n}@example.com", "name": f"New {n}", "password": DEFAULT_PASSWORD}
    return client.post(REGISTER, json=body)


def assert_rate_limited(response: httpx2.Response) -> int:
    """The contract's 429; returns its Retry-After."""
    assert_error(response, 429, "rate_limited")
    assert response.json()["error"]["details"] == {}
    retry_after = int(response.headers["retry-after"])
    assert 1 <= retry_after <= 60
    assert response.json()["error"]["message"] == (
        f"Too many attempts. Try again in {retry_after} second{'' if retry_after == 1 else 's'}."
    )
    assert "set-cookie" not in response.headers
    return retry_after


def test_login_attempts_per_email_are_limited(limited_client: TestClient) -> None:
    for _ in range(PER_EMAIL):
        assert login(limited_client, "asha@example.com").status_code == 401

    assert_rate_limited(login(limited_client, "asha@example.com"))
    # The email is normalized first, so changing its case or padding does not help.
    assert_rate_limited(login(limited_client, "  ASHA@example.com "))


def test_limited_login_is_refused_even_with_the_right_password(
    limited_client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, email="asha@example.com")
    for _ in range(PER_EMAIL):
        login(limited_client, user.email)

    assert_rate_limited(login(limited_client, user.email, DEFAULT_PASSWORD))


def test_other_emails_are_limited_by_ip(limited_client: TestClient) -> None:
    for n in range(PER_IP):
        assert login(limited_client, f"user{n}@example.com").status_code == 401

    assert_rate_limited(login(limited_client, "someone-else@example.com"))


def test_successful_logins_count_too(limited_client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, email="asha@example.com")
    for _ in range(PER_EMAIL):
        assert login(limited_client, user.email, DEFAULT_PASSWORD).status_code == 200

    assert_rate_limited(login(limited_client, user.email, DEFAULT_PASSWORD))


def test_invalid_login_bodies_count_against_the_ip_limit(limited_client: TestClient) -> None:
    for _ in range(PER_IP):
        assert limited_client.post(LOGIN, json={"email": "not-an-email"}).status_code == 422

    # Checked before validation: an invalid body gets the 429 as well.
    assert_rate_limited(limited_client.post(LOGIN, json={"email": "not-an-email"}))
    assert_rate_limited(login(limited_client, "asha@example.com"))


def test_requests_rejected_by_csrf_are_not_counted(limited_client: TestClient) -> None:
    for _ in range(PER_IP + 2):
        response = limited_client.post(
            LOGIN,
            json={"email": "a@example.com", "password": "x"},
            headers={"X-Requested-With": ""},
        )
        assert response.status_code == 403

    assert login(limited_client, "asha@example.com").status_code == 401


def test_registrations_are_limited_by_ip(limited_client: TestClient, db_session: Session) -> None:
    for n in range(PER_IP):
        assert register(limited_client, n).status_code == 201

    assert_rate_limited(register(limited_client, PER_IP))
    assert users_repo.get_by_email(db_session, f"new{PER_IP}@example.com") is None


def test_login_and_register_have_separate_budgets(limited_client: TestClient) -> None:
    for n in range(PER_IP):
        login(limited_client, f"user{n}@example.com")
    assert_rate_limited(login(limited_client, "user0@example.com"))

    assert register(limited_client, 0).status_code == 201


def test_limits_are_per_client_ip(limited_app: FastAPI) -> None:
    with (
        TestClient(limited_app, headers=CSRF_HEADERS, client=("10.0.0.1", 50000)) as first,
        TestClient(limited_app, headers=CSRF_HEADERS, client=("10.0.0.2", 50000)) as second,
    ):
        for _ in range(PER_EMAIL):
            login(first, "asha@example.com")
        assert_rate_limited(login(first, "asha@example.com"))

        assert login(second, "asha@example.com").status_code == 401


def test_each_app_has_its_own_limiter(app_with: Callable[..., FastAPI]) -> None:
    def fresh_client() -> TestClient:
        app = app_with(auth_rate_limit_per_minute=1, auth_rate_limit_per_email_per_minute=0)
        return TestClient(app, headers=CSRF_HEADERS)

    with fresh_client() as first:
        login(first, "asha@example.com")
        assert_rate_limited(login(first, "asha@example.com"))
    with fresh_client() as second:
        assert login(second, "asha@example.com").status_code == 401


def test_other_auth_endpoints_are_not_limited(app_with: Callable[..., FastAPI]) -> None:
    app = app_with(auth_rate_limit_per_minute=1, auth_rate_limit_per_email_per_minute=1)
    with TestClient(app, headers=CSRF_HEADERS) as client:
        for _ in range(3):
            assert client.get("/api/auth/me").status_code == 401
            assert client.post("/api/auth/logout").status_code == 401


def test_limits_are_off_in_the_test_settings(client: TestClient) -> None:
    for _ in range(30):
        assert login(client, "asha@example.com").status_code == 401
