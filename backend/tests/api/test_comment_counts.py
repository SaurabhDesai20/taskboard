"""`Task.comment_count` (contract sections 2.2 and 3.6): the task's current number of comments on
every task response, computed in the task queries themselves (no query per task)."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.services.permissions import Role
from tests.api.comment_helpers import comment_url, post_comment
from tests.api.task_helpers import (
    Json,
    create_task,
    get_task,
    list_tasks,
    move_task,
    patch_task,
    task_url,
)
from tests.factories import Team, create_comment, create_project, create_team, log_in
from tests.factories import create_task as make_task


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


@pytest.fixture
def member(team: Team) -> User:
    return team.users[Role.MEMBER]


@pytest.fixture
def project(db_session: Session, team: Team) -> Project:
    return create_project(db_session, team.workspace, key="WEB")


def my_tasks(client: TestClient) -> list[Json]:
    response = client.get("/api/me/tasks")
    assert response.status_code == 200, response.text
    tasks: list[Json] = response.json()
    return tasks


def counts(tasks: list[Json]) -> dict[str, int]:
    return {task["id"]: task["comment_count"] for task in tasks}


def add_comments(db: Session, task: Task, author: User, n: int) -> None:
    for _ in range(n):
        create_comment(db, task, author)


def test_every_task_read_has_its_own_comment_count(
    client: TestClient, db_session: Session, team: Team, member: User, project: Project
) -> None:
    tasks = [make_task(db_session, project, assignee=member) for _ in range(3)]
    add_comments(db_session, tasks[0], member, 3)
    add_comments(db_session, tasks[1], team.owner, 1)
    # Comments elsewhere never count: another project, another workspace.
    add_comments(
        db_session, make_task(db_session, create_project(db_session, team.workspace)), member, 2
    )
    other = create_team(db_session)
    add_comments(
        db_session,
        make_task(db_session, create_project(db_session, other.workspace)),
        other.owner,
        4,
    )
    expected = {str(tasks[0].id): 3, str(tasks[1].id): 1, str(tasks[2].id): 0}
    log_in(client, member)

    assert counts(list_tasks(client, project.id)) == expected
    assert {tid: get_task(client, tid)["comment_count"] for tid in expected} == expected
    assert counts(my_tasks(client)) == expected


def test_posting_and_deleting_comments_changes_the_count(
    client: TestClient, db_session: Session, member: User, project: Project
) -> None:
    task = make_task(db_session, project, assignee=member)
    log_in(client, member)

    created = [post_comment(client, task.id, f"Comment {n}") for n in range(3)]
    assert get_task(client, task.id)["comment_count"] == 3

    assert client.delete(comment_url(created[0]["id"])).status_code == 204
    assert client.patch(comment_url(created[1]["id"]), json={"body": "Edited"}).status_code == 200

    assert get_task(client, task.id)["comment_count"] == 2
    assert counts(list_tasks(client, project.id)) == {str(task.id): 2}
    assert counts(my_tasks(client)) == {str(task.id): 2}


def test_task_write_responses_carry_the_comment_count(
    client: TestClient, db_session: Session, member: User, project: Project
) -> None:
    task = make_task(db_session, project, status=TaskStatus.TODO)
    add_comments(db_session, task, member, 2)
    log_in(client, member)

    assert patch_task(client, task.id, {"title": "Renamed"})["comment_count"] == 2
    assert patch_task(client, task.id, {})["comment_count"] == 2
    assert patch_task(client, task.id, {"status": "done"})["comment_count"] == 2
    assert move_task(client, task.id, "in_review")["comment_count"] == 2
    assert create_task(client, project.id, title="Brand new")["comment_count"] == 0


def test_a_deleted_task_takes_its_count_with_it(
    client: TestClient, db_session: Session, team: Team, member: User, project: Project
) -> None:
    kept = make_task(db_session, project)
    gone = make_task(db_session, project)
    add_comments(db_session, kept, member, 1)
    add_comments(db_session, gone, member, 2)
    log_in(client, team.owner)

    assert client.delete(task_url(gone.id)).status_code == 204

    assert counts(list_tasks(client, project.id)) == {str(kept.id): 1}


# --- no query per task -------------------------------------------------------------------


@contextmanager
def recorded_statements(db: Session) -> Iterator[list[str]]:
    """Every SQL statement the session's connection runs inside the block."""
    statements: list[str] = []
    connection = db.connection()

    def record(*args: Any) -> None:
        statements.append(args[2])

    event.listen(connection, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(connection, "before_cursor_execute", record)


def statements_for(client: TestClient, db: Session, path: str) -> int:
    with recorded_statements(db) as statements:
        response = client.get(path)
        assert response.status_code == 200, response.text
    return len(statements)


@pytest.mark.parametrize("path", ["/api/projects/{pid}/tasks", "/api/me/tasks"])
def test_task_lists_count_comments_without_a_query_per_task(
    client: TestClient, db_session: Session, member: User, project: Project, path: str
) -> None:
    url = path.format(pid=project.id)
    log_in(client, member)
    first = make_task(db_session, project, assignee=member)
    add_comments(db_session, first, member, 2)
    with_one_task = statements_for(client, db_session, url)

    for n in range(5):
        add_comments(db_session, make_task(db_session, project, assignee=member), member, n)
    with_six_tasks = statements_for(client, db_session, url)

    # The listener sees the request's queries (session, membership, tasks, ...).
    assert with_one_task > 0
    assert with_six_tasks == with_one_task
    counted = counts(list_tasks(client, project.id))
    assert sorted(counted.values()) == [0, 1, 2, 2, 3, 4]
