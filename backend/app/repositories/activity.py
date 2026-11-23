from typing import Any
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.models.activity import ActivityAction, ActivityEntityType, ActivityLog
from app.models.user import User
from app.schemas.activity import ActivityFilters
from app.schemas.pagination import Cursor

# The feed reads newest first; the id breaks ties between equal timestamps.
_FEED_KEY = (ActivityLog.created_at, ActivityLog.id)


def add(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    task_id: UUID | None,
    actor_id: UUID,
    action: ActivityAction,
    entity_type: ActivityEntityType,
    entity_id: UUID,
    metadata: dict[str, Any],
) -> ActivityLog:
    """Insert and flush, so the id and created_at are set. The caller commits."""
    entry = ActivityLog(
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_=metadata,
    )
    db.add(entry)
    db.flush()
    return entry


def list_for_workspace(
    db: Session,
    workspace_id: UUID,
    filters: ActivityFilters,
    *,
    before: Cursor | None,
    limit: int,
) -> list[tuple[ActivityLog, User]]:
    """Up to `limit` of the workspace's matching entries with their actors, newest first,
    starting after (that is, older than) the keyset position `before` (from the newest if
    None)."""
    stmt = (
        select(ActivityLog, User)
        .join(User, User.id == ActivityLog.actor_id)
        .where(ActivityLog.workspace_id == workspace_id)
        .order_by(*(column.desc() for column in _FEED_KEY))
        .limit(limit)
    )
    if filters.project_id is not None:
        stmt = stmt.where(ActivityLog.project_id == filters.project_id)
    if filters.task_id is not None:
        stmt = stmt.where(ActivityLog.task_id == filters.task_id)
    if filters.actor_id is not None:
        stmt = stmt.where(ActivityLog.actor_id == filters.actor_id)
    if before is not None:
        stmt = stmt.where(tuple_(*_FEED_KEY) < tuple_(before.created_at, before.id))
    return [(entry, actor) for entry, actor in db.execute(stmt)]
