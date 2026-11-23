"""Who can call each project endpoint (contract sections 1.10 and 3.5).

Every project endpoint, for every role: allowed or 403 `insufficient_role`. Non-members and
unknown ids get 404 on every one of them, before any role or body check.
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
from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.factories import Team, create_project, create_team, log_in

PROJECTS = "/api/workspaces/{wid}/projects"
PROJECT = "/api/projects/{pid}"
ARCHIVE = "/api/projects/{pid}/archive"

EVERYONE = frozenset(Role)
ADMINS_AND_OWNERS = frozenset({Role.OWNER, Role.ADMIN})


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    allowed: frozenset[Role]
    success: int
    body: dict[str, Any] | None = None
    invalid_body: dict[str, Any] | None = None

    @property
    def path_param(self) -> str:
        """The id this endpoint resolves first: the workspace (`wid`) or the project (`pid`)."""
        return "wid" if "{wid}" in self.path else "pid"


ENDPOINTS = {
    "list_projects": Endpoint("GET", PROJECTS, EVERYONE, 200),
    "create_project": Endpoint(
        "POST",
        PROJECTS,
        ADMINS_AND_OWNERS,
        201,
        {"name": "Website", "key": "WEB"},
        invalid_body={"name": "", "key": "web"},
    ),
    "get_project": Endpoint("GET", PROJECT, EVERYONE, 200),
    "update_project": Endpoint(
        "PATCH", PROJECT, ADMINS_AND_OWNERS, 200, {"name": "Renamed"}, invalid_body={"name": ""}
    ),
    "archive_project": Endpoint("POST", ARCHIVE, ADMINS_AND_OWNERS, 200),
}
WITH_BODY = [name for name, endpoint in ENDPOINTS.items() if endpoint.invalid_body is not None]
WRITES = [name for name, endpoint in ENDPOINTS.items() if endpoint.allowed != EVERYONE]

NOT_FOUND_MESSAGES = {"wid": "Workspace not found", "pid": "Project not found"}


@dataclass(frozen=True)
class Setup:
    team: Team
    project: Project


@pytest.fixture
def setup(db_session: Session) -> Setup:
    team = create_team(db_session)
    project = create_project(
        db_session, team.workspace, name="App", key="APP", description="Mobile app"
    )
    return Setup(team=team, project=project)


def call(
    client: TestClient,
    name: str,
    setup: Setup,
    *,
    wid: UUID | str | None = None,
    pid: UUID | str | None = None,
    invalid: bool = False,
) -> httpx2.Response:
    endpoint = ENDPOINTS[name]
    path = endpoint.path.format(wid=wid or setup.team.workspace.id, pid=pid or setup.project.id)
    body = endpoint.invalid_body if invalid else endpoint.body
    return client.request(endpoint.method, path, json=body)


def not_found(name: str) -> dict[str, Any]:
    message = NOT_FOUND_MESSAGES[ENDPOINTS[name].path_param]
    return {"error": {"code": "not_found", "message": message, "details": {}}}


def project_snapshot(client: TestClient, setup: Setup) -> list[dict[str, Any]]:
    """Every project of the workspace (archived included), as the owner sees them."""
    log_in(client, setup.team.owner)
    url = PROJECTS.format(wid=setup.team.workspace.id)
    response = client.get(url, params={"include_archived": True})
    assert response.status_code == 200
    projects: list[dict[str, Any]] = response.json()
    return projects


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
            message="Only owners and admins can create, edit or archive projects",
        )


@pytest.mark.parametrize("role", [Role.MEMBER, Role.VIEWER])
def test_forbidden_writes_change_nothing(client: TestClient, setup: Setup, role: Role) -> None:
    before = project_snapshot(client, setup)
    log_in(client, setup.team.users[role])

    for name in WRITES:
        assert call(client, name, setup).status_code == 403

    assert project_snapshot(client, setup) == before


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

    response = call(client, name, setup, wid=unknown, pid=unknown)

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

    response = call(client, name, setup, wid="not-a-uuid", pid="not-a-uuid")

    assert validation_fields(response) == {(ENDPOINTS[name].path_param, "path")}


@pytest.mark.parametrize("name", ENDPOINTS)
def test_every_endpoint_requires_a_session(client: TestClient, setup: Setup, name: str) -> None:
    response = call(client, name, setup)

    assert_error(response, 401, "unauthorized", message="Authentication required")


@pytest.mark.parametrize("name", [name for name in ENDPOINTS if ENDPOINTS[name].method != "GET"])
def test_mutations_require_the_csrf_header(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.owner)
    del client.headers["X-Requested-With"]

    response = call(client, name, setup)

    assert_error(response, 403, "forbidden", reason="csrf")
