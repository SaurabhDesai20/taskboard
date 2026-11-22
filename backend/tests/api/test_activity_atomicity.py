"""A failed mutation writes no activity entry (contract section 3.8, CLAUDE.md rule 2).

Two halves:
- Rejected requests (403, 404, 409, 422) never reach `record()`: every check runs first. These use
  the usual shared, never-rolled-back test session, so an entry written before the rejection
  would still be visible.
- A failure after `record()` but before the commit rolls the entry back together with the
  change. These need the production setup: one session per request, closed (and so rolled back)
  when the request ends, on committed data that other connections can see. Their fixture deletes
  what it committed.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.core.security import ACCESS_TOKEN_COOKIE
from app.models.activity import ActivityLog
from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.repositories import activity as activity_repo
from app.services.permissions import Role
from tests.api.helpers import assert_error
from tests.concurrency import new_session
from tests.conftest import CSRF_HEADERS
from tests.factories import (
    Team,
    access_token_for,
    add_member,
    create_comment,
    create_project,
    create_task,
    create_team,
    create_user,
    create_workspace,
    log_in,
)

# --- rejected requests write nothing ------------------------------------------------------


@dataclass(frozen=True)
class Scene:
    team: Team
    project: Project
    archived: Project
    task: Task
    archived_task: Task
    # Written by `team.other_member`.
    comment: Comment

    @property
    def ws(self) -> str:
        return f"/api/workspaces/{self.team.workspace.id}"

    def member(self, user: User) -> str:
        return f"{self.ws}/members/{user.id}"


@pytest.fixture
def scene(db_session: Session) -> Scene:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace, key="WEB")
    archived = create_project(db_session, team.workspace, key="OLD")
    task = create_task(db_session, project)
    archived_task = create_task(db_session, archived)
    comment = create_comment(db_session, task, team.other_member)
    # Archived after its task was created.
    archived.archived_at = func.now()
    db_session.flush()
    return Scene(team, project, archived, task, archived_task, comment)


OUTSIDER = None

Rejection = tuple[Role | None, str, Callable[[Scene], str], Callable[[Scene], Any], int]

# (who, method, url, body, status). `who` is a role in the team, or OUTSIDER.
REJECTED: dict[str, Rejection] = {
    "workspace create, slug taken": (
        Role.OWNER,
        "POST",
        lambda s: "/api/workspaces",
        lambda s: {"name": "Copy", "slug": s.team.workspace.slug},
        409,
    ),
    "rename by an admin": (Role.ADMIN, "PATCH", lambda s: s.ws, lambda s: {"name": "X"}, 403),
    "rename to a blank name": (Role.OWNER, "PATCH", lambda s: s.ws, lambda s: {"name": " "}, 422),
    "rename by an outsider": (OUTSIDER, "PATCH", lambda s: s.ws, lambda s: {"name": "X"}, 404),
    "add member by a member": (
        Role.MEMBER,
        "POST",
        lambda s: f"{s.ws}/members",
        lambda s: {"email": s.team.outsider.email, "role": "member"},
        403,
    ),
    "add member, unknown email": (
        Role.OWNER,
        "POST",
        lambda s: f"{s.ws}/members",
        lambda s: {"email": "nobody@example.com", "role": "member"},
        422,
    ),
    "add member, already a member": (
        Role.OWNER,
        "POST",
        lambda s: f"{s.ws}/members",
        lambda s: {"email": s.team.users[Role.MEMBER].email, "role": "viewer"},
        409,
    ),
    "add member, admin grants admin": (
        Role.ADMIN,
        "POST",
        lambda s: f"{s.ws}/members",
        lambda s: {"email": s.team.outsider.email, "role": "admin"},
        403,
    ),
    "change own role": (
        Role.OWNER,
        "PATCH",
        lambda s: s.member(s.team.owner),
        lambda s: {"role": "admin"},
        403,
    ),
    "admin changes an owner": (
        Role.ADMIN,
        "PATCH",
        lambda s: s.member(s.team.owner),
        lambda s: {"role": "member"},
        403,
    ),
    "change role to null": (
        Role.OWNER,
        "PATCH",
        lambda s: s.member(s.team.users[Role.MEMBER]),
        lambda s: {"role": None},
        422,
    ),
    "the last owner leaves": (
        Role.OWNER,
        "DELETE",
        lambda s: s.member(s.team.owner),
        lambda s: None,
        409,
    ),
    "a member removes someone": (
        Role.MEMBER,
        "DELETE",
        lambda s: s.member(s.team.other_member),
        lambda s: None,
        403,
    ),
    "remove a non-member": (
        Role.OWNER,
        "DELETE",
        lambda s: s.member(s.team.outsider),
        lambda s: None,
        404,
    ),
    "project create by a member": (
        Role.MEMBER,
        "POST",
        lambda s: f"{s.ws}/projects",
        lambda s: {"name": "X", "key": "XX"},
        403,
    ),
    "project create, key taken": (
        Role.OWNER,
        "POST",
        lambda s: f"{s.ws}/projects",
        lambda s: {"name": "X", "key": "WEB"},
        409,
    ),
    "project create, bad key": (
        Role.OWNER,
        "POST",
        lambda s: f"{s.ws}/projects",
        lambda s: {"name": "X", "key": "web"},
        422,
    ),
    "project update by a member": (
        Role.MEMBER,
        "PATCH",
        lambda s: f"/api/projects/{s.project.id}",
        lambda s: {"name": "X"},
        403,
    ),
    "project update, null name": (
        Role.OWNER,
        "PATCH",
        lambda s: f"/api/projects/{s.project.id}",
        lambda s: {"name": None, "description": "valid"},
        422,
    ),
    "archive twice": (
        Role.OWNER,
        "POST",
        lambda s: f"/api/projects/{s.archived.id}/archive",
        lambda s: None,
        409,
    ),
    "task create by a viewer": (
        Role.VIEWER,
        "POST",
        lambda s: f"/api/projects/{s.project.id}/tasks",
        lambda s: {"title": "X"},
        403,
    ),
    "task create in an archived project": (
        Role.MEMBER,
        "POST",
        lambda s: f"/api/projects/{s.archived.id}/tasks",
        lambda s: {"title": "X"},
        409,
    ),
    "task create, assignee not a member": (
        Role.MEMBER,
        "POST",
        lambda s: f"/api/projects/{s.project.id}/tasks",
        lambda s: {"title": "X", "assignee_id": str(s.team.outsider.id)},
        422,
    ),
    "task update, valid fields and a bad assignee": (
        Role.MEMBER,
        "PATCH",
        lambda s: f"/api/tasks/{s.task.id}",
        lambda s: {
            "title": "X",
            "status": "done",
            "due_date": "2026-12-01",
            "assignee_id": str(s.team.outsider.id),
        },
        422,
    ),
    "task update in an archived project": (
        Role.MEMBER,
        "PATCH",
        lambda s: f"/api/tasks/{s.archived_task.id}",
        lambda s: {"title": "X"},
        409,
    ),
    "task update by an outsider": (
        OUTSIDER,
        "PATCH",
        lambda s: f"/api/tasks/{s.task.id}",
        lambda s: {"title": "X"},
        404,
    ),
    "move next to a task of another project": (
        Role.MEMBER,
        "POST",
        lambda s: f"/api/tasks/{s.task.id}/move",
        lambda s: {"status": "todo", "after_task_id": str(s.archived_task.id)},
        422,
    ),
    "move by a viewer": (
        Role.VIEWER,
        "POST",
        lambda s: f"/api/tasks/{s.task.id}/move",
        lambda s: {"status": "done"},
        403,
    ),
    "task delete by a member": (
        Role.MEMBER,
        "DELETE",
        lambda s: f"/api/tasks/{s.task.id}",
        lambda s: None,
        403,
    ),
    "comment by a viewer": (
        Role.VIEWER,
        "POST",
        lambda s: f"/api/tasks/{s.task.id}/comments",
        lambda s: {"body": "X"},
        403,
    ),
    "comment in an archived project": (
        Role.MEMBER,
        "POST",
        lambda s: f"/api/tasks/{s.archived_task.id}/comments",
        lambda s: {"body": "X"},
        409,
    ),
    "blank comment": (
        Role.MEMBER,
        "POST",
        lambda s: f"/api/tasks/{s.task.id}/comments",
        lambda s: {"body": "   "},
        422,
    ),
    "edit someone else's comment": (
        Role.OWNER,
        "PATCH",
        lambda s: f"/api/comments/{s.comment.id}",
        lambda s: {"body": "X"},
        403,
    ),
    "a member deletes someone else's comment": (
        Role.MEMBER,
        "DELETE",
        lambda s: f"/api/comments/{s.comment.id}",
        lambda s: None,
        403,
    ),
    "comment edit by an outsider": (
        OUTSIDER,
        "PATCH",
        lambda s: f"/api/comments/{s.comment.id}",
        lambda s: {"body": "X"},
        404,
    ),
}


def activity_rows(db: Session) -> int:
    count = db.scalar(select(func.count()).select_from(ActivityLog))
    assert isinstance(count, int)
    return count


@pytest.mark.parametrize("case", list(REJECTED))
def test_a_rejected_request_records_nothing(
    client: TestClient, db_session: Session, scene: Scene, case: str
) -> None:
    who, method, url, body, status = REJECTED[case]
    log_in(client, scene.team.outsider if who is OUTSIDER else scene.team.users[who])
    before = activity_rows(db_session)

    response = client.request(method, url(scene), json=body(scene))

    assert response.status_code == status, response.text
    assert activity_rows(db_session) == before


# --- a failure after record() rolls the entry back with the change ------------------------


@dataclass(frozen=True)
class World:
    """Committed: Asha owns the workspace; Ben is a member; Cara is registered but not a member.
    The project has one task with one comment by Asha."""

    engine: Engine
    asha: UUID
    ben: UUID
    cara_email: str
    workspace_id: UUID
    project_id: UUID
    task_id: UUID
    comment_id: UUID


@pytest.fixture
def world(engine: Engine) -> Iterator[World]:
    with Session(engine) as db:
        asha = create_user(db, name="Asha Rao")
        ben = create_user(db, name="Ben Okafor")
        cara = create_user(db, name="Cara Diaz")
        workspace = create_workspace(db, owner=asha)
        add_member(db, workspace, ben, Role.MEMBER)
        project = create_project(db, workspace, key="ROLL")
        task = create_task(db, project, title="Original")
        comment = create_comment(db, task, asha, body="Original")
        db.commit()
        built = World(
            engine=engine,
            asha=asha.id,
            ben=ben.id,
            cara_email=cara.email,
            workspace_id=workspace.id,
            project_id=project.id,
            task_id=task.id,
            comment_id=comment.id,
        )
        user_ids = [asha.id, ben.id, cara.id]
    try:
        yield built
    finally:
        with Session(engine) as db:
            # Cascades to the members, projects, tasks, comments and activity.
            db.execute(delete(Workspace).where(Workspace.created_by.in_(user_ids)))
            db.execute(delete(User).where(User.id.in_(user_ids)))
            db.commit()


@pytest.fixture
def request_client(engine: Engine) -> Iterator[TestClient]:
    """Like production: every request gets its own session, closed when the request ends, so
    whatever it did not commit is rolled back. Unexpected errors become 500 responses."""
    from app.api.deps import get_db
    from app.main import create_app

    def session_per_request() -> Iterator[Session]:
        session = new_session(engine)
        try:
            yield session
        finally:
            session.close()

    app = create_app()
    app.dependency_overrides[get_db] = session_per_request
    with TestClient(app, headers=CSRF_HEADERS, raise_server_exceptions=False) as client:
        yield client


def arm_failure(monkeypatch: pytest.MonkeyPatch, *, on_call: int = 1) -> list[UUID]:
    """Make the `on_call`-th activity insert succeed (flushed to the database) and then raise,
    as if the request broke after `record()` and before its commit. Returns the ids of the
    entries inserted meanwhile."""
    real_add = activity_repo.add
    inserted: list[UUID] = []

    def add(db: Session, **fields: Any) -> ActivityLog:
        entry = real_add(db, **fields)
        inserted.append(entry.id)
        if len(inserted) == on_call:
            raise RuntimeError("simulated failure after record(), before commit")
        return entry

    monkeypatch.setattr(activity_repo, "add", add)
    return inserted


def snapshot(world: World) -> dict[str, list[tuple[Any, ...]]]:
    """Everything the mutations below could change, read on a new connection."""
    ws = world.workspace_id
    queries = {
        "workspaces": select(Workspace.id, Workspace.name),
        "members": select(WorkspaceMember.user_id, WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == ws
        ),
        "projects": select(
            Project.id, Project.name, Project.description, Project.archived_at
        ).where(Project.workspace_id == ws),
        "tasks": select(
            Task.id,
            Task.title,
            Task.status,
            Task.priority,
            Task.position,
            Task.assignee_id,
            Task.due_date,
            Task.updated_at,
        ).where(Task.workspace_id == ws),
        "comments": select(Comment.id, Comment.body, Comment.edited_at).where(
            Comment.workspace_id == ws
        ),
        "activity": select(ActivityLog.id),
    }
    with new_session(world.engine) as db:
        return {
            name: sorted((tuple(row) for row in db.execute(query)), key=str)
            for name, query in queries.items()
        }


def as_user(client: TestClient, user_id: UUID) -> TestClient:
    client.cookies.set(ACCESS_TOKEN_COOKIE, access_token_for(user_id))
    return client


Mutation = Callable[[TestClient, World], httpx2.Response]

MUTATIONS: dict[str, Mutation] = {
    "workspace.created": lambda c, w: as_user(c, w.asha).post(
        "/api/workspaces", json={"name": "Doomed"}
    ),
    "workspace.renamed": lambda c, w: as_user(c, w.asha).patch(
        f"/api/workspaces/{w.workspace_id}", json={"name": "Renamed"}
    ),
    "member.added": lambda c, w: as_user(c, w.asha).post(
        f"/api/workspaces/{w.workspace_id}/members", json={"email": w.cara_email, "role": "member"}
    ),
    "member.role_changed": lambda c, w: as_user(c, w.asha).patch(
        f"/api/workspaces/{w.workspace_id}/members/{w.ben}", json={"role": "viewer"}
    ),
    "member.removed": lambda c, w: as_user(c, w.ben).delete(
        f"/api/workspaces/{w.workspace_id}/members/{w.ben}"
    ),
    "project.created": lambda c, w: as_user(c, w.asha).post(
        f"/api/workspaces/{w.workspace_id}/projects", json={"name": "New", "key": "NEW"}
    ),
    "project.updated": lambda c, w: as_user(c, w.asha).patch(
        f"/api/projects/{w.project_id}", json={"name": "Renamed", "description": "Changed"}
    ),
    "project.archived": lambda c, w: as_user(c, w.asha).post(
        f"/api/projects/{w.project_id}/archive"
    ),
    "task.created": lambda c, w: as_user(c, w.ben).post(
        f"/api/projects/{w.project_id}/tasks", json={"title": "New"}
    ),
    "task.updated": lambda c, w: as_user(c, w.ben).patch(
        f"/api/tasks/{w.task_id}", json={"title": "Changed", "priority": "high"}
    ),
    "task.assigned": lambda c, w: as_user(c, w.ben).patch(
        f"/api/tasks/{w.task_id}", json={"assignee_id": str(w.ben)}
    ),
    "task.due_date_changed": lambda c, w: as_user(c, w.ben).patch(
        f"/api/tasks/{w.task_id}", json={"due_date": "2026-12-01"}
    ),
    "task.moved": lambda c, w: as_user(c, w.ben).post(
        f"/api/tasks/{w.task_id}/move", json={"status": "done"}
    ),
    "task.deleted": lambda c, w: as_user(c, w.asha).delete(f"/api/tasks/{w.task_id}"),
    "comment.created": lambda c, w: as_user(c, w.ben).post(
        f"/api/tasks/{w.task_id}/comments", json={"body": "New"}
    ),
    "comment.edited": lambda c, w: as_user(c, w.asha).patch(
        f"/api/comments/{w.comment_id}", json={"body": "Changed"}
    ),
    "comment.deleted": lambda c, w: as_user(c, w.asha).delete(f"/api/comments/{w.comment_id}"),
}


@pytest.mark.parametrize("action", list(MUTATIONS))
def test_a_failure_after_record_rolls_back_the_entry_and_the_change(
    request_client: TestClient, world: World, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    inserted = arm_failure(monkeypatch)
    before = snapshot(world)

    response = MUTATIONS[action](request_client, world)

    assert_error(response, 500, "internal_error")
    # The entry reached the database inside the request's transaction...
    assert len(inserted) == 1
    # ...and is gone, together with the change it described.
    assert snapshot(world) == before


@pytest.mark.parametrize("action", list(MUTATIONS))
def test_without_a_failure_the_same_request_commits_its_entry(
    request_client: TestClient, world: World, action: str
) -> None:
    """The control for the test above: each mutation really changes data and records `action`."""
    before = snapshot(world)

    response = MUTATIONS[action](request_client, world)

    assert response.status_code in (200, 201, 204), response.text
    after = snapshot(world)
    assert after != before
    new_ids = {row[0] for row in after["activity"]} - {row[0] for row in before["activity"]}
    with new_session(world.engine) as db:
        actions = db.scalars(select(ActivityLog.action).where(ActivityLog.id.in_(new_ids))).all()
    assert actions == [action]


def test_a_failure_on_the_second_entry_rolls_back_the_first(
    request_client: TestClient, world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    inserted = arm_failure(monkeypatch, on_call=2)
    before = snapshot(world)

    response = as_user(request_client, world.ben).patch(
        f"/api/tasks/{world.task_id}", json={"title": "Changed", "status": "done"}
    )

    assert_error(response, 500, "internal_error")
    assert len(inserted) == 2
    assert snapshot(world) == before
