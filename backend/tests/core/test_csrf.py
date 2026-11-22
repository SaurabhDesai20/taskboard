"""CSRF header check (contract section 1.4): before routing, validation and authentication."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.repositories import users as users_repo
from tests.factories import DEFAULT_PASSWORD

CSRF_REJECTED = {
    "error": {
        "code": "forbidden",
        "message": "Missing or invalid X-Requested-With header",
        "details": {"reason": "csrf"},
    }
}
REGISTER_BODY = {"email": "asha@example.com", "name": "Asha Rao", "password": DEFAULT_PASSWORD}


@pytest.fixture
def bare_client(client: TestClient) -> TestClient:
    """A client that does not send the CSRF header by default."""
    del client.headers["X-Requested-With"]
    return client


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_mutating_request_without_header_is_rejected(bare_client: TestClient, method: str) -> None:
    response = bare_client.request(method, "/api/auth/register", json=REGISTER_BODY)

    assert response.status_code == 403
    assert response.json() == CSRF_REJECTED


@pytest.mark.parametrize("value", ["", "XMLHttpRequest", "Taskboard", "taskboard, taskboard"])
def test_mutating_request_with_wrong_header_value_is_rejected(
    client: TestClient, value: str
) -> None:
    response = client.post(
        "/api/auth/register", json=REGISTER_BODY, headers={"X-Requested-With": value}
    )

    assert response.status_code == 403
    assert response.json() == CSRF_REJECTED


def test_rejected_request_has_no_effect(bare_client: TestClient, db_session: Session) -> None:
    bare_client.post("/api/auth/register", json=REGISTER_BODY)

    assert users_repo.get_by_email(db_session, "asha@example.com") is None


def test_csrf_is_checked_before_authentication(bare_client: TestClient) -> None:
    response = bare_client.post("/api/auth/logout")

    assert response.status_code == 403
    assert response.json() == CSRF_REJECTED


def test_csrf_is_checked_before_validation(bare_client: TestClient) -> None:
    response = bare_client.post("/api/auth/register", json={"email": "bad"})

    assert response.status_code == 403
    assert response.json() == CSRF_REJECTED


def test_header_name_is_case_insensitive(bare_client: TestClient) -> None:
    response = bare_client.post(
        "/api/auth/register", json=REGISTER_BODY, headers={"x-requested-with": "taskboard"}
    )

    assert response.status_code == 201


def test_safe_methods_do_not_need_the_header(bare_client: TestClient) -> None:
    assert bare_client.get("/api/health").status_code == 200
    # Reaches authentication, so the 401 (not a 403) proves the CSRF check was skipped.
    assert bare_client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("path", ["/not-api", "/apix/thing"])
def test_paths_outside_api_are_not_checked(bare_client: TestClient, path: str) -> None:
    response = bare_client.post(path)

    assert response.status_code == 404
