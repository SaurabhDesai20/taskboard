"""Activity log response models (docs/api-contract.md sections 1.6, 2 and 3.8)."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from app.models.activity import ActivityAction, ActivityEntityType
from app.schemas.common import UtcDatetime
from app.schemas.user import UserRef


class ActivityRead(BaseModel):
    """The contract's `ActivityEntry`."""

    id: UUID
    workspace_id: UUID
    # Null for workspace and member entries, and once the project or task has been deleted.
    project_id: UUID | None
    task_id: UUID | None
    actor: UserRef
    action: ActivityAction
    entity_type: ActivityEntityType
    entity_id: UUID
    # Snapshots for rendering the message; the shape depends on `action` (contract 3.8).
    metadata: dict[str, Any]
    created_at: UtcDatetime


class ActivityPage(BaseModel):
    """One page of a workspace's activity, newest first. `next_cursor` is null on the last
    page."""

    items: list[ActivityRead]
    next_cursor: str | None


@dataclass(frozen=True)
class ActivityFilters:
    """Activity list filters from the query string. `None` means "do not filter". They only
    narrow the workspace's entries: an id from elsewhere matches nothing."""

    project_id: UUID | None = None
    task_id: UUID | None = None
    actor_id: UUID | None = None
