"""Task CRUD, numbering and list filters (contract sections 1.7, 1.8 and 3.6).

Moves and ordering: test_task_move.py. Role gates and 404s: test_task_access.py. Cross-workspace
isolation: test_task_isolation.py. My tasks: test_my_tasks.py.
"""

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskPriority, TaskStatus
from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.api.task_helpers import (
    TASK_FIELDS,
    Json,
    create_task,
    get_task,
    ids,
    list_tasks,
    patch_task,
    task_url,
    tasks_url,
)
from tests.factories import Team, create_project, create_team, log_in
from tests.factories import create_task as make_task

ARCHIVED_AT = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
LONG_AGO = datetime(2020, 1, 1, tzinfo=UTC)
WRITERS = [Role.OWNER, Role.ADMIN, Role.MEMBER]


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


@pytest.fixture
def project(db_session: Session, team: Team) -> Project:
    return create_project(db_session, team.workspace, name="Website", key="WEB")


def act_as(client: TestClient, team: Team, role: Role) -> None:
    log_in(client, team.users[role])


# --- create -----------------------------------------------------------------------------


@pytest.mark.parametrize("role", WRITERS)
def test_create_returns_the_new_task(
    client: TestClient, team: Team, project: Project, role: Role
) -> None:
    act_as(client, team, role)
    ben = team.other_member

    response = client.post(
        tasks_url(project.id),
        json={
            "title": "Fix login redirect",
            "description": "After login users land on /404 instead of the dashboard.",
            "status": "in_progress",
            "priority": "high",
            "assignee_id": str(ben.id),
            "due_date": "2026-12-01",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == TASK_FIELDS
    assert UUID(body["id"]).version == 4
    assert body == {
        "id": body["id"],
        "project_id": str(project.id),
        "workspace_id": str(team.workspace.id),
        "number": 1,
        "key": "WEB-1",
        "title": "Fix login redirect",
        "description": "After login users land on /404 instead of the dashboard.",
        "status": "in_progress",
        "priority": "high",
        "position": 1024.0,
        "assignee": {"id": str(ben.id), "name": "Other Member"},
        "due_date": "2026-12-01",
        "comment_count": 0,
        "created_by": str(team.users[role].id),
        "created_at": body["created_at"],
        "updated_at": body["updated_at"],
    }
    assert body["created_at"].endswith("Z")
    assert body["updated_at"].endswith("Z")
    assert get_task(client, body["id"]) == body
    assert list_tasks(client, project.id) == [body]


def test_create_applies_the_defaults(client: TestClient, team: Team, project: Project) -> None:
    act_as(client, team, Role.MEMBER)

    created = create_task(client, project.id, title="Write onboarding copy")

    assert {k: created[k] for k in ("status", "priority", "position")} == {
        "status": "todo",
        "priority": "medium",
        "position": 1024.0,
    }
    assert (created["description"], created["assignee"], created["due_date"]) == (None, None, None)


@pytest.mark.parametrize(
    "body",
    [
        {"description": None, "assignee_id": None, "due_date": None},
        {"status": "todo", "priority": "medium"},
    ],
)
def test_create_accepts_explicit_defaults_and_nulls(
    client: TestClient, team: Team, project: Project, body: Json
) -> None:
    act_as(client, team, Role.MEMBER)

    created = create_task(client, project.id, title="Task", **body)

    assert (created["status"], created["priority"], created["description"]) == (
        "todo",
        "medium",
        None,
    )


def test_create_trims_strings_and_keeps_a_blank_description(
    client: TestClient, team: Team, project: Project
) -> None:
    act_as(client, team, Role.MEMBER)

    trimmed = create_task(client, project.id, title="  Fix it  ", description="  Details  ")
    blank = create_task(client, project.id, title="Blank", description="   ")

    assert (trimmed["title"], trimmed["description"]) == ("Fix it", "Details")
    assert blank["description"] == ""


def test_create_accepts_boundary_values(client: TestClient, team: Team, project: Project) -> None:
    act_as(client, team, Role.MEMBER)

    short = create_task(client, project.id, title="t", description="")
    long = create_task(client, project.id, title="t" * 200, description="d" * 10000)

    assert short["title"] == "t"
    assert (long["title"], long["description"]) == ("t" * 200, "d" * 10000)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", None),
        ("title", ""),
        ("title", "   "),
        ("title", "t" * 201),
        ("title", 123),
        ("description", "d" * 10001),
        ("description", 42),
        ("status", None),
        ("status", "blocked"),
        ("status", "TODO"),
        ("priority", None),
        ("priority", "critical"),
        ("assignee_id", "not-a-uuid"),
        ("due_date", "2026-13-01"),
        ("due_date", "tomorrow"),
    ],
)
def test_create_rejects_invalid_fields(
    client: TestClient, team: Team, project: Project, field: str, value: Any
) -> None:
    act_as(client, team, Role.MEMBER)

    response = client.post(tasks_url(project.id), json={"title": "Task", field: value})

    assert validation_fields(response) == {(field, "body")}
    assert list_tasks(client, project.id) == []


def test_create_requires_a_title(client: TestClient, team: Team, project: Project) -> None:
    act_as(client, team, Role.MEMBER)

    response = client.post(tasks_url(project.id), json={"status": "todo"})

    assert validation_fields(response) == {("title", "body")}


def test_create_ignores_server_controlled_fields(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    other = create_project(db_session, team.workspace, key="OTH")
    act_as(client, team, Role.MEMBER)

    created = create_task(
        client,
        project.id,
        title="Task",
        number=99,
        key="HACK-1",
        position=5.5,
        comment_count=7,
        project_id=str(other.id),
        workspace_id=str(create_team(db_session).workspace.id),
        created_by=str(team.owner.id),
    )

    assert (created["number"], created["key"], created["position"]) == (1, "WEB-1", 1024.0)
    assert created["comment_count"] == 0
    assert created["project_id"] == str(project.id)
    assert created["workspace_id"] == str(team.workspace.id)
    assert created["created_by"] == str(team.users[Role.MEMBER].id)


def test_create_puts_the_task_at_the_end_of_its_column(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    make_task(db_session, project, status=TaskStatus.IN_REVIEW, position=-500.0)
    make_task(db_session, project, status=TaskStatus.IN_REVIEW, position=-100.25)
    act_as(client, team, Role.MEMBER)

    todo = [create_task(client, project.id, title=f"Todo {n}") for n in range(3)]
    done = create_task(client, project.id, title="Done", status="done")
    review = create_task(client, project.id, title="Review", status="in_review")

    assert [task["position"] for task in todo] == [1024.0, 2048.0, 3072.0]
    assert done["position"] == 1024.0
    # Last position + 1024, even when the column's positions are negative.
    assert review["position"] == -100.25 + 1024


# --- numbering --------------------------------------------------------------------------


def test_numbers_and_keys_follow_a_per_project_sequence(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    other = create_project(db_session, team.workspace, key="APP")
    act_as(client, team, Role.MEMBER)

    web = [create_task(client, project.id, title=f"Web {n}") for n in range(3)]
    app = create_task(client, other.id, title="App")

    assert [(t["number"], t["key"]) for t in web] == [(1, "WEB-1"), (2, "WEB-2"), (3, "WEB-3")]
    assert (app["number"], app["key"]) == (1, "APP-1")


def test_numbers_are_never_reused_after_deletes(
    client: TestClient, team: Team, project: Project
) -> None:
    act_as(client, team, Role.ADMIN)
    first, second, third = (create_task(client, project.id, title=f"T{n}") for n in range(3))

    for task in (third, second):
        assert client.delete(task_url(task["id"])).status_code == 204
    fourth = create_task(client, project.id, title="T4")

    assert (fourth["number"], fourth["key"]) == (4, "WEB-4")
    assert ids(list_tasks(client, project.id)) == [first["id"], fourth["id"]]


def test_numbers_continue_after_factory_created_tasks(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    make_task(db_session, project)
    make_task(db_session, project)
    act_as(client, team, Role.MEMBER)

    assert create_task(client, project.id, title="Third")["number"] == 3


# --- assignee ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_any_member_of_the_workspace_can_be_the_assignee(
    client: TestClient, team: Team, project: Project, role: Role
) -> None:
    act_as(client, team, Role.MEMBER)
    assignee = team.users[role]

    created = create_task(client, project.id, title="Task", assignee_id=str(assignee.id))

    assert created["assignee"] == {"id": str(assignee.id), "name": assignee.name}


def test_assignee_must_be_a_member_of_the_workspace(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    other = create_team(db_session)
    act_as(client, team, Role.MEMBER)

    for user_id in (team.outsider.id, other.owner.id, UUID(int=1)):
        response = client.post(
            tasks_url(project.id), json={"title": "Task", "assignee_id": str(user_id)}
        )

        assert_error(
            response,
            422,
            "validation_error",
            message="Request validation failed",
        )
        assert response.json()["error"]["details"] == {
            "errors": [
                {
                    "field": "assignee_id",
                    "location": "body",
                    "message": "Assignee must be a member of this workspace",
                }
            ]
        }
    assert list_tasks(client, project.id) == []


def test_a_rejected_create_does_not_use_up_a_number(
    client: TestClient, team: Team, project: Project
) -> None:
    act_as(client, team, Role.MEMBER)
    rejected = client.post(
        tasks_url(project.id), json={"title": "Task", "assignee_id": str(team.outsider.id)}
    )
    assert rejected.status_code == 422

    assert create_task(client, project.id, title="Task")["number"] == 1


# --- archived projects ------------------------------------------------------------------


@pytest.fixture
def archived(db_session: Session, team: Team) -> Project:
    return create_project(db_session, team.workspace, key="OLD", archived_at=ARCHIVED_AT)


def test_create_in_an_archived_project_conflicts(
    client: TestClient, team: Team, archived: Project
) -> None:
    act_as(client, team, Role.OWNER)

    response = client.post(tasks_url(archived.id), json={"title": "Task"})

    assert_error(
        response,
        409,
        "conflict",
        reason="project_archived",
        message="This project is archived, so its tasks are read-only",
    )
    assert list_tasks(client, archived.id) == []


def test_archived_check_comes_before_the_assignee_check(
    client: TestClient, team: Team, archived: Project
) -> None:
    act_as(client, team, Role.OWNER)

    response = client.post(
        tasks_url(archived.id), json={"title": "Task", "assignee_id": str(team.outsider.id)}
    )

    assert_error(response, 409, "conflict", reason="project_archived")


@pytest.mark.parametrize("body", [{}, {"title": "Renamed"}, {"status": "done"}])
def test_update_in_an_archived_project_conflicts(
    client: TestClient, db_session: Session, team: Team, archived: Project, body: Json
) -> None:
    task = make_task(db_session, archived, title="Frozen")
    act_as(client, team, Role.OWNER)
    before = get_task(client, task.id)

    response = client.patch(task_url(task.id), json=body)

    assert_error(response, 409, "conflict", reason="project_archived")
    assert get_task(client, task.id) == before


def test_tasks_of_an_archived_project_can_still_be_read_and_deleted(
    client: TestClient, db_session: Session, team: Team, archived: Project
) -> None:
    keep, doomed = make_task(db_session, archived), make_task(db_session, archived)
    act_as(client, team, Role.ADMIN)

    assert ids(list_tasks(client, archived.id)) == [str(keep.id), str(doomed.id)]
    assert get_task(client, keep.id)["key"] == "OLD-1"
    assert client.delete(task_url(doomed.id)).status_code == 204
    assert ids(list_tasks(client, archived.id)) == [str(keep.id)]


def test_archiving_makes_existing_tasks_read_only(
    client: TestClient, team: Team, project: Project
) -> None:
    act_as(client, team, Role.OWNER)
    task = create_task(client, project.id, title="Task")

    assert client.post(f"/api/projects/{project.id}/archive").status_code == 200

    assert_error(
        client.patch(task_url(task["id"]), json={"title": "Late"}),
        409,
        "conflict",
        reason="project_archived",
    )
    assert_error(
        client.post(tasks_url(project.id), json={"title": "Late"}),
        409,
        "conflict",
        reason="project_archived",
    )


# --- list and filters -------------------------------------------------------------------


def test_list_is_empty_without_tasks(client: TestClient, team: Team, project: Project) -> None:
    act_as(client, team, Role.VIEWER)

    assert list_tasks(client, project.id) == []


def test_list_orders_by_status_then_position(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    done = make_task(db_session, project, status=TaskStatus.DONE, position=1.0)
    review = make_task(db_session, project, status=TaskStatus.IN_REVIEW, position=-5.0)
    todo_late = make_task(db_session, project, status=TaskStatus.TODO, position=3000.0)
    progress = make_task(db_session, project, status=TaskStatus.IN_PROGRESS, position=10.0)
    todo_early = make_task(db_session, project, status=TaskStatus.TODO, position=-2.5)
    todo_mid = make_task(db_session, project, status=TaskStatus.TODO, position=1024.0)
    # Equal positions keep a stable order: by number.
    todo_tie = make_task(db_session, project, status=TaskStatus.TODO, position=1024.0)
    act_as(client, team, Role.VIEWER)

    body = list_tasks(client, project.id)

    expected = [todo_early, todo_mid, todo_tie, todo_late, progress, review, done]
    assert ids(body) == [str(task.id) for task in expected]
    assert all(set(task) == TASK_FIELDS for task in body)


def test_list_returns_only_the_projects_tasks(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    mine = make_task(db_session, project)
    make_task(db_session, create_project(db_session, team.workspace, key="APP"))
    act_as(client, team, Role.VIEWER)

    assert ids(list_tasks(client, project.id)) == [str(mine.id)]


@pytest.fixture
def board(db_session: Session, team: Team, project: Project) -> dict[str, Task]:
    """Tasks that differ in every filtered field."""
    member, viewer = team.users[Role.MEMBER], team.users[Role.VIEWER]
    return {
        "login": make_task(
            db_session,
            project,
            title="Fix LOGIN redirect",
            description="Users land on /404",
            status=TaskStatus.IN_PROGRESS,
            priority=TaskPriority.HIGH,
            assignee=member,
            due_date=date(2026, 12, 1),
        ),
        "copy": make_task(
            db_session,
            project,
            title="Write onboarding copy",
            description="Mention the login page",
            status=TaskStatus.TODO,
            priority=TaskPriority.MEDIUM,
            due_date=date(2026, 12, 2),
        ),
        "percent": make_task(
            db_session,
            project,
            title="Reach 100% coverage",
            status=TaskStatus.DONE,
            priority=TaskPriority.LOW,
            assignee=viewer,
        ),
        "underscore": make_task(
            db_session,
            project,
            title="Rename snake_case fields",
            description="back\\slash",
            status=TaskStatus.TODO,
            priority=TaskPriority.URGENT,
            assignee=member,
            due_date=date(2026, 11, 30),
        ),
        "decoy": make_task(
            db_session,
            project,
            title="Rename snakeXcase and 100 percent",
            status=TaskStatus.IN_REVIEW,
            priority=TaskPriority.HIGH,
        ),
    }


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({}, ["copy", "underscore", "login", "decoy", "percent"]),
        ({"status": "todo"}, ["copy", "underscore"]),
        ({"status": ["todo", "done"]}, ["copy", "underscore", "percent"]),
        ({"priority": "high"}, ["login", "decoy"]),
        ({"priority": ["low", "urgent"]}, ["underscore", "percent"]),
        ({"assignee_id": "none"}, ["copy", "decoy"]),
        ({"due_before": "2026-12-01"}, ["underscore", "login"]),
        ({"due_before": "2026-11-29"}, []),
        ({"due_before": "2027-01-01"}, ["copy", "underscore", "login"]),
        ({"q": "login"}, ["copy", "login"]),
        ({"q": "  LOGIN  "}, ["copy", "login"]),
        ({"q": "/404"}, ["login"]),
        ({"q": "100%"}, ["percent"]),
        ({"q": "%"}, ["percent"]),
        ({"q": "snake_case"}, ["underscore"]),
        ({"q": "_"}, ["underscore"]),
        ({"q": "\\"}, ["underscore"]),
        ({"q": "nothing matches"}, []),
        ({"status": "todo", "priority": "urgent"}, ["underscore"]),
        ({"status": ["todo", "in_progress"], "q": "login", "due_before": "2026-12-01"}, ["login"]),
    ],
)
def test_list_filters(
    client: TestClient,
    team: Team,
    project: Project,
    board: dict[str, Task],
    params: dict[str, Any],
    expected: list[str],
) -> None:
    act_as(client, team, Role.VIEWER)

    body = list_tasks(client, project.id, **params)

    assert ids(body) == [str(board[name].id) for name in expected]


def test_list_filters_by_assignee(
    client: TestClient, team: Team, project: Project, board: dict[str, Task]
) -> None:
    act_as(client, team, Role.VIEWER)

    by_member = list_tasks(client, project.id, assignee_id=str(team.users[Role.MEMBER].id))
    by_outsider = list_tasks(client, project.id, assignee_id=str(team.outsider.id))

    assert ids(by_member) == [str(board["underscore"].id), str(board["login"].id)]
    assert by_outsider == []


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"status": "blocked"}, "status.0"),
        ({"status": ["todo", "blocked"]}, "status.1"),
        ({"priority": "critical"}, "priority.0"),
        ({"assignee_id": "nobody"}, "assignee_id"),
        ({"assignee_id": "None"}, "assignee_id"),
        ({"due_before": "next week"}, "due_before"),
        ({"due_before": "2026-02-30"}, "due_before"),
        ({"q": ""}, "q"),
        ({"q": "   "}, "q"),
        ({"q": "q" * 201}, "q"),
    ],
)
def test_list_rejects_invalid_filters(
    client: TestClient, team: Team, project: Project, params: dict[str, Any], field: str
) -> None:
    act_as(client, team, Role.VIEWER)

    response = client.get(tasks_url(project.id), params=params)

    assert validation_fields(response) == {(field, "query")}


def test_invalid_assignee_filter_has_a_clear_message(
    client: TestClient, team: Team, project: Project
) -> None:
    act_as(client, team, Role.VIEWER)

    response = client.get(tasks_url(project.id), params={"assignee_id": "nobody"})

    assert response.json()["error"]["details"]["errors"][0]["message"] == (
        "Input should be a valid UUID or 'none'"
    )


def test_q_accepts_200_characters(client: TestClient, team: Team, project: Project) -> None:
    act_as(client, team, Role.VIEWER)

    assert list_tasks(client, project.id, q="q" * 200) == []


# --- get --------------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_get_returns_the_task(
    client: TestClient, db_session: Session, team: Team, project: Project, role: Role
) -> None:
    task = make_task(
        db_session,
        project,
        title="Fix login",
        description="Details",
        status=TaskStatus.IN_REVIEW,
        priority=TaskPriority.URGENT,
        position=12.5,
        assignee=team.users[Role.VIEWER],
        due_date=date(2026, 12, 24),
    )
    act_as(client, team, role)

    body = get_task(client, task.id)

    assert body == {
        "id": str(task.id),
        "project_id": str(project.id),
        "workspace_id": str(team.workspace.id),
        "number": 1,
        "key": "WEB-1",
        "title": "Fix login",
        "description": "Details",
        "status": "in_review",
        "priority": "urgent",
        "position": 12.5,
        "assignee": {"id": str(team.users[Role.VIEWER].id), "name": "Viewer User"},
        "due_date": "2026-12-24",
        "comment_count": 0,
        "created_by": str(team.owner.id),
        "created_at": body["created_at"],
        "updated_at": body["updated_at"],
    }


# --- update -----------------------------------------------------------------------------


@pytest.fixture
def task(client: TestClient, team: Team, project: Project) -> Json:
    """A task created through the API by the member, who stays logged in."""
    act_as(client, team, Role.MEMBER)
    return create_task(
        client,
        project.id,
        title="Fix login",
        description="Details",
        priority="high",
        assignee_id=str(team.users[Role.MEMBER].id),
        due_date="2026-12-01",
    )


@pytest.mark.parametrize("role", WRITERS)
def test_update_changes_every_editable_field(
    client: TestClient, team: Team, task: Json, role: Role
) -> None:
    act_as(client, team, role)
    viewer = team.users[Role.VIEWER]

    updated = patch_task(
        client,
        task["id"],
        {
            "title": "  Fix login redirect ",
            "description": " New details ",
            "priority": "urgent",
            "assignee_id": str(viewer.id),
            "due_date": "2026-12-03",
        },
    )

    assert updated == task | {
        "title": "Fix login redirect",
        "description": "New details",
        "priority": "urgent",
        "assignee": {"id": str(viewer.id), "name": "Viewer User"},
        "due_date": "2026-12-03",
        "updated_at": updated["updated_at"],
    }


def test_update_with_nulls_clears_the_nullable_fields(client: TestClient, task: Json) -> None:
    updated = patch_task(
        client, task["id"], {"description": None, "assignee_id": None, "due_date": None}
    )

    assert updated == task | {
        "description": None,
        "assignee": None,
        "due_date": None,
        "updated_at": updated["updated_at"],
    }


@pytest.mark.parametrize(
    ("body", "changes"),
    [
        ({"title": "Renamed"}, {"title": "Renamed"}),
        ({"priority": "low"}, {"priority": "low"}),
        ({"due_date": "2027-01-15"}, {"due_date": "2027-01-15"}),
        ({"description": ""}, {"description": ""}),
        ({}, {}),
        ({"title": "Fix login", "priority": "high", "status": "todo"}, {}),
    ],
)
def test_update_leaves_omitted_fields_unchanged(
    client: TestClient, task: Json, body: Json, changes: Json
) -> None:
    updated = patch_task(client, task["id"], body)

    assert updated == task | changes | {"updated_at": updated["updated_at"]}


def test_update_ignores_server_controlled_fields(
    client: TestClient, db_session: Session, team: Team, task: Json
) -> None:
    other = create_project(db_session, team.workspace, key="APP")

    updated = patch_task(
        client,
        task["id"],
        {
            "title": "Renamed",
            "number": 42,
            "key": "APP-42",
            "position": -1,
            "project_id": str(other.id),
            "workspace_id": str(create_team(db_session).workspace.id),
            "created_by": str(team.owner.id),
            "comment_count": 3,
        },
    )

    assert updated == task | {"title": "Renamed", "updated_at": updated["updated_at"]}


def test_update_bumps_updated_at_only_when_something_changes(
    client: TestClient, db_session: Session, task: Json
) -> None:
    db_session.execute(update(Task).where(Task.id == UUID(task["id"])).values(updated_at=LONG_AGO))
    db_session.expire_all()

    unchanged = patch_task(client, task["id"], {"title": "Fix login"})
    changed = patch_task(client, task["id"], {"title": "Fix login now"})

    assert unchanged["updated_at"] == "2020-01-01T00:00:00Z"
    assert datetime.fromisoformat(changed["updated_at"]) > LONG_AGO
    assert changed["created_at"] == task["created_at"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", None),
        ("title", ""),
        ("title", "   "),
        ("title", "t" * 201),
        ("description", "d" * 10001),
        ("status", None),
        ("status", "blocked"),
        ("priority", None),
        ("priority", "critical"),
        ("assignee_id", "not-a-uuid"),
        ("due_date", "someday"),
    ],
)
def test_update_rejects_invalid_fields(
    client: TestClient, task: Json, field: str, value: Any
) -> None:
    response = client.patch(task_url(task["id"]), json={field: value})

    assert validation_fields(response) == {(field, "body")}
    assert get_task(client, task["id"]) == task


def test_update_assignee_must_be_a_member(client: TestClient, team: Team, task: Json) -> None:
    response = client.patch(
        task_url(task["id"]), json={"title": "Changed", "assignee_id": str(team.outsider.id)}
    )

    assert validation_fields(response) == {("assignee_id", "body")}
    assert response.json()["error"]["details"]["errors"][0]["message"] == (
        "Assignee must be a member of this workspace"
    )
    # Nothing changed, not even the valid title.
    assert get_task(client, task["id"]) == task


def test_update_keeps_an_assignee_who_left_the_workspace(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    """Only a new assignee is checked: editing other fields keeps the current one."""
    leaver = team.other_member
    act_as(client, team, Role.MEMBER)
    created = create_task(client, project.id, title="Task", assignee_id=str(leaver.id))
    log_in(client, leaver)
    leave = client.delete(f"/api/workspaces/{team.workspace.id}/members/{leaver.id}")
    assert leave.status_code == 204
    act_as(client, team, Role.MEMBER)

    updated = patch_task(client, created["id"], {"title": "Renamed", "assignee_id": str(leaver.id)})

    assert updated["assignee"] == {"id": str(leaver.id), "name": "Other Member"}
    assert validation_fields(
        client.post(tasks_url(project.id), json={"title": "New", "assignee_id": str(leaver.id)})
    ) == {("assignee_id", "body")}


def test_update_status_moves_the_task_to_the_end_of_the_new_column(
    client: TestClient, db_session: Session, project: Project, task: Json
) -> None:
    make_task(db_session, project, status=TaskStatus.DONE, position=100.0)
    make_task(db_session, project, status=TaskStatus.DONE, position=7000.5)

    updated = patch_task(client, task["id"], {"status": "done"})

    assert (updated["status"], updated["position"]) == ("done", 7000.5 + 1024)
    assert ids(list_tasks(client, project.id, status="done"))[-1] == task["id"]


def test_update_status_into_an_empty_column(client: TestClient, task: Json) -> None:
    updated = patch_task(client, task["id"], {"status": "in_review"})

    assert (updated["status"], updated["position"]) == ("in_review", 1024.0)


def test_update_with_the_same_status_keeps_the_position(
    client: TestClient, db_session: Session, project: Project, task: Json
) -> None:
    make_task(db_session, project, status=TaskStatus.TODO, position=9000.0)

    updated = patch_task(client, task["id"], {"status": "todo", "title": "Renamed"})

    assert (updated["status"], updated["position"]) == ("todo", task["position"])


# --- delete -----------------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.OWNER, Role.ADMIN])
def test_delete_removes_the_task(
    client: TestClient, db_session: Session, team: Team, project: Project, role: Role
) -> None:
    doomed, kept = make_task(db_session, project), make_task(db_session, project)
    act_as(client, team, role)

    response = client.delete(task_url(doomed.id))

    assert response.status_code == 204
    assert response.content == b""
    assert_error(client.get(task_url(doomed.id)), 404, "not_found", message="Task not found")
    assert_error(client.delete(task_url(doomed.id)), 404, "not_found", message="Task not found")
    assert ids(list_tasks(client, project.id)) == [str(kept.id)]


def test_deleting_a_project_or_workspace_deletes_its_tasks(
    client: TestClient, db_session: Session, team: Team, project: Project
) -> None:
    task = make_task(db_session, project)
    act_as(client, team, Role.OWNER)

    assert client.delete(f"/api/workspaces/{team.workspace.id}").status_code == 204

    assert_error(client.get(task_url(task.id)), 404, "not_found", message="Task not found")
