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


def lock_for_task_write(db: Session, project: Project) -> None:
    """Lock the project's row until the transaction ends, and reload `project` from it.

    Every task write that is not allowed on an archived project (create, update, move) takes
    this lock first, so task writes in one project serialize:
    - concurrent creates read and bump `next_task_number` one after the other, so they never
      get the same number;
    - positions and column rebalances are computed from columns nobody else is changing;
    - `archived_at` is current: a write waits for a concurrent archive and then sees it.

    `FOR NO KEY UPDATE` still lets other transactions insert rows that reference the project.
    """
    stmt = (
        select(Project)
        .where(Project.id == project.id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    db.execute(stmt).scalar_one()


def take_task_number(db: Session, project: Project) -> int:
    """The project's next task number, reserved for the caller. Needs `lock_for_task_write`.

    The counter only grows, so a number is never reused, even after its task is deleted.
    """
    number = project.next_task_number
    project.next_task_number = number + 1
    db.flush()
    return number


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
