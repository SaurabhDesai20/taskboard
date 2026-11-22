"""Tasks and the Kanban board (docs/api-contract.md section 3.6).

Functions that take a ProjectAccess expect the route's `require_project_role(...)` gate to have
run; functions that take a TaskAccess expect `require_task_role(...)`. Those gates resolve the
task or project to its workspace and apply the 404/403 rules, so a task of a workspace the
caller does not belong to never reaches this module.

Ordering (PLAN.md section 4): `position` orders the tasks of one status column, ascending.
- A new task, or a task whose status changes through PATCH, goes to the end of its column:
  last position + 1024, or 1024 in an empty column.
- A move places the task between its new neighbours: (prev + next) / 2, or 1024 beyond the
  only neighbour at either end of the column.
- When the gap between the neighbours is too small for a midpoint, the whole column is
  rebalanced to 1024, 2048, ... in its current order, in the same transaction.

Concurrency: create, update and move first lock the project's row
(`projects_repo.lock_for_task_write`), so task writes in one project run one after the other.
That keeps task numbers unique, positions computed from a column nobody else is changing, and
the archived check current.

Activity (section 3.8), recorded in the same transaction after every check has passed:
- create: `task.created`; delete: `task.deleted`;
- update: one entry per kind of change, in this order: `task.updated` (title, description,
  priority), `task.assigned`, `task.due_date_changed`, `task.moved` (status). A no-op records
  nothing;
- move: `task.moved`, unless the task stays at the same place of the same column.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Self
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models.activity import ActivityAction
from app.models.project import Project
from app.models.task import Task, TaskPriority, TaskStatus
from app.models.user import User
from app.repositories import comments as comments_repo
from app.repositories import members as members_repo
from app.repositories import projects as projects_repo
from app.repositories import tasks as tasks_repo
from app.repositories import users as users_repo
from app.schemas.task import (
    MyTaskRead,
    ProjectRef,
    TaskCreate,
    TaskFilters,
    TaskMoveRequest,
    TaskRead,
    TaskUpdate,
    WorkspaceRef,
)
from app.schemas.user import UserRef
from app.services import activity
from app.services.access import TASK_NOT_FOUND_MESSAGE, ProjectAccess, TaskAccess

POSITION_STEP = 1024.0
# Neighbours closer than this get a rebalance instead of a midpoint. Doubles carry about 15
# significant digits, so midpoints stay exact far below the 1024 step and far above this gap.
MIN_POSITION_GAP = 1e-6

PROJECT_ARCHIVED_MESSAGE = "This project is archived, so its tasks are read-only"
ASSIGNEE_NOT_MEMBER_MESSAGE = "Assignee must be a member of this workspace"
INVALID_NEIGHBOUR_MESSAGE = "Must be another task of this project with the target status"
NEIGHBOURS_OUT_OF_ORDER_MESSAGE = "Must come after after_task_id in the target column"


def list_tasks(db: Session, access: ProjectAccess, filters: TaskFilters) -> list[TaskRead]:
    """The project's matching tasks in board order. Gate: `workspace.view`."""
    rows = tasks_repo.list_for_project(db, access.project, filters)
    return [_read(task, access.project, assignee, count) for task, assignee, count in rows]


def create(db: Session, access: ProjectAccess, data: TaskCreate) -> TaskRead:
    """Create a task at the end of its column. Gate: `task.write`.

    409 `project_archived`, then 422 on `assignee_id` when the assignee is not a member.
    """
    project = access.project
    _lock_active_project(db, project)
    assignee = _member(db, project, data.assignee_id) if data.assignee_id is not None else None
    task = tasks_repo.create(
        db,
        project=project,
        number=projects_repo.take_task_number(db, project),
        title=data.title,
        description=data.description,
        status=data.status,
        priority=data.priority,
        position=_end_of_column(db, project, data.status),
        assignee_id=data.assignee_id,
        due_date=data.due_date,
        created_by=access.user_id,
    )
    activity.record_task(
        db, access.user_id, ActivityAction.TASK_CREATED, task, project, {"status": task.status}
    )
    db.commit()
    # A new task has no comments yet.
    return _read(task, project, assignee, 0)


def get(db: Session, access: TaskAccess) -> TaskRead:
    """Gate: `workspace.view`."""
    return _read_current(db, access.task, access.project)


def update(db: Session, access: TaskAccess, data: TaskUpdate) -> TaskRead:
    """Partial update. Gate: `task.write`.

    Omitted fields stay as they are; `null` clears description, assignee and due date. A new
    status moves the task to the end of that column. An empty or no-op body writes nothing.
    409 `project_archived` (for any body), then 422 on `assignee_id`.
    """
    task, project = access.task, access.project
    _lock_active_project(db, project)
    _reload(db, task)
    fields = data.model_fields_set
    # Validate before changing anything, so a rejected request leaves the task untouched.
    new_assignee = "assignee_id" in fields and data.assignee_id != task.assignee_id
    assignee = None
    if new_assignee and data.assignee_id is not None:
        assignee = _member(db, project, data.assignee_id)

    before = _TaskState.of(task)
    changed = False
    if data.title is not None and data.title != task.title:
        task.title = data.title
        changed = True
    if "description" in fields and data.description != task.description:
        task.description = data.description
        changed = True
    if data.priority is not None and data.priority != task.priority:
        task.priority = data.priority
        changed = True
    if "due_date" in fields and data.due_date != task.due_date:
        task.due_date = data.due_date
        changed = True
    if new_assignee:
        task.assignee_id = data.assignee_id
        changed = True
    if data.status is not None and data.status != task.status:
        task.position = _end_of_column(db, project, data.status, exclude=task.id)
        task.status = data.status
        changed = True
    if changed:
        _record_update(db, access, before, assignee)
        db.commit()
    return _read_current(db, task, project)


def delete(db: Session, access: TaskAccess) -> None:
    """Gate: `task.delete`. Allowed in archived projects.

    The task's activity entries stay, with `task_id` nulled by the database.
    """
    task, project = access.task, access.project
    if not tasks_repo.delete_task(db, task):
        raise NotFound(TASK_NOT_FOUND_MESSAGE)
    activity.record_task(
        db, access.user_id, ActivityAction.TASK_DELETED, task, project, deleted=True
    )
    db.commit()


def move(db: Session, access: TaskAccess, data: TaskMoveRequest) -> TaskRead:
    """Put the task in `data.status`, after `after_task_id` and before `before_task_id`.

    Gate: `task.write`. 409 `project_archived`, then 422 on a neighbour that is not another task
    of this project already in the target status, or when `before_task_id` is not below
    `after_task_id`.

    The task goes directly after `after_task_id` (else directly before `before_task_id`, else
    to the end), so a client whose view of the column is out of date still gets the task next
    to the neighbour it was dropped on, and never on the same position as another task.
    """
    task, project = access.task, access.project
    _lock_active_project(db, project)
    _reload(db, task)
    column = tasks_repo.list_column(db, project, data.status, exclude=task.id)
    index = _drop_index(column, data)
    before_status = task.status
    same_place = data.status == task.status and index == _index_in(column, task)
    task.status = data.status
    _place(task, column, index)
    if not same_place:
        activity.record_task(
            db,
            access.user_id,
            ActivityAction.TASK_MOVED,
            task,
            project,
            {"before": {"status": before_status}, "after": {"status": task.status}},
        )
    db.commit()
    return _read_current(db, task, project)


def list_my_tasks(db: Session, user: User, filters: TaskFilters) -> list[MyTaskRead]:
    """Tasks assigned to `user` in their workspaces, outside archived projects, by due date."""
    rows = tasks_repo.list_assigned_to(db, user.id, filters)
    return [
        MyTaskRead(
            **_task_fields(task, project, user, comment_count),
            project=ProjectRef(id=project.id, name=project.name, key=project.key),
            workspace=WorkspaceRef(id=workspace.id, name=workspace.name, slug=workspace.slug),
        )
        for task, project, workspace, comment_count in rows
    ]


# --- helpers ------------------------------------------------------------------------------


def _lock_active_project(db: Session, project: Project) -> None:
    """Lock the project for this task write; 409 `project_archived` if it is archived."""
    projects_repo.lock_for_task_write(db, project)
    if project.archived_at is not None:
        raise Conflict(PROJECT_ARCHIVED_MESSAGE, {"reason": "project_archived"})


def _reload(db: Session, task: Task) -> None:
    """Re-read the task now that the project is locked (a concurrent write may have changed
    or deleted it since the access check)."""
    if not tasks_repo.reload(db, task):
        raise NotFound(TASK_NOT_FOUND_MESSAGE)


def _member(db: Session, project: Project, user_id: UUID) -> User:
    """The user, if they are a member (any role) of the project's workspace; else 422."""
    found = members_repo.get(db, project.workspace_id, user_id)
    if found is None:
        raise ValidationFailed.for_field("assignee_id", ASSIGNEE_NOT_MEMBER_MESSAGE)
    _member_row, user = found
    return user


def _assignee_of(db: Session, task: Task) -> User | None:
    return users_repo.get_by_id(db, task.assignee_id) if task.assignee_id is not None else None


def _end_of_column(
    db: Session, project: Project, status: TaskStatus, *, exclude: UUID | None = None
) -> float:
    last = tasks_repo.last_position(db, project, status, exclude=exclude)
    return POSITION_STEP if last is None else last + POSITION_STEP


def _drop_index(column: list[Task], data: TaskMoveRequest) -> int:
    """Where the task goes in `column` (which does not contain it)."""
    ids = [task.id for task in column]
    errors: list[dict[str, str]] = []
    after = _neighbour_index(ids, data.after_task_id, "after_task_id", errors)
    before = _neighbour_index(ids, data.before_task_id, "before_task_id", errors)
    if after is not None and before is not None and before <= after:
        errors.append(_field_error("before_task_id", NEIGHBOURS_OUT_OF_ORDER_MESSAGE))
    if errors:
        raise ValidationFailed(details={"errors": errors})
    if after is not None:
        return after + 1
    if before is not None:
        return before
    return len(column)


def _neighbour_index(
    ids: list[UUID], neighbour_id: UUID | None, field: str, errors: list[dict[str, str]]
) -> int | None:
    if neighbour_id is None:
        return None
    if neighbour_id not in ids:
        # Missing, in another project or column, or the moved task itself: one message, so it
        # reveals nothing about tasks outside this project.
        errors.append(_field_error(field, INVALID_NEIGHBOUR_MESSAGE))
        return None
    return ids.index(neighbour_id)


def _field_error(field: str, message: str) -> dict[str, str]:
    return {"field": field, "location": "body", "message": message}


def _place(task: Task, column: list[Task], index: int) -> None:
    """Give `task` a position between `column[index - 1]` and `column[index]`, rebalancing
    the column when they are too close."""
    previous = column[index - 1].position if index > 0 else None
    following = column[index].position if index < len(column) else None
    position = _position_between(previous, following)
    if position is None:
        _rebalance([*column[:index], task, *column[index:]])
    else:
        task.position = position


def _index_in(column: list[Task], task: Task) -> int:
    """Where `task` currently is in its own `column` (which does not contain it)."""
    here = (task.position, task.number)
    return sum(1 for other in column if (other.position, other.number) < here)


def _position_between(previous: float | None, following: float | None) -> float | None:
    """A position strictly between the neighbours, or None if they are too close."""
    if previous is None:
        return POSITION_STEP if following is None else following - POSITION_STEP
    if following is None:
        return previous + POSITION_STEP
    middle = (previous + following) / 2
    if following - previous < MIN_POSITION_GAP or not previous < middle < following:
        return None
    return middle


def _rebalance(ordered: list[Task]) -> None:
    """Positions 1024, 2048, ... in this order. Only tasks whose position changes are written."""
    for rank, task in enumerate(ordered, start=1):
        position = rank * POSITION_STEP
        if task.position != position:
            task.position = position


# Changes to these fields are `task.updated` entries; status, assignee and due date have their
# own actions. In this order in `changed_fields`.
_EDITED_FIELDS = ("title", "description", "priority")
# Too long for `before`/`after`; only named in `changed_fields`.
_UNSHOWN_FIELDS = frozenset({"description"})


@dataclass(frozen=True)
class _TaskState:
    """The task fields an update can change, as they were before it."""

    title: str
    description: str | None
    priority: TaskPriority
    status: TaskStatus
    assignee_id: UUID | None
    due_date: date | None

    @classmethod
    def of(cls, task: Task) -> Self:
        return cls(
            title=task.title,
            description=task.description,
            priority=task.priority,
            status=task.status,
            assignee_id=task.assignee_id,
            due_date=task.due_date,
        )


def _record_update(
    db: Session, access: TaskAccess, before: _TaskState, new_assignee: User | None
) -> None:
    """The entries of one update, one per kind of change (contract 3.8). `new_assignee` is the
    task's assignee after the update."""
    task, project, actor_id = access.task, access.project, access.user_id
    after = _TaskState.of(task)
    edited = [field for field in _EDITED_FIELDS if getattr(before, field) != getattr(after, field)]
    if edited:
        shown = [field for field in edited if field not in _UNSHOWN_FIELDS]
        activity.record_task(
            db,
            actor_id,
            ActivityAction.TASK_UPDATED,
            task,
            project,
            {
                "changed_fields": edited,
                "before": {field: getattr(before, field) for field in shown},
                "after": {field: getattr(after, field) for field in shown},
            },
        )
    if before.assignee_id != after.assignee_id:
        previous = (
            None if before.assignee_id is None else users_repo.get_by_id(db, before.assignee_id)
        )
        activity.record_task(
            db,
            actor_id,
            ActivityAction.TASK_ASSIGNED,
            task,
            project,
            {
                "before": {"assignee": activity.user_ref(previous)},
                "after": {"assignee": activity.user_ref(new_assignee)},
            },
        )
    if before.due_date != after.due_date:
        activity.record_task(
            db,
            actor_id,
            ActivityAction.TASK_DUE_DATE_CHANGED,
            task,
            project,
            {"before": {"due_date": before.due_date}, "after": {"due_date": after.due_date}},
        )
    if before.status != after.status:
        activity.record_task(
            db,
            actor_id,
            ActivityAction.TASK_MOVED,
            task,
            project,
            {"before": {"status": before.status}, "after": {"status": after.status}},
        )


def _task_fields(
    task: Task, project: Project, assignee: User | None, comment_count: int
) -> dict[str, Any]:
    return {
        "id": task.id,
        "project_id": task.project_id,
        "workspace_id": task.workspace_id,
        "number": task.number,
        "key": f"{project.key}-{task.number}",
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "position": task.position,
        "assignee": None if assignee is None else UserRef(id=assignee.id, name=assignee.name),
        "due_date": task.due_date,
        "comment_count": comment_count,
        "created_by": task.created_by,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def _read(task: Task, project: Project, assignee: User | None, comment_count: int) -> TaskRead:
    return TaskRead(**_task_fields(task, project, assignee, comment_count))


def _read_current(db: Session, task: Task, project: Project) -> TaskRead:
    """The task with its assignee and current comment count read from the database."""
    return _read(task, project, _assignee_of(db, task), comments_repo.count_for_task(db, task))
