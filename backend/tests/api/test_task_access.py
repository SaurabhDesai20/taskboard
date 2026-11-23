"""Who can call each task endpoint (contract sections 1.10 and 3.6).

Every task endpoint, for every role: allowed or 403 `insufficient_role`. Viewers cannot write,
members cannot delete. Non-members and unknown ids get 404 on every endpoint, before any role
or body check.
"""

import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.api.task_helpers import Json
from tests.factories import Team, create_project, create_task, create_team, log_in

TASKS = "/api/projects/{pid}/tasks"
TASK = "/api/tasks/{tid}"
MOVE = "/api/tasks/{tid}/move"

EVERYONE = frozenset(Role)
WRITERS = frozenset({Role.OWNER, Role.ADMIN, Role.MEMBER})
ADMINS_AND_OWNERS = frozenset({Role.OWNER, Role.ADMIN})

WRITE_DENIED = "Only owners, admins and members can create or edit tasks"
DELETE_DENIED = "Only owners and admins can delete tasks"


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    allowed: frozenset[Role]
    success: int
    body: Json | None = None
    invalid_body: Json | None = None

    @property
    def path_param(self) -> str:
        """The id this endpoint resolves first: the project (`pid`) or the task (`tid`)."""
        return "pid" if "{pid}" in self.path else "tid"

    @property
    def denied_message(self) -> str:
        return DELETE_DENIED if self.method == "DELETE" else WRITE_DENIED


ENDPOINTS = {
    "list_tasks": Endpoint("GET", TASKS, EVERYONE, 200),
    "create_task": Endpoint(
        "POST",
        TASKS,
        WRITERS,
        201,
        {"title": "New task"},
        invalid_body={"title": "", "status": "blocked"},
    ),
    "get_task": Endpoint("GET", TASK, EVERYONE, 200),
    "update_task": Endpoint(
        "PATCH", TASK, WRITERS, 200, {"title": "Renamed"}, invalid_body={"title": None}
    ),
    "move_task": Endpoint(
        "POST", MOVE, WRITERS, 200, {"status": "done"}, invalid_body={"status": "blocked"}
    ),
    "delete_task": Endpoint("DELETE", TASK, ADMINS_AND_OWNERS, 204),
}
WITH_BODY = [name for name, endpoint in ENDPOINTS.items() if endpoint.invalid_body is not None]
# Viewers on every write, members on delete.
FORBIDDEN = [
    (role, name)
    for name, endpoint in ENDPOINTS.items()
    for role in Role
    if role not in endpoint.allowed
]

NOT_FOUND_MESSAGES = {"pid": "Project not found", "tid": "Task not found"}


@dataclass(frozen=True)
class Setup:
    team: Team
    project: Project
    task: Task


@pytest.fixture
def setup(db_session: Session) -> Setup:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace, key="WEB")
    task = create_task(db_session, project, title="Fix login", status=TaskStatus.IN_REVIEW)
    return Setup(team=team, project=project, task=task)


def call(
    client: TestClient,
    name: str,
    setup: Setup,
    *,
    pid: UUID | str | None = None,
    tid: UUID | str | None = None,
    invalid: bool = False,
) -> httpx2.Response:
    endpoint = ENDPOINTS[name]
    path = endpoint.path.format(pid=pid or setup.project.id, tid=tid or setup.task.id)
    body = endpoint.invalid_body if invalid else endpoint.body
    return client.request(endpoint.method, path, json=body)


def not_found(name: str) -> dict[str, Any]:
    message = NOT_FOUND_MESSAGES[ENDPOINTS[name].path_param]
    return {"error": {"code": "not_found", "message": message, "details": {}}}


def task_snapshot(client: TestClient, setup: Setup) -> list[Json]:
    """Every task of the project, as the owner sees them."""
    log_in(client, setup.team.owner)
    response = client.get(TASKS.format(pid=setup.project.id))
    assert response.status_code == 200
    tasks: list[Json] = response.json()
    return tasks


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("name", ENDPOINTS)
def test_each_role_is_allowed_or_forbidden(
    client: TestClient, setup: Setup, name: str, role: Role
) -> None:
    log_in(client, setup.team.users[role])

    response = call(client, name, setup)

    if role in ENDPOINTS[name].allowed:
        assert response.status_code == ENDPOINTS[name].success, response.text
    else:
        assert_error(
            response,
            403,
            "forbidden",
            reason="insufficient_role",
            message=ENDPOINTS[name].denied_message,
        )


@pytest.mark.parametrize(("role", "name"), FORBIDDEN)
def test_forbidden_writes_change_nothing(
    client: TestClient, setup: Setup, role: Role, name: str
) -> None:
    before = task_snapshot(client, setup)
    log_in(client, setup.team.users[role])

    assert call(client, name, setup).status_code == 403

    assert task_snapshot(client, setup) == before


def test_member_cannot_delete_even_their_own_task(client: TestClient, setup: Setup) -> None:
    member = setup.team.users[Role.MEMBER]
    log_in(client, member)
    created = client.post(TASKS.format(pid=setup.project.id), json={"title": "Mine"}).json()

    response = client.delete(TASK.format(tid=created["id"]))

    assert_error(response, 403, "forbidden", reason="insufficient_role", message=DELETE_DENIED)
    assert client.get(TASK.format(tid=created["id"])).status_code == 200


@pytest.mark.parametrize("name", ENDPOINTS)
def test_non_member_gets_not_found(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.outsider)

    response = call(client, name, setup)

    assert response.status_code == 404
    assert response.json() == not_found(name)


@pytest.mark.parametrize("name", ENDPOINTS)
def test_unknown_id_gets_not_found(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.owner)
    unknown = uuid.uuid4()

    response = call(client, name, setup, pid=unknown, tid=unknown)

    assert response.status_code == 404
    assert response.json() == not_found(name)


@pytest.mark.parametrize("name", WITH_BODY)
def test_not_found_comes_before_body_validation(
    client: TestClient, setup: Setup, name: str
) -> None:
    log_in(client, setup.team.outsider)

    response = call(client, name, setup, invalid=True)

    assert response.status_code == 404
    assert response.json() == not_found(name)


@pytest.mark.parametrize("name", WITH_BODY)
def test_forbidden_comes_before_body_validation(
    client: TestClient, setup: Setup, name: str
) -> None:
    log_in(client, setup.team.users[Role.VIEWER])

    response = call(client, name, setup, invalid=True)

    assert_error(response, 403, "forbidden", reason="insufficient_role")


@pytest.mark.parametrize("name", ENDPOINTS)
def test_malformed_id_is_a_validation_error(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.owner)

    response = call(client, name, setup, pid="not-a-uuid", tid="not-a-uuid")

    assert validation_fields(response) == {(ENDPOINTS[name].path_param, "path")}


@pytest.mark.parametrize("name", ENDPOINTS)
def test_every_endpoint_requires_a_session(client: TestClient, setup: Setup, name: str) -> None:
    response = call(client, name, setup)

    assert_error(response, 401, "unauthorized", message="Authentication required")


def test_my_tasks_requires_a_session(client: TestClient) -> None:
    assert_error(client.get("/api/me/tasks"), 401, "unauthorized")


@pytest.mark.parametrize("name", [name for name in ENDPOINTS if ENDPOINTS[name].method != "GET"])
def test_mutations_require_the_csrf_header(client: TestClient, setup: Setup, name: str) -> None:
    before = task_snapshot(client, setup)
    del client.headers["X-Requested-With"]

    response = call(client, name, setup)

    assert_error(response, 403, "forbidden", reason="csrf")
    client.headers["X-Requested-With"] = "taskboard"
    assert task_snapshot(client, setup) == before
