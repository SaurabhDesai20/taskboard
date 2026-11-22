"""Who may touch a workspace-scoped resource (docs/api-contract.md section 1.10).

Every workspace-scoped request starts here, in this order:

1. Resolve the resource to its workspace.
2. Workspace missing, or the caller is not a member: 404 `not_found`. Never 403, so the API
   does not reveal that the resource exists.
3. The caller's role does not allow the action: 403 `forbidden`, `reason: insufficient_role`.
   The decision is `permissions.can(role, action)`.

`api/deps.py::require_role(action)` runs steps 2 and 3 for `/workspaces/{wid}/...` routes.
Phase 3+ resolves a project (or task -> project) to its workspace id first and then calls
`workspace_access(...)` with `not_found_message="Project not found"` (or "Task not found"),
so the 404/403 behaviour is identical everywhere.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound
from app.models.workspace import Workspace
from app.repositories import workspaces as workspaces_repo
from app.services.permissions import Action, Role, allowed_roles, can

WORKSPACE_NOT_FOUND_MESSAGE = "Workspace not found"

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


def authorize(role: Role, action: Action) -> None:
    """Raise 403 `insufficient_role` unless `role` may perform `action`."""
    if not can(role, action):
        raise Forbidden(denied_message(action), {"reason": "insufficient_role"})


def denied_message(action: Action) -> str:
    """E.g. "Only owners and admins can add, remove or change members"."""
    roles = [f"{role.value}s" for role in allowed_roles(action)]
    who = roles[0] if len(roles) == 1 else ", ".join(roles[:-1]) + " and " + roles[-1]
    return f"Only {who} can {_ACTION_DESCRIPTIONS[action]}"
