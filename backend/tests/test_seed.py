"""python -m app.seed: demo data written through the services, idempotent."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.activity import ActivityAction, ActivityLog
from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.seed import DEMO_PASSWORD, DEMO_USERS, PROJECTS, WORKSPACE_SLUG, SeedError, seed
from app.services.permissions import Role
from tests.factories import create_user, create_workspace

TODAY = date(2026, 11, 22)
MODELS = (User, Workspace, WorkspaceMember, Project, Task, Comment, ActivityLog)


def counts(db: Session) -> dict[str, int]:
    return {
        model.__name__: db.scalar(select(func.count()).select_from(model)) or 0 for model in MODELS
    }


def test_seed_creates_the_demo_workspace(db_session: Session) -> None:
    result = seed(db_session, get_settings(), today=TODAY)

    workspace = db_session.scalars(select(Workspace).where(Workspace.slug == WORKSPACE_SLUG)).one()
    assert workspace.name == "Acme"
    assert result.workspace_id == workspace.id

    rows = db_session.execute(
        select(User.email, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace.id)
    )
    roles = {email: role for email, role in rows}
    assert roles == {user.email: user.role for user in DEMO_USERS}
    assert set(roles.values()) == set(Role)

    projects = db_session.scalars(select(Project).where(Project.workspace_id == workspace.id)).all()
    assert {p.key: p.archived_at is not None for p in projects} == {
        "WEB": False,
        "MOB": False,
        "L25": True,
    }

    tasks = db_session.scalars(select(Task).where(Task.workspace_id == workspace.id)).all()
    assert len(tasks) == sum(len(spec.tasks) for spec in PROJECTS)
    assert {task.status for task in tasks} == set(TaskStatus)
    assert any(task.assignee_id is not None for task in tasks)
    assert any(task.assignee_id is None for task in tasks)
    open_tasks = [task for task in tasks if task.status is not TaskStatus.DONE]
    assert any(task.due_date is not None and task.due_date < TODAY for task in open_tasks)
    assert any(task.due_date is not None and task.due_date >= TODAY for task in open_tasks)
    assert TODAY + timedelta(days=-2) in {task.due_date for task in tasks}

    assert result.comments == db_session.scalar(
        select(func.count()).select_from(Comment).where(Comment.workspace_id == workspace.id)
    )
    assert result.comments > 0
    assert (result.users, result.members, result.projects) == (5, 4, 3)


def test_seed_writes_activity_through_the_services(db_session: Session) -> None:
    result = seed(db_session, get_settings(), today=TODAY)

    actions = set(
        db_session.scalars(
            select(ActivityLog.action).where(ActivityLog.workspace_id == result.workspace_id)
        )
    )
    assert actions == {
        ActivityAction.WORKSPACE_CREATED,
        ActivityAction.MEMBER_ADDED,
        ActivityAction.PROJECT_CREATED,
        ActivityAction.PROJECT_ARCHIVED,
        ActivityAction.TASK_CREATED,
        ActivityAction.TASK_MOVED,
        ActivityAction.COMMENT_CREATED,
    }


def test_seed_is_idempotent(db_session: Session) -> None:
    seed(db_session, get_settings(), today=TODAY)
    after_first = counts(db_session)

    again = seed(db_session, get_settings(), today=TODAY + timedelta(days=3))

    assert counts(db_session) == after_first
    assert (again.users, again.members, again.projects, again.tasks, again.comments) == (
        0,
        0,
        0,
        0,
        0,
    )


def test_seed_keeps_existing_users_and_fills_in_what_is_missing(db_session: Session) -> None:
    existing = create_user(db_session, email=DEMO_USERS[2].email, name="Someone Else")

    result = seed(db_session, get_settings(), today=TODAY)

    assert result.users == len(DEMO_USERS) - 1
    assert result.user_ids[DEMO_USERS[2].handle] == existing.id
    db_session.refresh(existing)
    assert existing.name == "Someone Else"


def test_seed_refuses_a_slug_taken_by_someone_else(db_session: Session) -> None:
    create_workspace(db_session, slug=WORKSPACE_SLUG)

    with pytest.raises(SeedError, match="acme"):
        seed(db_session, get_settings(), today=TODAY)


def test_demo_users_can_log_in(db_session: Session, client: TestClient) -> None:
    seed(db_session, get_settings(), today=TODAY)

    for user in DEMO_USERS:
        response = client.post(
            "/api/auth/login", json={"email": user.email, "password": DEMO_PASSWORD}
        )
        assert response.status_code == 200, user.email
        assert response.json()["name"] == user.name

    workspaces = client.get("/api/workspaces").json()
    assert [w["slug"] for w in workspaces] == [WORKSPACE_SLUG]
