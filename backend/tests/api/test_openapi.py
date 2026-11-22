"""The UI generates its types from the OpenAPI schema, so component names are part of the contract
(docs/api-contract.md, "OpenAPI schema names")."""

from typing import Any

import pytest

from app.main import create_app


@pytest.fixture(scope="module")
def openapi() -> dict[str, Any]:
    return create_app().openapi()


def _ref(schema: dict[str, Any]) -> str:
    ref: str = schema["content"]["application/json"]["schema"]["$ref"]
    return ref.rsplit("/", 1)[-1]


def test_auth_schema_names(openapi: dict[str, Any]) -> None:
    paths = openapi["paths"]
    register = paths["/api/auth/register"]["post"]
    login = paths["/api/auth/login"]["post"]

    assert _ref(register["requestBody"]) == "RegisterRequest"
    assert _ref(register["responses"]["201"]) == "UserRead"
    assert _ref(login["requestBody"]) == "LoginRequest"
    assert _ref(login["responses"]["200"]) == "UserRead"
    assert _ref(paths["/api/auth/me"]["get"]["responses"]["200"]) == "UserRead"
    assert "requestBody" not in paths["/api/auth/logout"]["post"]


def test_user_read_has_exactly_the_contract_fields(openapi: dict[str, Any]) -> None:
    user_read = openapi["components"]["schemas"]["UserRead"]

    assert set(user_read["properties"]) == {"id", "email", "name", "created_at"}
    assert set(user_read["required"]) == {"id", "email", "name", "created_at"}


def test_errors_are_documented_with_the_envelope(openapi: dict[str, Any]) -> None:
    register = openapi["paths"]["/api/auth/register"]["post"]

    for status in ("403", "409", "422"):
        assert _ref(register["responses"][status]) == "ErrorEnvelope"
    error_body = openapi["components"]["schemas"]["ErrorBody"]
    assert set(error_body["required"]) == {"code", "message", "details"}
    # FastAPI's default 422 schema does not match what the API returns.
    assert "HTTPValidationError" not in openapi["components"]["schemas"]


def test_session_cookie_is_the_security_scheme(openapi: dict[str, Any]) -> None:
    scheme = openapi["components"]["securitySchemes"]["CookieAuth"]

    assert scheme == {
        "type": "apiKey",
        "in": "cookie",
        "name": "access_token",
        "description": scheme["description"],
    }
    assert openapi["paths"]["/api/auth/me"]["get"]["security"] == [{"CookieAuth": []}]
