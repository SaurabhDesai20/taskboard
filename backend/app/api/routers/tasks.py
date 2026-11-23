"""Task endpoints (docs/api-contract.md section 3.6)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    CurrentUser,
    DbSession,
    ProjectAccess,
    TaskAccess,
    require_project_role,
    require_task_role,
)
from app.models.task import TaskPriority, TaskStatus
from app.schemas.errors import error_responses
from app.schemas.task import (
    AssigneeFilter,
    MyTaskRead,
    SearchText,
    TaskCreate,
    TaskFilters,
    TaskMoveRequest,
    TaskRead,
    TaskUpdate,
)
from app.services import tasks as tasks_service

router = APIRouter(tags=["tasks"])

CanViewProject = Annotated[ProjectAccess, Depends(require_project_role("workspace.view"))]
CanWriteProjectTasks = Annotated[ProjectAccess, Depends(require_project_role("task.write"))]
CanViewTask = Annotated[TaskAccess, Depends(require_task_role("workspace.view"))]
CanWriteTask = Annotated[TaskAccess, Depends(require_task_role("task.write"))]
CanDeleteTask = Annotated[TaskAccess, Depends(require_task_role("task.delete"))]

# Query filters. `status` is aliased because the parameter name would shadow fastapi.status.
StatusFilter = Annotated[
    list[TaskStatus] | None,
    Query(alias="status", description="Only these statuses (repeatable)"),
]
PriorityFilter = Annotated[
    list[TaskPriority] | None, Query(description="Only these priorities (repeatable)")
]
AssigneeIdFilter = Annotated[
    AssigneeFilter | None, Query(description="A user id, or `none` for unassigned tasks")
]
DueBeforeFilter = Annotated[
    date | None,
    Query(description="Due on or before this date; excludes tasks without a due date"),
]
SearchFilter = Annotated[
    SearchText | None,
    Query(description="Case-insensitive substring of the title or description"),
]


@router.get(
    "/projects/{pid}/tasks",
    response_model=list[TaskRead],
    responses=error_responses(401, 404, 422),
)
def list_tasks(
    db: DbSession,
    access: CanViewProject,
    status_: StatusFilter = None,
    priority: PriorityFilter = None,
    assignee_id: AssigneeIdFilter = None,
    due_before: DueBeforeFilter = None,
    q: SearchFilter = None,
) -> list[TaskRead]:
    filters = TaskFilters(
        statuses=tuple(status_ or ()),
        priorities=tuple(priority or ()),
        assignee=assignee_id,
        due_before=due_before,
        q=q,
    )
    return tasks_service.list_tasks(db, access, filters)


@router.post(
    "/projects/{pid}/tasks",
    status_code=status.HTTP_201_CREATED,
    response_model=TaskRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_task(body: TaskCreate, db: DbSession, access: CanWriteProjectTasks) -> TaskRead:
    return tasks_service.create(db, access, body)


@router.get("/tasks/{tid}", response_model=TaskRead, responses=error_responses(401, 404, 422))
def get_task(db: DbSession, access: CanViewTask) -> TaskRead:
    return tasks_service.get(db, access)


@router.patch(
    "/tasks/{tid}", response_model=TaskRead, responses=error_responses(401, 403, 404, 409, 422)
)
def update_task(body: TaskUpdate, db: DbSession, access: CanWriteTask) -> TaskRead:
    return tasks_service.update(db, access, body)


@router.delete(
    "/tasks/{tid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 422),
)
def delete_task(db: DbSession, access: CanDeleteTask) -> None:
    tasks_service.delete(db, access)


@router.post(
    "/tasks/{tid}/move",
    response_model=TaskRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def move_task(body: TaskMoveRequest, db: DbSession, access: CanWriteTask) -> TaskRead:
    return tasks_service.move(db, access, body)


@router.get("/me/tasks", response_model=list[MyTaskRead], responses=error_responses(401, 422))
def list_my_tasks(
    db: DbSession,
    user: CurrentUser,
    status_: StatusFilter = None,
    due_before: DueBeforeFilter = None,
) -> list[MyTaskRead]:
    filters = TaskFilters(statuses=tuple(status_ or ()), due_before=due_before)
    return tasks_service.list_my_tasks(db, user, filters)
