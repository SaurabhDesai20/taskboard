"""Every error leaves the API in the contract's envelope. No database needed."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import Conflict, Forbidden, NotFound, Unauthorized, ValidationFailed
from app.main import create_app


@pytest.fixture
def errors_client() -> Iterator[TestClient]:
    app: FastAPI = create_app()

    @app.get("/api/_test/not-found")
    def raise_not_found() -> None:
        raise NotFound("Task not found")

    @app.get("/api/_test/forbidden")
    def raise_forbidden() -> None:
        raise Forbidden()

    @app.get("/api/_test/unauthorized")
    def raise_unauthorized() -> None:
        raise Unauthorized()

    @app.get("/api/_test/conflict")
    def raise_conflict() -> None:
        raise Conflict("Email already registered", {"field": "email"})

    @app.get("/api/_test/field-error")
    def raise_field_error() -> None:
        raise ValidationFailed.for_field("assignee_id", "Must be a member of this workspace")

    @app.get("/api/_test/typed-query")
    def typed_query(limit: int) -> dict[str, int]:
        return {"limit": limit}

    @app.get("/api/_test/boom")
    def boom() -> None:
        raise RuntimeError("unexpected")

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.mark.parametrize(
    ("path", "status", "code", "message"),
    [
        ("/api/_test/not-found", 404, "not_found", "Task not found"),
        ("/api/_test/forbidden", 403, "forbidden", "You do not have permission to do this"),
        ("/api/_test/unauthorized", 401, "unauthorized", "Authentication required"),
    ],
)
def test_domain_errors_map_to_envelope(
    errors_client: TestClient, path: str, status: int, code: str, message: str
) -> None:
    response = errors_client.get(path)

    assert response.status_code == status
    assert response.json() == {"error": {"code": code, "message": message, "details": {}}}


def test_domain_error_details_are_passed_through(errors_client: TestClient) -> None:
    response = errors_client.get("/api/_test/conflict")

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "conflict",
        "message": "Email already registered",
        "details": {"field": "email"},
    }


def test_service_validation_error_uses_field_errors_shape(errors_client: TestClient) -> None:
    response = errors_client.get("/api/_test/field-error")

    assert response.status_code == 422
    assert response.json()["error"]["details"] == {
        "errors": [
            {
                "field": "assignee_id",
                "location": "body",
                "message": "Must be a member of this workspace",
            }
        ]
    }


def test_request_validation_error_maps_to_envelope(errors_client: TestClient) -> None:
    response = errors_client.get("/api/_test/typed-query", params={"limit": "abc"})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["message"] == "Request validation failed"
    [field_error] = error["details"]["errors"]
    assert field_error["field"] == "limit"
    assert field_error["location"] == "query"
    assert field_error["message"]


def test_unknown_route_returns_not_found_envelope(errors_client: TestClient) -> None:
    response = errors_client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "Not Found", "details": {}}
    }


def test_wrong_method_returns_method_not_allowed_envelope(errors_client: TestClient) -> None:
    response = errors_client.post("/api/_test/not-found", headers={"X-Requested-With": "taskboard"})

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"
    assert "GET" in response.headers["allow"]


def test_unexpected_exception_returns_internal_error_envelope(errors_client: TestClient) -> None:
    response = errors_client.get("/api/_test/boom")

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error", "details": {}}
    }
