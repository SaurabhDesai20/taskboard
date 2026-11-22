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


def test_project_schema_names(openapi: dict[str, Any]) -> None:
    paths = openapi["paths"]
    collection = paths["/api/workspaces/{wid}/projects"]
    item = paths["/api/projects/{pid}"]
    archive = paths["/api/projects/{pid}/archive"]["post"]

    assert _array_item_ref(collection["get"]["responses"]["200"]) == "ProjectRead"
    assert _ref(collection["post"]["requestBody"]) == "ProjectCreate"
    assert _ref(collection["post"]["responses"]["201"]) == "ProjectRead"
    assert _ref(item["get"]["responses"]["200"]) == "ProjectRead"
    assert _ref(item["patch"]["requestBody"]) == "ProjectUpdate"
    assert _ref(item["patch"]["responses"]["200"]) == "ProjectRead"
    assert _ref(archive["responses"]["200"]) == "ProjectRead"
    assert "requestBody" not in archive
    for operation in (item["get"], item["patch"], archive):
        assert [(p["name"], p["in"]) for p in operation["parameters"]] == [("pid", "path")]
    include_archived = collection["get"]["parameters"][1]
    assert (include_archived["name"], include_archived["in"]) == ("include_archived", "query")
    assert include_archived["required"] is False
    assert include_archived["schema"]["type"] == "boolean"
    assert include_archived["schema"]["default"] is False


def test_project_shapes_match_the_contract(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]
    read = schemas["ProjectRead"]
    fields = {
        "id",
        "workspace_id",
        "name",
        "key",
        "description",
        "archived_at",
        "created_by",
        "created_at",
    }

    assert set(read["properties"]) == fields
    assert set(read["required"]) == fields
    for nullable in ("description", "archived_at"):
        assert {"type": "null"} in read["properties"][nullable]["anyOf"]
    assert set(schemas["ProjectCreate"]["properties"]) == {"name", "key", "description"}
    assert set(schemas["ProjectCreate"]["required"]) == {"name", "key"}
    assert schemas["ProjectCreate"]["properties"]["key"]["pattern"] == "^[A-Z][A-Z0-9]{1,9}$"
    # The key is immutable, so it is not part of the PATCH body.
    update = schemas["ProjectUpdate"]
    assert set(update["properties"]) == {"name", "description"}
    assert "required" not in update
    # PATCH fields are optional; only description can be cleared with null (contract 1.7).
    assert update["properties"]["name"]["type"] == "string"
    assert {"type": "null"} in update["properties"]["description"]["anyOf"]


def test_task_schema_names(openapi: dict[str, Any]) -> None:
    paths = openapi["paths"]
    collection = paths["/api/projects/{pid}/tasks"]
    item = paths["/api/tasks/{tid}"]
    move = paths["/api/tasks/{tid}/move"]["post"]

    assert _array_item_ref(collection["get"]["responses"]["200"]) == "TaskRead"
    assert _ref(collection["post"]["requestBody"]) == "TaskCreate"
    assert _ref(collection["post"]["responses"]["201"]) == "TaskRead"
    assert _ref(item["get"]["responses"]["200"]) == "TaskRead"
    assert _ref(item["patch"]["requestBody"]) == "TaskUpdate"
    assert _ref(item["patch"]["responses"]["200"]) == "TaskRead"
    assert "content" not in item["delete"]["responses"]["204"]
    assert _ref(move["requestBody"]) == "TaskMoveRequest"
    assert _ref(move["responses"]["200"]) == "TaskRead"
    my_tasks = paths["/api/me/tasks"]["get"]
    assert _array_item_ref(my_tasks["responses"]["200"]) == "MyTaskRead"
    assert my_tasks["security"] == [{"CookieAuth": []}]
    for operation in (item["get"], item["patch"], item["delete"], move):
        assert [(p["name"], p["in"]) for p in operation["parameters"]] == [("tid", "path")]
    for status in ("403", "404", "409", "422"):
        assert _ref(move["responses"][status]) == "ErrorEnvelope"


def test_task_list_query_parameters(openapi: dict[str, Any]) -> None:
    def query(path: str) -> dict[str, dict[str, Any]]:
        parameters = openapi["paths"][path]["get"]["parameters"]
        return {p["name"]: p for p in parameters if p["in"] == "query"}

    tasks = query("/api/projects/{pid}/tasks")
    mine = query("/api/me/tasks")

    assert list(tasks) == ["status", "priority", "assignee_id", "due_before", "q"]
    assert list(mine) == ["status", "due_before"]
    assert all(p["required"] is False for p in [*tasks.values(), *mine.values()])
    for name, enum in (("status", "TaskStatus"), ("priority", "TaskPriority")):
        array = tasks[name]["schema"]["anyOf"][0]
        assert array == {"type": "array", "items": {"$ref": f"#/components/schemas/{enum}"}}
    assert mine["status"]["schema"] == tasks["status"]["schema"]
    assert tasks["assignee_id"]["schema"]["anyOf"][:2] == [
        {"type": "string", "format": "uuid"},
        {"type": "string", "enum": ["none"]},
    ]
    assert tasks["due_before"]["schema"]["anyOf"][0] == {"type": "string", "format": "date"}
    q = tasks["q"]["schema"]["anyOf"][0]
    assert (q["minLength"], q["maxLength"]) == (1, 200)


def test_task_shapes_match_the_contract(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]
    task_fields = {
        "id",
        "project_id",
        "workspace_id",
        "number",
        "key",
        "title",
        "description",
        "status",
        "priority",
        "position",
        "assignee",
        "due_date",
        "comment_count",
        "created_by",
        "created_at",
        "updated_at",
    }
    read_fields = {
        "TaskRead": task_fields,
        "MyTaskRead": task_fields | {"project", "workspace"},
        "UserRef": {"id", "name"},
        "ProjectRef": {"id", "name", "key"},
        "WorkspaceRef": {"id", "name", "slug"},
    }
    for name, fields in read_fields.items():
        assert set(schemas[name]["properties"]) == fields, name
        assert set(schemas[name]["required"]) == fields, name

    read = schemas["TaskRead"]["properties"]
    for nullable in ("description", "due_date"):
        assert {"type": "null"} in read[nullable]["anyOf"]
    assert read["assignee"]["anyOf"] == [
        {"$ref": "#/components/schemas/UserRef"},
        {"type": "null"},
    ]
    assert read["status"] == {"$ref": "#/components/schemas/TaskStatus"}
    assert read["priority"] == {"$ref": "#/components/schemas/TaskPriority"}
    assert read["position"]["type"] == "number"
    my_task = schemas["MyTaskRead"]["properties"]
    assert my_task["project"] == {"$ref": "#/components/schemas/ProjectRef"}
    assert my_task["workspace"] == {"$ref": "#/components/schemas/WorkspaceRef"}

    create = schemas["TaskCreate"]
    assert set(create["properties"]) == {
        "title",
        "description",
        "status",
        "priority",
        "assignee_id",
        "due_date",
    }
    assert create["required"] == ["title"]
    assert create["properties"]["status"]["default"] == "todo"
    assert create["properties"]["priority"]["default"] == "medium"

    # PATCH: everything optional; only description, assignee_id and due_date are nullable.
    update = schemas["TaskUpdate"]
    assert set(update["properties"]) == set(create["properties"])
    assert "required" not in update
    assert update["properties"]["title"]["type"] == "string"
    assert update["properties"]["status"] == {"$ref": "#/components/schemas/TaskStatus"}
    assert update["properties"]["priority"] == {"$ref": "#/components/schemas/TaskPriority"}
    for nullable in ("description", "assignee_id", "due_date"):
        assert {"type": "null"} in update["properties"][nullable]["anyOf"]

    move = schemas["TaskMoveRequest"]
    assert set(move["properties"]) == {"status", "after_task_id", "before_task_id"}
    assert move["required"] == ["status"]


def test_comment_schema_names(openapi: dict[str, Any]) -> None:
    paths = openapi["paths"]
    collection = paths["/api/tasks/{tid}/comments"]
    item = paths["/api/comments/{cid}"]

    assert _ref(collection["get"]["responses"]["200"]) == "CommentPage"
    assert _ref(collection["post"]["requestBody"]) == "CommentCreate"
    assert _ref(collection["post"]["responses"]["201"]) == "CommentRead"
    assert _ref(item["patch"]["requestBody"]) == "CommentUpdate"
    assert _ref(item["patch"]["responses"]["200"]) == "CommentRead"
    assert "content" not in item["delete"]["responses"]["204"]
    assert [(p["name"], p["in"]) for p in collection["post"]["parameters"]] == [("tid", "path")]
    for operation in (item["patch"], item["delete"]):
        assert [(p["name"], p["in"]) for p in operation["parameters"]] == [("cid", "path")]
        assert operation["security"] == [{"CookieAuth": []}]
    for status in ("403", "404", "409", "422"):
        assert _ref(item["patch"]["responses"][status]) == "ErrorEnvelope"
    # A plain named schema, not a generic Page[...] name.
    assert not any("[" in name for name in openapi["components"]["schemas"])


def test_comment_list_pagination_parameters(openapi: dict[str, Any]) -> None:
    parameters = openapi["paths"]["/api/tasks/{tid}/comments"]["get"]["parameters"]
    query = {p["name"]: p for p in parameters if p["in"] == "query"}

    assert list(query) == ["limit", "cursor"]
    assert all(p["required"] is False for p in query.values())
    limit = query["limit"]["schema"]
    assert (limit["type"], limit["minimum"], limit["maximum"], limit["default"]) == (
        "integer",
        1,
        100,
        20,
    )
    assert query["cursor"]["schema"]["anyOf"] == [{"type": "string"}, {"type": "null"}]


def test_comment_shapes_match_the_contract(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]
    read_fields = {
        "CommentRead": {"id", "task_id", "author", "body", "created_at", "edited_at"},
        "CommentPage": {"items", "next_cursor"},
    }
    for name, fields in read_fields.items():
        assert set(schemas[name]["properties"]) == fields, name
        assert set(schemas[name]["required"]) == fields, name

    read = schemas["CommentRead"]["properties"]
    assert read["author"] == {"$ref": "#/components/schemas/UserRef"}
    assert {"type": "null"} in read["edited_at"]["anyOf"]
    page = schemas["CommentPage"]["properties"]
    assert page["items"]["items"] == {"$ref": "#/components/schemas/CommentRead"}
    assert page["next_cursor"]["anyOf"] == [{"type": "string"}, {"type": "null"}]

    create = schemas["CommentCreate"]
    assert set(create["properties"]) == {"body"}
    assert create["required"] == ["body"]
    body = create["properties"]["body"]
    assert (body["type"], body["minLength"], body["maxLength"]) == ("string", 1, 5000)
    # PATCH: the body is optional but not nullable (contract 1.7).
    update = schemas["CommentUpdate"]
    assert set(update["properties"]) == {"body"}
    assert "required" not in update
    assert update["properties"]["body"]["type"] == "string"


def test_task_enums_are_named_schemas(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]

    assert schemas["TaskStatus"]["type"] == "string"
    assert schemas["TaskStatus"]["enum"] == ["todo", "in_progress", "in_review", "done"]
    assert schemas["TaskPriority"]["type"] == "string"
    assert schemas["TaskPriority"]["enum"] == ["low", "medium", "high", "urgent"]


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


def test_activity_schema_names(openapi: dict[str, Any]) -> None:
    operation = openapi["paths"]["/api/workspaces/{wid}/activity"]["get"]

    assert _ref(operation["responses"]["200"]) == "ActivityPage"
    for status in ("401", "404", "422"):
        assert _ref(operation["responses"][status]) == "ErrorEnvelope"
    assert operation["security"] == [{"CookieAuth": []}]
    assert [(p["name"], p["in"]) for p in operation["parameters"]] == [
        ("wid", "path"),
        ("project_id", "query"),
        ("task_id", "query"),
        ("actor_id", "query"),
        ("limit", "query"),
        ("cursor", "query"),
    ]
    query = {p["name"]: p for p in operation["parameters"] if p["in"] == "query"}
    assert all(p["required"] is False for p in query.values())
    for name in ("project_id", "task_id", "actor_id"):
        assert query[name]["schema"]["anyOf"][0] == {"type": "string", "format": "uuid"}
    # Same pagination parameters as the comment list.
    comments = openapi["paths"]["/api/tasks/{tid}/comments"]["get"]["parameters"]
    for param in comments:
        if param["in"] == "query":
            assert query[param["name"]]["schema"] == param["schema"]


def test_activity_shapes_match_the_contract(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]
    read_fields = {
        "ActivityRead": {
            "id",
            "workspace_id",
            "project_id",
            "task_id",
            "actor",
            "action",
            "entity_type",
            "entity_id",
            "metadata",
            "created_at",
        },
        "ActivityPage": {"items", "next_cursor"},
    }
    for name, fields in read_fields.items():
        assert set(schemas[name]["properties"]) == fields, name
        assert set(schemas[name]["required"]) == fields, name

    read = schemas["ActivityRead"]["properties"]
    assert read["actor"] == {"$ref": "#/components/schemas/UserRef"}
    assert read["action"] == {"$ref": "#/components/schemas/ActivityAction"}
    assert read["entity_type"] == {"$ref": "#/components/schemas/ActivityEntityType"}
    assert read["metadata"]["type"] == "object"
    for nullable in ("project_id", "task_id"):
        assert {"type": "null"} in read[nullable]["anyOf"]
    page = schemas["ActivityPage"]["properties"]
    assert page["items"]["items"] == {"$ref": "#/components/schemas/ActivityRead"}
    assert page["next_cursor"]["anyOf"] == [{"type": "string"}, {"type": "null"}]


def test_activity_enums_are_named_schemas(openapi: dict[str, Any]) -> None:
    schemas = openapi["components"]["schemas"]

    assert schemas["ActivityAction"]["type"] == "string"
    assert schemas["ActivityAction"]["enum"] == [
        "workspace.created",
        "workspace.renamed",
        "member.added",
        "member.removed",
        "member.role_changed",
        "project.created",
        "project.updated",
        "project.archived",
        "task.created",
        "task.updated",
        "task.moved",
        "task.assigned",
        "task.due_date_changed",
        "task.deleted",
        "comment.created",
        "comment.edited",
        "comment.deleted",
    ]
    assert schemas["ActivityEntityType"]["type"] == "string"
    assert schemas["ActivityEntityType"]["enum"] == [
        "workspace",
        "member",
        "project",
        "task",
        "comment",
    ]
