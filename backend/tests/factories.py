"""Test data builders. They write through the ORM and flush; the per-test transaction rolls back."""

import itertools
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE, create_access_token, hash_password
from app.models.activity import ActivityAction, ActivityLog
from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task, TaskPriority, TaskStatus
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.repositories import projects as projects_repo
from app.repositories import tasks as tasks_repo
from app.services.permissions import Role

DEFAULT_PASSWORD = "correct-horse-battery"

_sequence = itertools.count(1)


def create_user(
    db: Session,
    *,
    email: str | None = None,
    name: str | None = None,
    password: str = DEFAULT_PASSWORD,
) -> User:
    n = next(_sequence)
    user = User(
        email=email or f"user{n}@example.com",
        name=name or f"User {n}",
        password_hash=hash_password(password),
    )
    db.add(user)
    db.flush()
    return user


def access_token_for(
    user_id: UUID,
    *,
    now: datetime | None = None,
    expires_minutes: int | None = None,
    secret: str | None = None,
) -> str:
    settings = get_settings()
    return create_access_token(
        user_id,
        secret=secret or settings.jwt_secret.get_secret_value(),
        expires_minutes=expires_minutes or settings.jwt_expire_minutes,
        now=now,
    )


def log_in(client: TestClient, user: User) -> None:
    """Give the client a valid session cookie for `user`, without calling /auth/login."""
    client.cookies.set(ACCESS_TOKEN_COOKIE, access_token_for(user.id))


def create_workspace(
    db: Session,
    *,
    owner: User | None = None,
    name: str | None = None,
    slug: str | None = None,
) -> Workspace:
    """A workspace whose creator (`owner`, or a new user) is its owner."""
    n = next(_sequence)
    owner = owner or create_user(db)
    workspace = Workspace(
        name=name or f"Workspace {n}", slug=slug or f"workspace-{n}", created_by=owner.id
    )
    db.add(workspace)
    db.flush()
    add_member(db, workspace, owner, Role.OWNER)
    return workspace


def add_member(db: Session, workspace: Workspace, user: User, role: Role) -> WorkspaceMember:
    member = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=role)
    db.add(member)
    db.flush()
    return member


def create_project(
    db: Session,
    workspace: Workspace,
    *,
    name: str | None = None,
    key: str | None = None,
    description: str | None = None,
    created_by: User | None = None,
    archived_at: datetime | None = None,
) -> Project:
    """A project in `workspace`, created by `created_by` (default: the workspace's creator)."""
    n = next(_sequence)
    project = Project(
        workspace_id=workspace.id,
        name=name or f"Project {n}",
        key=key or f"P{n}",
        description=description,
        created_by=created_by.id if created_by else workspace.created_by,
        archived_at=archived_at,
    )
    db.add(project)
    db.flush()
    return project


def create_task(
    db: Session,
    project: Project,
    *,
    title: str | None = None,
    description: str | None = None,
    status: TaskStatus = TaskStatus.TODO,
    priority: TaskPriority = TaskPriority.MEDIUM,
    position: float | None = None,
    assignee: User | None = None,
    due_date: date | None = None,
    created_by: User | None = None,
    created_at: datetime | None = None,
) -> Task:
    """A task in `project`, numbered from the project's sequence like the API does.

    `position` defaults to the end of its column (last + 1024). `created_at` overrides the
    database clock, which is frozen for the whole test transaction.
    """
    number = projects_repo.take_task_number(db, project)
    if position is None:
        last = tasks_repo.last_position(db, project, status)
        position = 1024.0 if last is None else last + 1024.0
    task = Task(
        project_id=project.id,
        workspace_id=project.workspace_id,
        number=number,
        title=title or f"Task {number}",
        description=description,
        status=status,
        priority=priority,
        position=position,
        assignee_id=assignee.id if assignee else None,
        due_date=due_date,
        created_by=created_by.id if created_by else project.created_by,
    )
    if created_at is not None:
        task.created_at = created_at
    db.add(task)
    db.flush()
    return task


def create_comment(
    db: Session,
    task: Task,
    author: User,
    *,
    body: str | None = None,
    created_at: datetime | None = None,
    edited_at: datetime | None = None,
) -> Comment:
    """A comment by `author` on `task`. `created_at` overrides the database clock, which is
    frozen for the whole test transaction (so comments made in one test share a timestamp)."""
    comment = Comment(
        task_id=task.id,
        workspace_id=task.workspace_id,
        author_id=author.id,
        body=body or f"Comment {next(_sequence)}",
        edited_at=edited_at,
    )
    if created_at is not None:
        comment.created_at = created_at
    db.add(comment)
    db.flush()
    return comment


def create_activity(
    db: Session,
    workspace: Workspace,
    actor: User,
    *,
    project: Project | None = None,
    task: Task | None = None,
    metadata: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> ActivityLog:
    """An activity entry in `workspace` by `actor`, written directly (the services write theirs
    through app.services.activity): `task.updated` when a task is given (with its project),
    else `project.updated` for a project, else `workspace.renamed`. `created_at` overrides the
    database clock."""
    if task is not None:
        action, entity_id = ActivityAction.TASK_UPDATED, task.id
    elif project is not None:
        action, entity_id = ActivityAction.PROJECT_UPDATED, project.id
    else:
        action, entity_id = ActivityAction.WORKSPACE_RENAMED, workspace.id
    entry = ActivityLog(
        workspace_id=workspace.id,
        project_id=project.id if project else None,
        task_id=task.id if task else None,
        actor_id=actor.id,
        action=action,
        entity_type=action.entity_type,
        entity_id=entity_id,
        metadata_=metadata if metadata is not None else {"n": next(_sequence)},
    )
    if created_at is not None:
        entry.created_at = created_at
    db.add(entry)
    db.flush()
    return entry


@dataclass(frozen=True)
class Team:
    """A workspace with one user per role, another plain member and a non-member."""

    workspace: Workspace
    users: dict[Role, User]
    # A second `member`, for acting on someone other than the caller.
    other_member: User
    outsider: User

    @property
    def owner(self) -> User:
        return self.users[Role.OWNER]


def create_team(db: Session) -> Team:
    owner = create_user(db, name="Olivia Owner")
    workspace = create_workspace(db, owner=owner)
    users = {Role.OWNER: owner}
    for role in (Role.ADMIN, Role.MEMBER, Role.VIEWER):
        users[role] = create_user(db, name=f"{role.value.title()} User")
        add_member(db, workspace, users[role], role)
    other_member = create_user(db, name="Other Member")
    add_member(db, workspace, other_member, Role.MEMBER)
    outsider = create_user(db, name="Outsider")
    # The outsider belongs to another workspace, to prove membership is per workspace.
    create_workspace(db, owner=outsider)
    return Team(workspace=workspace, users=users, other_member=other_member, outsider=outsider)
