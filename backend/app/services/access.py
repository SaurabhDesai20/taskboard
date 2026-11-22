"""Who may touch a workspace-scoped resource (docs/api-contract.md section 1.10).

Every workspace-scoped request starts here, in this order:

1. Resolve the resource to its workspace.
2. Workspace missing, or the caller is not a member: 404 `not_found`. Never 403, so the API
   does not reveal that the resource exists.
3. The caller's role does not allow the action: 403 `forbidden`, `reason: insufficient_role`.
   The decision is `permissions.can(role, action)`.

`api/deps.py::require_role(action)` runs steps 2 and 3 for `/workspaces/{wid}/...` routes.
`api/deps.py::require_project_role(action)` runs `project_access(...)` for `/projects/{pid}/...`
routes: it resolves the project to its workspace id first and then calls `workspace_access(...)`
with `not_found_message="Project not found"`, so the 404/403 behaviour is identical everywhere.
`api/deps.py::require_task_role(action)` runs `task_access(...)` for `/tasks/{tid}/...` routes:
task -> project -> workspace, with "Task not found".
`api/deps.py::require_comment_role(action)` runs `comment_access(...)` for `/comments/{cid}`
routes: comment -> task -> project -> workspace, with "Comment not found".
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound
from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import Workspace
from app.repositories import comments as comments_repo
from app.repositories import projects as projects_repo
from app.repositories import tasks as tasks_repo
from app.repositories import workspaces as workspaces_repo
from app.services.permissions import Action, Role, allowed_roles, can

WORKSPACE_NOT_FOUND_MESSAGE = "Workspace not found"
PROJECT_NOT_FOUND_MESSAGE = "Project not found"
TASK_NOT_FOUND_MESSAGE = "Task not found"
COMMENT_NOT_FOUND_MESSAGE = "Comment not found"

# Completes "Only <roles> can ..." in 403 messages.
_ACTION_DESCRIPTIONS: Final[Mapping[Action, str]] = MappingProxyType(
    {
        "workspace.view": "view this workspace",
        "task.write": "create or edit tasks",
        "comment.create": "comment",
        "comment.edit_own": "edit or delete their comments",
        "comment.delete_any": "delete other people's comments",
        "task.delete": "delete tasks",
        "project.manage": "create, edit or archive projects",
        "member.manage": "add, remove or change members",
        "member.promote": "manage admins and owners",
        "workspace.manage": "rename or delete the workspace",
    }
)


@dataclass(frozen=True)
class WorkspaceAccess:
    """Proof that `user_id` is a member of `workspace`, with their role."""

    workspace: Workspace
    user_id: UUID
    role: Role


def workspace_access(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    action: Action,
    *,
    not_found_message: str = WORKSPACE_NOT_FOUND_MESSAGE,
) -> WorkspaceAccess:
    """The caller's membership of the workspace, if their role allows `action`.

    Raises NotFound (missing workspace or not a member) or Forbidden (`insufficient_role`).
    """
    row = workspaces_repo.get_with_role(db, workspace_id, user_id)
    if row is None:
        raise NotFound(not_found_message)
    workspace, role = row
    authorize(role, action)
    return WorkspaceAccess(workspace=workspace, user_id=user_id, role=role)


@dataclass(frozen=True)
class ProjectAccess:
    """Proof that `user_id` is a member of the project's workspace, with their role there."""

    project: Project
    user_id: UUID
    role: Role


def project_access(db: Session, project_id: UUID, user_id: UUID, action: Action) -> ProjectAccess:
    """The caller's access to a project, if their role in its workspace allows `action`.

    Raises NotFound "Project not found" (missing project, or not a member of its workspace) or
    Forbidden (`insufficient_role`). A project of another workspace is indistinguishable from
    a missing one.
    """
    project = projects_repo.get(db, project_id)
    if project is None:
        raise NotFound(PROJECT_NOT_FOUND_MESSAGE)
    access = workspace_access(
        db, project.workspace_id, user_id, action, not_found_message=PROJECT_NOT_FOUND_MESSAGE
    )
    return ProjectAccess(project=project, user_id=user_id, role=access.role)


@dataclass(frozen=True)
class TaskAccess:
    """Proof that `user_id` is a member of the task's workspace, with their role there."""

    task: Task
    project: Project
    user_id: UUID
    role: Role


def task_access(db: Session, task_id: UUID, user_id: UUID, action: Action) -> TaskAccess:
    """The caller's access to a task, if their role in its workspace allows `action`.

    Raises NotFound "Task not found" (missing task, or not a member of its workspace) or
    Forbidden (`insufficient_role`). A task of another workspace is indistinguishable from a
    missing one.
    """
    row = tasks_repo.get_with_project(db, task_id)
    if row is None:
        raise NotFound(TASK_NOT_FOUND_MESSAGE)
    task, project = row
    access = workspace_access(
        db, project.workspace_id, user_id, action, not_found_message=TASK_NOT_FOUND_MESSAGE
    )
    return TaskAccess(task=task, project=project, user_id=user_id, role=access.role)


@dataclass(frozen=True)
class CommentAccess:
    """Proof that `user_id` is a member of the comment's workspace, with their role there.

    The role check covers the action's minimum role only. Whether the caller is the comment's
    author is a business rule the comments service checks next.
    """

    comment: Comment
    task: Task
    project: Project
    user_id: UUID
    role: Role


def comment_access(db: Session, comment_id: UUID, user_id: UUID, action: Action) -> CommentAccess:
    """The caller's access to a comment, if their role in its workspace allows `action`.

    Raises NotFound "Comment not found" (missing comment, or not a member of its workspace) or
    Forbidden (`insufficient_role`). A comment of another workspace is indistinguishable from
    a missing one.
    """
    row = comments_repo.get_with_task_and_project(db, comment_id)
    if row is None:
        raise NotFound(COMMENT_NOT_FOUND_MESSAGE)
    comment, task, project = row
    access = workspace_access(
        db, project.workspace_id, user_id, action, not_found_message=COMMENT_NOT_FOUND_MESSAGE
    )
    return CommentAccess(
        comment=comment, task=task, project=project, user_id=user_id, role=access.role
    )


def authorize(role: Role, action: Action) -> None:
    """Raise 403 `insufficient_role` unless `role` may perform `action`."""
    if not can(role, action):
        raise Forbidden(denied_message(action), {"reason": "insufficient_role"})


def denied_message(action: Action) -> str:
    """E.g. "Only owners and admins can add, remove or change members"."""
    roles = [f"{role.value}s" for role in allowed_roles(action)]
    who = roles[0] if len(roles) == 1 else ", ".join(roles[:-1]) + " and " + roles[-1]
    return f"Only {who} can {_ACTION_DESCRIPTIONS[action]}"
