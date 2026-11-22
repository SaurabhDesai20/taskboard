"""Workspace members and their roles (docs/api-contract.md sections 1.10 and 3.4).

Membership rules, checked after the route's `require_role(...)` gate:
- Users cannot change their own role (403 `own_role`).
- Admins and owners are "privileged" (they can manage members). Acting on a privileged member,
  or granting a privileged role, needs `member.promote`: owners only (403 `protected_member`).
- Any member may leave; nobody may remove or demote the last owner (409 `last_owner`).
"""

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.db.errors import is_unique_violation
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.repositories import members as members_repo
from app.repositories import users as users_repo
from app.schemas.member import MemberCreate, MemberRead, MemberUpdate
from app.services.access import WorkspaceAccess, authorize
from app.services.permissions import Role, can

MEMBER_PK_CONSTRAINT = "pk_workspace_members"

MEMBER_NOT_FOUND_MESSAGE = "Member not found"
NO_SUCH_USER_MESSAGE = "No user with this email"
ALREADY_MEMBER_MESSAGE = "This user is already a member of the workspace"
OWN_ROLE_MESSAGE = "You cannot change your own role"
PROTECTED_TARGET_MESSAGE = "Only owners can change or remove owners and admins"
PROTECTED_GRANT_MESSAGE = "Only owners can grant the admin or owner role"
LAST_OWNER_MESSAGE = "A workspace must always have at least one owner"
LAST_OWNER_LEAVING_MESSAGE = (
    "You are the only owner. Make another member an owner before leaving the workspace"
)


def list_members(db: Session, access: WorkspaceAccess) -> list[MemberRead]:
    """Ordered by role (owner, admin, member, viewer), then name."""
    rows = members_repo.list_for_workspace(db, access.workspace.id)
    return [_read(member, user) for member, user in rows]


def add(db: Session, access: WorkspaceAccess, data: MemberCreate) -> MemberRead:
    """Add an existing user by email. Route gate: `member.manage`."""
    _check_can_grant(access.role, data.role)
    user = users_repo.get_by_email(db, data.email)
    if user is None:
        raise ValidationFailed.for_field("email", NO_SUCH_USER_MESSAGE)
    if members_repo.get(db, access.workspace.id, user.id) is not None:
        raise _already_member()
    try:
        with db.begin_nested():
            member = members_repo.add(
                db, workspace_id=access.workspace.id, user_id=user.id, role=data.role
            )
    except IntegrityError as exc:
        # A concurrent request added the same user first.
        if is_unique_violation(exc, MEMBER_PK_CONSTRAINT):
            raise _already_member() from exc
        raise
    db.commit()
    return _read(member, user)


def change_role(
    db: Session, access: WorkspaceAccess, user_id: UUID, data: MemberUpdate
) -> MemberRead:
    """Change another member's role. Route gate: `member.manage`."""
    if user_id == access.user_id:
        raise Forbidden(OWN_ROLE_MESSAGE, {"reason": "own_role"})
    member, user = _get_member(db, access, user_id)
    _check_can_act_on(access.role, member.role)
    if data.role is None or data.role == member.role:
        return _read(member, user)
    _check_can_grant(access.role, data.role)
    _ensure_another_owner_remains(db, access, user_id)
    member.role = data.role
    db.commit()
    return _read(member, user)


def remove(db: Session, access: WorkspaceAccess, user_id: UUID) -> None:
    """Remove a member, or leave when `user_id` is the caller. Route gate: `workspace.view`."""
    leaving = user_id == access.user_id
    if not leaving:
        authorize(access.role, "member.manage")
    member, _user = _get_member(db, access, user_id)
    if not leaving:
        _check_can_act_on(access.role, member.role)
    _ensure_another_owner_remains(db, access, user_id)
    members_repo.delete(db, member)
    db.commit()


def _get_member(
    db: Session, access: WorkspaceAccess, user_id: UUID
) -> tuple[WorkspaceMember, User]:
    found = members_repo.get(db, access.workspace.id, user_id)
    if found is None:
        raise NotFound(MEMBER_NOT_FOUND_MESSAGE)
    return found


def _is_privileged(role: Role) -> bool:
    """Admins and owners: the roles that can themselves manage members."""
    return can(role, "member.manage")


def _check_can_act_on(actor: Role, target: Role) -> None:
    if _is_privileged(target) and not can(actor, "member.promote"):
        raise Forbidden(PROTECTED_TARGET_MESSAGE, {"reason": "protected_member"})


def _check_can_grant(actor: Role, role: Role) -> None:
    if _is_privileged(role) and not can(actor, "member.promote"):
        raise Forbidden(PROTECTED_GRANT_MESSAGE, {"reason": "protected_member"})


def _ensure_another_owner_remains(db: Session, access: WorkspaceAccess, user_id: UUID) -> None:
    """409 `last_owner` unless an owner other than `user_id` remains.

    Called before `user_id` loses their role or membership. If they are not an owner, the
    other owners remain and this passes. The owner rows stay locked until commit, so two
    owners demoting or removing each other at the same time cannot both succeed.
    """
    owner_ids = members_repo.lock_owner_ids(db, access.workspace.id)
    if any(owner_id != user_id for owner_id in owner_ids):
        return
    leaving = user_id == access.user_id
    message = LAST_OWNER_LEAVING_MESSAGE if leaving else LAST_OWNER_MESSAGE
    raise Conflict(message, {"reason": "last_owner"})


def _already_member() -> Conflict:
    return Conflict(ALREADY_MEMBER_MESSAGE, {"reason": "already_member"})


def _read(member: WorkspaceMember, user: User) -> MemberRead:
    return MemberRead(
        user_id=member.user_id,
        email=user.email,
        name=user.name,
        role=member.role,
        joined_at=member.joined_at,
    )
