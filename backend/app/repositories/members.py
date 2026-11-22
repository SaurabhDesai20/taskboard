from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.services.permissions import Role

# owner, admin, member, viewer.
_ROLE_ORDER = case({role: role.rank for role in Role}, value=WorkspaceMember.role).desc()


def get(db: Session, workspace_id: UUID, user_id: UUID) -> tuple[WorkspaceMember, User] | None:
    stmt = (
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
    )
    row = db.execute(stmt).one_or_none()
    if row is None:
        return None
    member, user = row
    return member, user


def list_for_workspace(db: Session, workspace_id: UUID) -> list[tuple[WorkspaceMember, User]]:
    """Members with their users, ordered by role (owner first), then name (case-insensitive)."""
    stmt = (
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(_ROLE_ORDER, func.lower(User.name), User.name, User.id)
    )
    return [(member, user) for member, user in db.execute(stmt)]


def lock_owner_ids(db: Session, workspace_id: UUID) -> list[UUID]:
    """The workspace's owners, with their rows locked until the transaction ends.

    Concurrent requests that would remove or demote owners serialize here, so the
    "at least one owner" rule holds under concurrency.
    """
    stmt = (
        select(WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == Role.OWNER)
        .with_for_update()
    )
    return list(db.scalars(stmt))


def add(db: Session, *, workspace_id: UUID, user_id: UUID, role: Role) -> WorkspaceMember:
    """Insert and flush, so joined_at is set. The caller commits.

    Raises IntegrityError (constraint `pk_workspace_members`) when the user is already a member.
    """
    member = WorkspaceMember(workspace_id=workspace_id, user_id=user_id, role=role)
    db.add(member)
    db.flush()
    return member


def delete(db: Session, member: WorkspaceMember) -> None:
    db.delete(member)
    db.flush()
