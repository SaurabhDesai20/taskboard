"""Test data builders. They write through the ORM and flush; the per-test transaction rolls back."""

import itertools
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE, create_access_token, hash_password
from app.models.project import Project
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
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
