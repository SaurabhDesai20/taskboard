"""Tenant isolation for tasks (contract section 1.10, PLAN.md rule 4).

A member of workspace A, whatever their role there, can neither see nor touch the tasks of
workspace B: B's projects are 404 for listing and creating tasks, and B's task ids are 404 on
every task route, exactly like ids that do not exist. Roles always come from the task's own
workspace.
"""

import uuid
from dataclasses import dataclass
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.services.permissions import Role
from tests.api.helpers import assert_error
from tests.api.task_helpers import Json, ids, list_tasks, task_url, tasks_url
from tests.factories import Team, add_member, create_project, create_task, create_team, log_in

# Task routes and a valid body for each, so only isolation can make them fail.
TASK_ROUTES = {
    "get_task": ("GET", "/api/tasks/{tid}", None),
    "update_task": ("PATCH", "/api/tasks/{tid}", {"title": "Hijacked", "assignee_id": None}),
    "move_task": ("POST", "/api/tasks/{tid}/move", {"status": "done"}),
    "delete_task": ("DELETE", "/api/tasks/{tid}", None),
}
TASK_NOT_FOUND = {"error": {"code": "not_found", "message": "Task not found", "details": {}}}
PROJECT_NOT_FOUND = {"error": {"code": "not_found", "message": "Project not found", "details": {}}}


@dataclass(frozen=True)
class Side:
    team: Team
    project: Project
    tasks: list[Task]


@dataclass(frozen=True)
class TwoWorkspaces:
    a: Side
    b: Side


def make_side(db: Session) -> Side:
    """A workspace with a project keyed WEB and two tasks (WEB-1, WEB-2)."""
    team = create_team(db)
    project = create_project(db, team.workspace, key="WEB")
    tasks = [
        create_task(db, project, title="Todo", assignee=team.users[Role.MEMBER]),
        create_task(db, project, title="Done", status=TaskStatus.DONE),
    ]
    return Side(team=team, project=project, tasks=tasks)


@pytest.fixture
def world(db_session: Session) -> TwoWorkspaces:
    return TwoWorkspaces(a=make_side(db_session), b=make_side(db_session))


def call(client: TestClient, route: str, task_id: UUID) -> httpx2.Response:
    method, path, body = TASK_ROUTES[route]
    return client.request(method, path.format(tid=task_id), json=body)


def snapshot(client: TestClient, side: Side) -> list[Json]:
    """The side's tasks, as its owner sees them."""
    log_in(client, side.team.owner)
    return list_tasks(client, side.project.id)


@pytest.mark.parametrize("role", list(Role))
def test_list_returns_only_the_projects_own_tasks(
    client: TestClient, world: TwoWorkspaces, role: Role
) -> None:
    log_in(client, world.a.team.users[role])

    body = list_tasks(client, world.a.project.id)

    assert ids(body) == [str(task.id) for task in world.a.tasks]
    assert {task["workspace_id"] for task in body} == {str(world.a.team.workspace.id)}


@pytest.mark.parametrize("role", list(Role))
def test_member_of_a_cannot_list_or_create_tasks_in_bs_project(
    client: TestClient, world: TwoWorkspaces, role: Role
) -> None:
    before = snapshot(client, world.b)
    log_in(client, world.a.team.users[role])

    listing = client.get(tasks_url(world.b.project.id))
    creating = client.post(tasks_url(world.b.project.id), json={"title": "Planted"})

    for response in (listing, creating):
        assert response.status_code == 404
        assert response.json() == PROJECT_NOT_FOUND
    assert snapshot(client, world.b) == before


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("route", TASK_ROUTES)
def test_task_of_b_is_not_found_for_a_member_of_a(
    client: TestClient, world: TwoWorkspaces, route: str, role: Role
) -> None:
    before = snapshot(client, world.b)
    log_in(client, world.a.team.users[role])

    for task in world.b.tasks:
        response = call(client, route, task.id)

        assert response.status_code == 404
        assert response.json() == TASK_NOT_FOUND
        # Indistinguishable from an id that does not exist.
        unknown = call(client, route, uuid.uuid4())
        assert (unknown.status_code, unknown.json()) == (404, response.json())
    assert snapshot(client, world.b) == before


def test_role_comes_from_the_tasks_own_workspace(
    client: TestClient, db_session: Session, world: TwoWorkspaces
) -> None:
    """Owner of A but only a viewer of B: B's tasks are read-only for them."""
    owner_of_a = world.a.team.owner
    add_member(db_session, world.b.team.workspace, owner_of_a, Role.VIEWER)
    log_in(client, owner_of_a)
    b_task, a_task = world.b.tasks[0], world.a.tasks[0]

    assert client.get(task_url(b_task.id)).status_code == 200
    for route in ("update_task", "move_task", "delete_task"):
        assert_error(call(client, route, b_task.id), 403, "forbidden", reason="insufficient_role")
    create_in_b = client.post(tasks_url(world.b.project.id), json={"title": "Planted"})
    assert_error(create_in_b, 403, "forbidden", reason="insufficient_role")
    # In their own workspace they are still an owner.
    assert call(client, "update_task", a_task.id).status_code == 200
    assert call(client, "delete_task", a_task.id).status_code == 204


def test_admin_of_b_and_viewer_of_a_can_only_write_bs_tasks(
    client: TestClient, db_session: Session, world: TwoWorkspaces
) -> None:
    user = world.a.team.users[Role.VIEWER]
    add_member(db_session, world.b.team.workspace, user, Role.ADMIN)
    log_in(client, user)

    assert call(client, "move_task", world.b.tasks[0].id).status_code == 200
    assert call(client, "delete_task", world.b.tasks[1].id).status_code == 204
    for route in ("update_task", "move_task", "delete_task"):
        assert_error(
            call(client, route, world.a.tasks[0].id), 403, "forbidden", reason="insufficient_role"
        )


def test_members_of_b_cannot_be_assigned_in_a(client: TestClient, world: TwoWorkspaces) -> None:
    log_in(client, world.a.team.owner)
    b_member = world.b.team.users[Role.MEMBER]

    response = client.patch(task_url(world.a.tasks[0].id), json={"assignee_id": str(b_member.id)})

    assert response.status_code == 422
    assert response.json()["error"]["details"]["errors"][0]["field"] == "assignee_id"


def test_filtering_by_a_user_of_b_finds_nothing_in_a(
    client: TestClient, world: TwoWorkspaces
) -> None:
    """Both sides assigned WEB-1 to their own member; filters stay inside the project."""
    log_in(client, world.a.team.owner)

    b_member = world.b.team.users[Role.MEMBER]
    a_member = world.a.team.users[Role.MEMBER]

    assert list_tasks(client, world.a.project.id, assignee_id=str(b_member.id)) == []
    assert ids(list_tasks(client, world.a.project.id, assignee_id=str(a_member.id))) == [
        str(world.a.tasks[0].id)
    ]


def test_same_project_key_in_two_workspaces_numbers_independently(
    client: TestClient, world: TwoWorkspaces
) -> None:
    log_in(client, world.a.team.owner)

    created = client.post(tasks_url(world.a.project.id), json={"title": "Third"}).json()

    assert (created["key"], created["number"]) == ("WEB-3", 3)
    log_in(client, world.b.team.owner)
    b_created = client.post(tasks_url(world.b.project.id), json={"title": "Third"}).json()
    assert (b_created["key"], b_created["number"]) == ("WEB-3", 3)
    assert [t["key"] for t in list_tasks(client, world.b.project.id)] == ["WEB-1", "WEB-3", "WEB-2"]
