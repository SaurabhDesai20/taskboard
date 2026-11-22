from collections.abc import Collection
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.workspace import Workspace, WorkspaceMember
from app.services.permissions import Role


def get_with_role(db: Session, workspace_id: UUID, user_id: UUID) -> tuple[Workspace, Role] | None:
    """The workspace and the user's role in it. None if it's missing or they aren't a member."""
    stmt = (
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(Workspace.id == workspace_id, WorkspaceMember.user_id == user_id)
    )
    row = db.execute(stmt).one_or_none()
    if row is None:
        return None
    workspace, role = row
    return workspace, role


def list_for_user(db: Session, user_id: UUID) -> list[tuple[Workspace, Role]]:
    """Workspaces the user belongs to with their role, ordered by name (case-insensitive)."""
    stmt = (
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(func.lower(Workspace.name), Workspace.name, Workspace.id)
    )
    return [(workspace, role) for workspace, role in db.execute(stmt)]


def existing_slugs(db: Session, slugs: Collection[str]) -> set[str]:
    """The subset of `slugs` already used by a workspace."""
    return set(db.scalars(select(Workspace.slug).where(Workspace.slug.in_(slugs))))


def create(db: Session, *, name: str, slug: str, created_by: UUID) -> Workspace:
    """Insert and flush, so the id and created_at are set. The caller commits.

    Raises IntegrityError (constraint `uq_workspaces_slug`) when the slug is taken.
    """
    workspace = Workspace(name=name, slug=slug, created_by=created_by)
    db.add(workspace)
    db.flush()
    return workspace


def delete(db: Session, workspace: Workspace) -> None:
    """Delete the workspace; the database cascades to everything in it. The caller commits."""
    db.delete(workspace)
    db.flush()
