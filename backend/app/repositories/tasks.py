from datetime import date
from uuid import UUID

from sqlalchemy import ColumnElement, and_, case, delete, func, or_, select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskPriority, TaskStatus
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.task import UNASSIGNED, TaskFilters

# todo, in_progress, in_review, done.
_STATUS_ORDER = case({status: rank for rank, status in enumerate(TaskStatus)}, value=Task.status)
# Within a column: position, then number so that equal positions still sort the same way.
_COLUMN_ORDER = (Task.position, Task.number)

_LIKE_ESCAPE = "\\"


def get_with_project(db: Session, task_id: UUID) -> tuple[Task, Project] | None:
    """The task and its project, in any workspace. Callers check membership next."""
    stmt = select(Task, Project).join(Project, Project.id == Task.project_id)
    row = db.execute(stmt.where(Task.id == task_id)).one_or_none()
    if row is None:
        return None
    task, project = row
    return task, project


def reload(db: Session, task: Task) -> bool:
    """Re-read the task's row into `task`. False if it has been deleted meanwhile."""
    stmt = select(Task).where(Task.id == task.id).execution_options(populate_existing=True)
    return db.scalars(stmt).one_or_none() is not None


def list_for_project(
    db: Session, project: Project, filters: TaskFilters
) -> list[tuple[Task, User | None]]:
    """The project's matching tasks with their assignees, in board order: by status
    (todo, in_progress, in_review, done), then position."""
    stmt = (
        select(Task, User)
        .outerjoin(User, User.id == Task.assignee_id)
        .where(Task.workspace_id == project.workspace_id, Task.project_id == project.id)
        .where(*_conditions(filters))
        .order_by(_STATUS_ORDER, *_COLUMN_ORDER)
    )
    return [(task, assignee) for task, assignee in db.execute(stmt)]


def list_assigned_to(
    db: Session, user_id: UUID, filters: TaskFilters
) -> list[tuple[Task, Project, Workspace]]:
    """Tasks assigned to the user in workspaces they are a member of, outside archived
    projects, by due date (none last), then creation time."""
    stmt = (
        select(Task, Project, Workspace)
        .join(Project, Project.id == Task.project_id)
        .join(Workspace, Workspace.id == Task.workspace_id)
        # Scope by membership: a task the user is still assigned to in a workspace they have
        # left must not leak.
        .join(
            WorkspaceMember,
            and_(
                WorkspaceMember.workspace_id == Task.workspace_id,
                WorkspaceMember.user_id == user_id,
            ),
        )
        .where(Task.assignee_id == user_id, Project.archived_at.is_(None), *_conditions(filters))
        .order_by(Task.due_date.asc().nulls_last(), Task.created_at, Task.id)
    )
    return [(task, project, workspace) for task, project, workspace in db.execute(stmt)]


def list_column(
    db: Session, project: Project, status: TaskStatus, *, exclude: UUID | None = None
) -> list[Task]:
    """One column of the board, in order, freshly read. `exclude` leaves out one task."""
    stmt = (
        select(Task)
        .where(
            Task.workspace_id == project.workspace_id,
            Task.project_id == project.id,
            Task.status == status,
        )
        .order_by(*_COLUMN_ORDER)
        .execution_options(populate_existing=True)
    )
    if exclude is not None:
        stmt = stmt.where(Task.id != exclude)
    return list(db.scalars(stmt))


def last_position(
    db: Session, project: Project, status: TaskStatus, *, exclude: UUID | None = None
) -> float | None:
    """The highest position in the column, or None if it is empty."""
    stmt = select(func.max(Task.position)).where(
        Task.workspace_id == project.workspace_id,
        Task.project_id == project.id,
        Task.status == status,
    )
    if exclude is not None:
        stmt = stmt.where(Task.id != exclude)
    return db.scalar(stmt)


def create(
    db: Session,
    *,
    project: Project,
    number: int,
    title: str,
    description: str | None,
    status: TaskStatus,
    priority: TaskPriority,
    position: float,
    assignee_id: UUID | None,
    due_date: date | None,
    created_by: UUID,
) -> Task:
    """Insert and flush, so the id and timestamps are set. The caller commits."""
    task = Task(
        project_id=project.id,
        workspace_id=project.workspace_id,
        number=number,
        title=title,
        description=description,
        status=status,
        priority=priority,
        position=position,
        assignee_id=assignee_id,
        due_date=due_date,
        created_by=created_by,
    )
    db.add(task)
    db.flush()
    return task


def delete_task(db: Session, task: Task) -> bool:
    """Delete the task. False if it was already gone (a concurrent delete). The caller commits."""
    stmt = delete(Task).where(Task.workspace_id == task.workspace_id, Task.id == task.id)
    deleted_id = db.scalar(stmt.returning(Task.id))
    return deleted_id is not None


def _conditions(filters: TaskFilters) -> list[ColumnElement[bool]]:
    """WHERE conditions for the filters that are set."""
    conditions: list[ColumnElement[bool]] = []
    if filters.statuses:
        conditions.append(Task.status.in_(filters.statuses))
    if filters.priorities:
        conditions.append(Task.priority.in_(filters.priorities))
    if filters.assignee == UNASSIGNED:
        conditions.append(Task.assignee_id.is_(None))
    elif filters.assignee is not None:
        conditions.append(Task.assignee_id == filters.assignee)
    if filters.due_before is not None:
        conditions.append(Task.due_date <= filters.due_before)
    if filters.q is not None:
        pattern = f"%{_escape_like(filters.q)}%"
        conditions.append(
            or_(
                Task.title.ilike(pattern, escape=_LIKE_ESCAPE),
                Task.description.ilike(pattern, escape=_LIKE_ESCAPE),
            )
        )
    return conditions


def _escape_like(text: str) -> str:
    """Make `%`, `_` and the escape character itself match literally."""
    for char in (_LIKE_ESCAPE, "%", "_"):
        text = text.replace(char, _LIKE_ESCAPE + char)
    return text
