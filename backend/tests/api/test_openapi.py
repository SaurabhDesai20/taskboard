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


def _array_item_ref(response: dict[str, Any]) -> str:
    schema = response["content"]["application/json"]["schema"]
    assert schema["type"] == "array"
    ref: str = schema["items"]["$ref"]
    return ref.rsplit("/", 1)[-1]


def test_workspace_schema_names(openapi: dict[str, Any]) -> None:
    paths = openapi["paths"]
    collection = paths["/api/workspaces"]
    item = paths["/api/workspaces/{wid}"]

    assert _array_item_ref(collection["get"]["responses"]["200"]) == "WorkspaceRead"
    assert _ref(collection["post"]["requestBody"]) == "WorkspaceCreate"
    assert _ref(collection["post"]["responses"]["201"]) == "WorkspaceRead"
    assert _ref(item["get"]["responses"]["200"]) == "WorkspaceRead"
    assert _ref(item["patch"]["requestBody"]) == "WorkspaceUpdate"
    assert _ref(item["patch"]["responses"]["200"]) == "WorkspaceRead"
    assert "content" not in item["delete"]["responses"]["204"]


def test_member_schema_names(openapi: dict[str, Any]) -> None:
    paths = openapi["paths"]
    collection = paths["/api/workspaces/{wid}/members"]
    item = paths["/api/workspaces/{wid}/members/{uid}"]

    assert _array_item_ref(collection["get"]["responses"]["200"]) == "MemberRead"
    assert _ref(collection["post"]["requestBody"]) == "MemberCreate"
    assert _ref(collection["post"]["responses"]["201"]) == "MemberRead"
    assert _ref(item["patch"]["requestBody"]) == "MemberUpdate"
    assert _ref(item["patch"]["responses"]["200"]) == "MemberRead"
    assert "content" not in item["delete"]["responses"]["204"]
    assert {(p["name"], p["in"]) for p in item["patch"]["parameters"]} == {
        ("wid", "path"),
        ("uid", "path"),
    }


def test_workspace_and_member_shapes_match_the_contract(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]
    read_fields = {
        "WorkspaceRead": {"id", "name", "slug", "created_by", "created_at", "my_role"},
        "MemberRead": {"user_id", "email", "name", "role", "joined_at"},
    }
    for name, fields in read_fields.items():
        assert set(schemas[name]["properties"]) == fields
        assert set(schemas[name]["required"]) == fields

    assert set(schemas["WorkspaceCreate"]["properties"]) == {"name", "slug"}
    assert schemas["WorkspaceCreate"]["required"] == ["name"]
    assert set(schemas["MemberCreate"]["required"]) == {"email", "role"}
    # PATCH fields are optional but not nullable (contract 1.7).
    assert schemas["WorkspaceUpdate"]["properties"]["name"]["type"] == "string"
    assert schemas["MemberUpdate"]["properties"]["role"] == {"$ref": "#/components/schemas/Role"}
    assert "required" not in schemas["WorkspaceUpdate"]
    assert "required" not in schemas["MemberUpdate"]


def test_role_enum_is_a_named_schema(openapi: dict[str, Any]) -> None:
    role = openapi["components"]["schemas"]["Role"]

    assert role["type"] == "string"
    assert role["enum"] == ["owner", "admin", "member", "viewer"]
    for schema, field in [("WorkspaceRead", "my_role"), ("MemberRead", "role")]:
        properties = openapi["components"]["schemas"][schema]["properties"]
        assert properties[field] == {"$ref": "#/components/schemas/Role"}


def test_session_cookie_is_the_security_scheme(openapi: dict[str, Any]) -> None:
    scheme = openapi["components"]["securitySchemes"]["CookieAuth"]

    assert scheme == {
        "type": "apiKey",
        "in": "cookie",
        "name": "access_token",
        "description": scheme["description"],
    }
    assert openapi["paths"]["/api/auth/me"]["get"]["security"] == [{"CookieAuth": []}]
