"""GET /me/tasks: tasks assigned to me across my workspaces (contract section 3.6)."""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.models.workspace import Workspace
from app.services.permissions import Role
from tests.api.helpers import validation_fields
from tests.api.task_helpers import MY_TASK_FIELDS, Json, ids
from tests.factories import (
    add_member,
    create_project,
    create_task,
    create_user,
    create_workspace,
    log_in,
)

MY_TASKS = "/api/me/tasks"
ARCHIVED_AT = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def at(hour: int) -> datetime:
    return datetime(2026, 11, 20, hour, 0, tzinfo=UTC)


@dataclass(frozen=True)
class World:
    me: User
    colleague: User
    acme: Workspace
    globex: Workspace
    web: Project
    app: Project
    ops: Project


@pytest.fixture
def world(db_session: Session) -> World:
    """I am a member of Acme (projects WEB and APP) and a viewer of Globex (project OPS)."""
    me = create_user(db_session, name="Me Myself")
    colleague = create_user(db_session, name="Colleague")
    acme = create_workspace(db_session, owner=colleague, name="Acme", slug="acme")
    add_member(db_session, acme, me, Role.MEMBER)
    globex = create_workspace(db_session, owner=colleague, name="Globex", slug="globex")
    add_member(db_session, globex, me, Role.VIEWER)
    return World(
        me=me,
        colleague=colleague,
        acme=acme,
        globex=globex,
        web=create_project(db_session, acme, name="Website", key="WEB"),
        app=create_project(db_session, acme, name="Mobile", key="APP"),
        ops=create_project(db_session, globex, name="Operations", key="OPS"),
    )


def my_tasks(client: TestClient, **params: Any) -> list[Json]:
    response = client.get(MY_TASKS, params=params)
    assert response.status_code == 200, response.text
    tasks: list[Json] = response.json()
    return tasks


def test_empty_without_assigned_tasks(client: TestClient, world: World) -> None:
    log_in(client, world.me)

    assert my_tasks(client) == []


def test_returns_my_tasks_from_every_workspace_with_summaries(
    client: TestClient, db_session: Session, world: World
) -> None:
    web = create_task(
        db_session,
        world.web,
        title="Fix login",
        status=TaskStatus.IN_PROGRESS,
        assignee=world.me,
        due_date=date(2026, 12, 1),
    )
    ops = create_task(
        db_session, world.ops, title="Rotate keys", assignee=world.me, due_date=date(2026, 12, 5)
    )
    log_in(client, world.me)

    body = my_tasks(client)

    assert ids(body) == [str(web.id), str(ops.id)]
    assert all(set(task) == MY_TASK_FIELDS for task in body)
    first = body[0]
    assert first == {
        "id": str(web.id),
        "project_id": str(world.web.id),
        "workspace_id": str(world.acme.id),
        "number": 1,
        "key": "WEB-1",
        "title": "Fix login",
        "description": None,
        "status": "in_progress",
        "priority": "medium",
        "position": 1024.0,
        "assignee": {"id": str(world.me.id), "name": "Me Myself"},
        "due_date": "2026-12-01",
        "comment_count": 0,
        "created_by": str(world.colleague.id),
        "created_at": first["created_at"],
        "updated_at": first["updated_at"],
        "project": {"id": str(world.web.id), "name": "Website", "key": "WEB"},
        "workspace": {"id": str(world.acme.id), "name": "Acme", "slug": "acme"},
    }
    assert body[1]["project"] == {"id": str(world.ops.id), "name": "Operations", "key": "OPS"}
    assert body[1]["workspace"] == {"id": str(world.globex.id), "name": "Globex", "slug": "globex"}


def test_excludes_tasks_of_others_and_unassigned_tasks(
    client: TestClient, db_session: Session, world: World
) -> None:
    mine = create_task(db_session, world.web, assignee=world.me)
    create_task(db_session, world.web, assignee=world.colleague)
    create_task(db_session, world.web)
    log_in(client, world.me)

    assert ids(my_tasks(client)) == [str(mine.id)]


def test_excludes_archived_projects(client: TestClient, db_session: Session, world: World) -> None:
    archived = create_project(db_session, world.acme, key="OLD", archived_at=ARCHIVED_AT)
    create_task(db_session, archived, assignee=world.me)
    active = create_task(db_session, world.app, assignee=world.me)
    log_in(client, world.me)

    assert ids(my_tasks(client)) == [str(active.id)]


def test_archiving_a_project_removes_its_tasks(
    client: TestClient, db_session: Session, world: World
) -> None:
    task = create_task(db_session, world.web, assignee=world.me)
    log_in(client, world.me)
    assert ids(my_tasks(client)) == [str(task.id)]

    log_in(client, world.colleague)
    assert client.post(f"/api/projects/{world.web.id}/archive").status_code == 200

    log_in(client, world.me)
    assert my_tasks(client) == []


def test_never_returns_tasks_of_workspaces_i_do_not_belong_to(
    client: TestClient, db_session: Session, world: World
) -> None:
    """Assigned to me, but in a workspace I left (or was never in): not mine to see."""
    initech = create_workspace(db_session, owner=world.colleague, name="Initech")
    stranger_project = create_project(db_session, initech, key="INI")
    create_task(db_session, stranger_project, assignee=world.me)
    acme_task = create_task(db_session, world.web, assignee=world.me, created_at=at(1))
    globex_task = create_task(db_session, world.ops, assignee=world.me, created_at=at(2))
    log_in(client, world.me)
    assert ids(my_tasks(client)) == [str(acme_task.id), str(globex_task.id)]

    left = client.delete(f"/api/workspaces/{world.globex.id}/members/{world.me.id}")

    assert left.status_code == 204
    assert ids(my_tasks(client)) == [str(acme_task.id)]


def test_other_users_see_only_their_own(
    client: TestClient, db_session: Session, world: World
) -> None:
    create_task(db_session, world.web, assignee=world.me)
    theirs = create_task(db_session, world.ops, assignee=world.colleague)
    log_in(client, world.colleague)

    assert ids(my_tasks(client)) == [str(theirs.id)]


def test_ordered_by_due_date_with_undated_last_then_by_creation(
    client: TestClient, db_session: Session, world: World
) -> None:
    def task(project: Project, due: date | None, created_hour: int) -> Task:
        return create_task(
            db_session, project, assignee=world.me, due_date=due, created_at=at(created_hour)
        )

    undated_old = task(world.ops, None, 1)
    late = task(world.web, date(2026, 12, 31), 2)
    undated_new = task(world.web, None, 3)
    soon_new = task(world.app, date(2026, 12, 1), 5)
    soon_old = task(world.ops, date(2026, 12, 1), 4)
    overdue = task(world.app, date(2026, 11, 1), 6)
    log_in(client, world.me)

    body = my_tasks(client)

    expected = [overdue, soon_old, soon_new, late, undated_old, undated_new]
    assert ids(body) == [str(t.id) for t in expected]


@pytest.fixture
def mixed(db_session: Session, world: World) -> dict[str, Task]:
    def task(name: str, status: TaskStatus, due: date | None) -> Task:
        return create_task(
            db_session, world.web, title=name, status=status, assignee=world.me, due_date=due
        )

    return {
        "todo": task("todo", TaskStatus.TODO, date(2026, 12, 1)),
        "review": task("review", TaskStatus.IN_REVIEW, date(2026, 12, 2)),
        "done": task("done", TaskStatus.DONE, date(2026, 12, 3)),
        "undated": task("undated", TaskStatus.TODO, None),
    }


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({}, ["todo", "review", "done", "undated"]),
        ({"status": "todo"}, ["todo", "undated"]),
        ({"status": ["in_review", "done"]}, ["review", "done"]),
        ({"status": "in_progress"}, []),
        ({"due_before": "2026-12-02"}, ["todo", "review"]),
        ({"due_before": "2026-11-30"}, []),
        ({"status": "todo", "due_before": "2026-12-31"}, ["todo"]),
    ],
)
def test_filters(
    client: TestClient,
    world: World,
    mixed: dict[str, Task],
    params: dict[str, Any],
    expected: list[str],
) -> None:
    log_in(client, world.me)

    assert ids(my_tasks(client, **params)) == [str(mixed[name].id) for name in expected]


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"status": "blocked"}, "status.0"),
        ({"due_before": "soon"}, "due_before"),
    ],
)
def test_rejects_invalid_filters(
    client: TestClient, world: World, params: dict[str, Any], field: str
) -> None:
    log_in(client, world.me)

    response = client.get(MY_TASKS, params=params)

    assert validation_fields(response) == {(field, "query")}
