"""Shared FastAPI dependencies: the database session, the current user and require_role."""

from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Path
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import ACCESS_TOKEN_COOKIE
from app.db.session import get_db
from app.models.user import User
from app.services import access as access_service
from app.services import auth as auth_service
from app.services.access import ProjectAccess, TaskAccess, WorkspaceAccess
from app.services.permissions import Action

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]

# Reads the cookie and documents it as the OpenAPI security scheme. auto_error=False so that
# a missing cookie reaches the auth service and gets the contract's 401 envelope.
access_token_cookie = APIKeyCookie(
    name=ACCESS_TOKEN_COOKIE,
    scheme_name="CookieAuth",
    description="httpOnly session cookie set by POST /api/auth/register and /api/auth/login",
    auto_error=False,
)


def get_current_user(
    db: DbSession,
    settings: AppSettings,
    access_token: Annotated[str | None, Depends(access_token_cookie)],
) -> User:
    """The logged-in user. 401 `unauthorized` for a missing, invalid or expired cookie."""
    return auth_service.authenticate(db, access_token, settings)


CurrentUser = Annotated[User, Depends(get_current_user)]

WorkspaceId = Annotated[UUID, Path(description="Workspace id")]
ProjectId = Annotated[UUID, Path(description="Project id")]
TaskId = Annotated[UUID, Path(description="Task id")]


def require_role(action: Action) -> Callable[[UUID, Session, User], WorkspaceAccess]:
    """Dependency for `/workspaces/{wid}/...` routes: the caller's membership of `wid`.

    The route names the action it performs and the permission matrix supplies the minimum
    role (e.g. `"member.manage"` -> admin), so this check goes through `permissions.can()`
    like every other role decision. In the order of docs/api-contract.md section 1.10:
    - no cookie -> 401 `unauthorized`
    - workspace missing or caller not a member -> 404 `not_found`
    - role below the action's minimum -> 403 `forbidden`, `details.reason = "insufficient_role"`
    These all run before the request body is validated.
    """

    def resolve_workspace_access(
        wid: WorkspaceId, db: DbSession, user: CurrentUser
    ) -> WorkspaceAccess:
        return access_service.workspace_access(db, wid, user.id, action)

    return resolve_workspace_access


def require_project_role(action: Action) -> Callable[[UUID, Session, User], ProjectAccess]:
    """Dependency for `/projects/{pid}/...` routes: the caller's access to project `pid`.

    `require_role` for a project: the service resolves the project to its workspace, then
    applies the same membership and `permissions.can()` checks, before body validation:
    - no cookie -> 401 `unauthorized`
    - project missing, or caller not a member of its workspace -> 404 "Project not found"
    - role below the action's minimum -> 403 `forbidden`, `details.reason = "insufficient_role"`
    """

    def resolve_project_access(pid: ProjectId, db: DbSession, user: CurrentUser) -> ProjectAccess:
        return access_service.project_access(db, pid, user.id, action)

    return resolve_project_access


def require_task_role(action: Action) -> Callable[[UUID, Session, User], TaskAccess]:
    """Dependency for `/tasks/{tid}/...` routes: the caller's access to task `tid`.

    `require_role` for a task: the service resolves task -> project -> workspace, then applies
    the same membership and `permissions.can()` checks, before body validation:
    - no cookie -> 401 `unauthorized`
    - task missing, or caller not a member of its workspace -> 404 "Task not found"
    - role below the action's minimum -> 403 `forbidden`, `details.reason = "insufficient_role"`
    """

    def resolve_task_access(tid: TaskId, db: DbSession, user: CurrentUser) -> TaskAccess:
        return access_service.task_access(db, tid, user.id, action)

    return resolve_task_access


__all__ = [
    "AppSettings",
    "CurrentUser",
    "DbSession",
    "ProjectAccess",
    "TaskAccess",
    "WorkspaceAccess",
    "get_current_user",
    "get_db",
    "require_project_role",
    "require_role",
    "require_task_role",
]
