"""Tenant isolation for projects (contract section 1.10, PLAN.md rule 4).

A member of workspace A, whatever their role there, can neither see nor touch the projects of
workspace B: list endpoints never include them, and B's project ids are 404 on every project
route, exactly like ids that do not exist. Roles are always taken from the project's own
workspace.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.user import User
from app.services.permissions import Role
from tests.api.helpers import assert_error
from tests.factories import Team, add_member, create_project, create_team, log_in

ARCHIVED_AT = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)

# Project routes and a valid body for each, so only isolation can make them fail.
PROJECT_ROUTES = {
    "get_project": ("GET", "/api/projects/{pid}", None),
    "update_project": ("PATCH", "/api/projects/{pid}", {"name": "Hijacked", "description": None}),
    "archive_project": ("POST", "/api/projects/{pid}/archive", None),
}
PROJECT_NOT_FOUND = {"error": {"code": "not_found", "message": "Project not found", "details": {}}}
WORKSPACE_NOT_FOUND = {
    "error": {"code": "not_found", "message": "Workspace not found", "details": {}}
}


@dataclass(frozen=True)
class TwoWorkspaces:
    a: Team
    b: Team
    a_projects: list[Project]
    b_projects: list[Project]


@pytest.fixture
def world(db_session: Session) -> TwoWorkspaces:
    """Workspaces A and B (one user per role each). Both have an active project keyed WEB and an
    archived one."""
    a = create_team(db_session)
    b = create_team(db_session)
    a_projects = [
        create_project(db_session, a.workspace, name="A web", key="WEB", description="A"),
        create_project(db_session, a.workspace, name="A old", key="OLD", archived_at=ARCHIVED_AT),
    ]
    b_projects = [
        create_project(db_session, b.workspace, name="B web", key="WEB", description="B"),
        create_project(db_session, b.workspace, name="B old", key="OLD", archived_at=ARCHIVED_AT),
    ]
    return TwoWorkspaces(a=a, b=b, a_projects=a_projects, b_projects=b_projects)


def projects_url(team: Team) -> str:
    return f"/api/workspaces/{team.workspace.id}/projects"


def call(client: TestClient, route: str, project_id: UUID) -> httpx2.Response:
    method, path, body = PROJECT_ROUTES[route]
    return client.request(method, path.format(pid=project_id), json=body)


def snapshot(client: TestClient, team: Team) -> list[dict[str, Any]]:
    """All of the team's projects (archived included), as its owner sees them."""
    log_in(client, team.owner)
    response = client.get(projects_url(team), params={"include_archived": True})
    assert response.status_code == 200
    projects: list[dict[str, Any]] = response.json()
    return projects


def ids(projects: list[Project]) -> set[str]:
    return {str(project.id) for project in projects}


@pytest.mark.parametrize("role", list(Role))
def test_list_returns_only_the_workspaces_own_projects(
    client: TestClient, world: TwoWorkspaces, role: Role
) -> None:
    log_in(client, world.a.users[role])

    active = client.get(projects_url(world.a)).json()
    everything = client.get(projects_url(world.a), params={"include_archived": True}).json()

    assert {p["id"] for p in active} == {str(world.a_projects[0].id)}
    assert {p["id"] for p in everything} == ids(world.a_projects)
    assert {p["workspace_id"] for p in everything} == {str(world.a.workspace.id)}


@pytest.mark.parametrize("role", list(Role))
def test_member_of_a_cannot_list_or_create_projects_in_b(
    client: TestClient, world: TwoWorkspaces, role: Role
) -> None:
    before = snapshot(client, world.b)
    log_in(client, world.a.users[role])

    listing = client.get(projects_url(world.b), params={"include_archived": True})
    creating = client.post(projects_url(world.b), json={"name": "Planted", "key": "PLANT"})

    for response in (listing, creating):
        assert response.status_code == 404
        assert response.json() == WORKSPACE_NOT_FOUND
    assert snapshot(client, world.b) == before


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("route", PROJECT_ROUTES)
def test_project_of_b_is_not_found_for_a_member_of_a(
    client: TestClient, world: TwoWorkspaces, route: str, role: Role
) -> None:
    before = snapshot(client, world.b)
    log_in(client, world.a.users[role])

    for project in world.b_projects:
        response = call(client, route, project.id)

        assert response.status_code == 404
        assert response.json() == PROJECT_NOT_FOUND
        # Indistinguishable from an id that does not exist.
        unknown = call(client, route, uuid.uuid4())
        assert (unknown.status_code, unknown.json()) == (404, response.json())
    assert snapshot(client, world.b) == before


def test_role_comes_from_the_projects_own_workspace(
    client: TestClient, db_session: Session, world: TwoWorkspaces
) -> None:
    """Owner of A but only a viewer of B: B's projects are read-only for them."""
    owner_of_a = world.a.owner
    add_member(db_session, world.b.workspace, owner_of_a, Role.VIEWER)
    log_in(client, owner_of_a)
    b_web, a_web = world.b_projects[0], world.a_projects[0]

    assert client.get(f"/api/projects/{b_web.id}").status_code == 200
    for route in ("update_project", "archive_project"):
        assert_error(call(client, route, b_web.id), 403, "forbidden", reason="insufficient_role")
    create_in_b = client.post(projects_url(world.b), json={"name": "Planted", "key": "PLANT"})
    assert_error(create_in_b, 403, "forbidden", reason="insufficient_role")
    # In their own workspace they are still an owner.
    assert call(client, "update_project", a_web.id).status_code == 200


def test_admin_of_b_and_viewer_of_a_can_only_manage_bs_projects(
    client: TestClient, db_session: Session, world: TwoWorkspaces
) -> None:
    user: User = world.a.users[Role.VIEWER]
    add_member(db_session, world.b.workspace, user, Role.ADMIN)
    log_in(client, user)

    assert call(client, "archive_project", world.b_projects[0].id).status_code == 200
    assert_error(
        call(client, "archive_project", world.a_projects[0].id),
        403,
        "forbidden",
        reason="insufficient_role",
    )


def test_same_key_in_two_workspaces_stays_independent(
    client: TestClient, world: TwoWorkspaces
) -> None:
    a_web, b_web = world.a_projects[0], world.b_projects[0]
    log_in(client, world.a.owner)

    archived = call(client, "archive_project", a_web.id)
    renamed = call(client, "update_project", a_web.id)

    assert archived.status_code == renamed.status_code == 200
    log_in(client, world.b.owner)
    b_view = client.get(f"/api/projects/{b_web.id}").json()
    assert (b_view["key"], b_view["name"], b_view["archived_at"]) == ("WEB", "B web", None)
    assert [p["id"] for p in client.get(projects_url(world.b)).json()] == [str(b_web.id)]
