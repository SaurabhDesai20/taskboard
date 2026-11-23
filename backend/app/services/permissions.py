"""The role permission matrix (PLAN.md section 4, docs/api-contract.md section 1.10).

This module is the single source of truth for what each workspace role may do. It is pure:
no database, no HTTP, no imports from the rest of the app, so models, schemas, repositories
and services can all import `Role` from here.

`frontend/src/lib/permissions.ts` mirrors `PERMISSIONS` with the same action strings.
"""

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType
from typing import Final, Literal, get_args


class Role(StrEnum):
    """A user's role in one workspace. Declared from most to least powerful."""

    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"

    @property
    def rank(self) -> int:
        """Higher is more powerful: owner 3, admin 2, member 1, viewer 0."""
        return _RANKS[self]


_RANKS: Final[Mapping[Role, int]] = MappingProxyType(
    {Role.OWNER: 3, Role.ADMIN: 2, Role.MEMBER: 1, Role.VIEWER: 0}
)

Action = Literal[
    "workspace.view",
    "task.write",
    "comment.create",
    "comment.edit_own",
    "comment.delete_any",
    "task.delete",
    "project.manage",
    "member.manage",
    "member.promote",
    "workspace.manage",
]
"""Every action the matrix knows. The UI uses the same identifiers."""

ACTIONS: Final[tuple[Action, ...]] = get_args(Action)

_ALL = frozenset({Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER})
_WRITERS = frozenset({Role.OWNER, Role.ADMIN, Role.MEMBER})
_MANAGERS = frozenset({Role.OWNER, Role.ADMIN})
_OWNERS = frozenset({Role.OWNER})

PERMISSIONS: Final[Mapping[Action, frozenset[Role]]] = MappingProxyType(
    {
        # View workspace, projects, tasks, comments, activity.
        "workspace.view": _ALL,
        # Create/edit/move tasks, assign, set due date.
        "task.write": _WRITERS,
        # Comment.
        "comment.create": _WRITERS,
        # Edit/delete own comment.
        "comment.edit_own": _WRITERS,
        # Delete any comment.
        "comment.delete_any": _MANAGERS,
        # Delete any task.
        "task.delete": _MANAGERS,
        # Create/edit/archive projects.
        "project.manage": _MANAGERS,
        # Add/remove members and change roles, for member and viewer targets only.
        "member.manage": _MANAGERS,
        # Grant admin or owner (transfers ownership), and manage admins and owners.
        "member.promote": _OWNERS,
        # Rename/delete the workspace.
        "workspace.manage": _OWNERS,
    }
)
"""Action -> the roles allowed to perform it."""


def can(role: Role, action: Action) -> bool:
    """Whether `role` may perform `action`. Every role decision in the backend goes through here."""
    return role in PERMISSIONS[action]


def allowed_roles(action: Action) -> list[Role]:
    """The roles allowed to perform `action`, most powerful first (for error messages)."""
    return [role for role in Role if can(role, action)]
