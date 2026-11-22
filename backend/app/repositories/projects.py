from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.project import Project


def get(db: Session, project_id: UUID) -> Project | None:
    """The project, in any workspace. Callers resolve its workspace and check membership next."""
    return db.get(Project, project_id)


def list_for_workspace(
    db: Session, workspace_id: UUID, *, include_archived: bool = False
) -> list[Project]:
    """The workspace's projects, ordered by name (case-insensitive), then key."""
    stmt = select(Project).where(Project.workspace_id == workspace_id)
    if not include_archived:
        stmt = stmt.where(Project.archived_at.is_(None))
    stmt = stmt.order_by(func.lower(Project.name), Project.name, Project.key)
    return list(db.scalars(stmt))


def create(
    db: Session,
    *,
    workspace_id: UUID,
    name: str,
    key: str,
    description: str | None,
    created_by: UUID,
) -> Project:
    """Insert and flush, so the id and created_at are set. The caller commits.

    Raises IntegrityError (constraint `uq_projects_workspace_id_key`) when the key is taken.
    """
    project = Project(
        workspace_id=workspace_id,
        name=name,
        key=key,
        description=description,
        created_by=created_by,
    )
    db.add(project)
    db.flush()
    return project


def archive(db: Session, project: Project) -> bool:
    """Set `archived_at` to the database's now(), unless the project is already archived.

    One conditional UPDATE, so of two concurrent archives exactly one succeeds. Returns False
    (and changes nothing) when the project was already archived. The caller commits.
    """
    stmt = (
        update(Project)
        .where(Project.id == project.id, Project.archived_at.is_(None))
        .values(archived_at=func.now())
        .returning(Project.archived_at)
        .execution_options(synchronize_session=False)
    )
    archived_at = db.scalar(stmt)
    # Reload the row either way, so `project` shows what the database now holds.
    db.refresh(project)
    return archived_at is not None
