"""Task request and response models (docs/api-contract.md sections 1.8, 2 and 3.6)."""

from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, PlainValidator, StringConstraints, WithJsonSchema
from pydantic_core import PydanticCustomError

from app.models.task import TaskPriority, TaskStatus
from app.schemas.common import NotNull, UtcDatetime

TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
# May be empty after trimming: "" is kept as "", and null means "no description".
TaskDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]
# The `q` search filter: trimmed, then 1 to 200 characters.
SearchText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

UNASSIGNED: Literal["none"] = "none"


def _parse_assignee_filter(value: Any) -> UUID | Literal["none"]:
    if value == UNASSIGNED:
        return UNASSIGNED
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except ValueError:
        raise PydanticCustomError(
            "uuid_or_none", "Input should be a valid UUID or 'none'"
        ) from None


AssigneeFilter = Annotated[
    UUID | Literal["none"],
    PlainValidator(_parse_assignee_filter),
    WithJsonSchema(
        {"anyOf": [{"type": "string", "format": "uuid"}, {"type": "string", "enum": ["none"]}]}
    ),
]
"""`assignee_id` in the task list query: a user id, or `none` for unassigned tasks."""


class UserRef(BaseModel):
    """A user's id and display name, nested in other objects (e.g. a task's assignee)."""

    id: UUID
    name: str


class ProjectRef(BaseModel):
    id: UUID
    name: str
    key: str


class WorkspaceRef(BaseModel):
    id: UUID
    name: str
    slug: str


class TaskRead(BaseModel):
    """The contract's `Task`."""

    id: UUID
    project_id: UUID
    workspace_id: UUID
    number: int
    # "<project key>-<number>", e.g. "WEB-12".
    key: str
    title: str
    description: str | None
    status: TaskStatus
    priority: TaskPriority
    position: float
    assignee: UserRef | None
    due_date: date | None
    comment_count: int
    created_by: UUID
    created_at: UtcDatetime
    updated_at: UtcDatetime


class MyTaskRead(TaskRead):
    """The contract's `MyTask`: a task plus summaries of its project and workspace."""

    project: ProjectRef
    workspace: WorkspaceRef


class TaskCreate(BaseModel):
    title: TaskTitle
    description: TaskDescription | None = None
    status: TaskStatus = TaskStatus.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    assignee_id: UUID | None = None
    due_date: date | None = None


class TaskUpdate(BaseModel):
    """Partial update: omitted fields stay unchanged. `null` clears description, assignee_id
    and due_date; it is invalid for title, status and priority."""

    # The service tells omitted and null apart with `model_fields_set`.
    title: Annotated[TaskTitle | None, NotNull] = None
    description: TaskDescription | None = None
    status: Annotated[TaskStatus | None, NotNull] = None
    priority: Annotated[TaskPriority | None, NotNull] = None
    assignee_id: UUID | None = None
    due_date: date | None = None


class TaskMoveRequest(BaseModel):
    """Place the task in `status` after `after_task_id` and before `before_task_id`."""

    status: TaskStatus
    after_task_id: UUID | None = None
    before_task_id: UUID | None = None


@dataclass(frozen=True)
class TaskFilters:
    """Task list filters from the query string. `None` (or empty) means "do not filter"."""

    statuses: tuple[TaskStatus, ...] = ()
    priorities: tuple[TaskPriority, ...] = ()
    # A user id, or UNASSIGNED for tasks without an assignee.
    assignee: UUID | Literal["none"] | None = None
    # Inclusive; tasks without a due date never match.
    due_before: date | None = None
    # Case-insensitive substring of the title or the description.
    q: str | None = None
