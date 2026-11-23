"""Activity log endpoint (docs/api-contract.md section 3.8)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, WorkspaceAccess, require_role
from app.api.params import CursorQuery, LimitQuery
from app.schemas.activity import ActivityFilters, ActivityPage
from app.schemas.errors import error_responses
from app.schemas.pagination import DEFAULT_LIMIT, Cursor
from app.services import activity as activity_service

router = APIRouter(tags=["activity"])

CanView = Annotated[WorkspaceAccess, Depends(require_role("workspace.view"))]

ProjectFilter = Annotated[UUID | None, Query(description="Only entries about this project")]
TaskFilter = Annotated[UUID | None, Query(description="Only entries about this task")]
ActorFilter = Annotated[UUID | None, Query(description="Only entries by this user")]


@router.get(
    "/workspaces/{wid}/activity",
    response_model=ActivityPage,
    responses=error_responses(401, 404, 422),
)
def list_activity(
    db: DbSession,
    access: CanView,
    project_id: ProjectFilter = None,
    task_id: TaskFilter = None,
    actor_id: ActorFilter = None,
    limit: LimitQuery = DEFAULT_LIMIT,
    cursor: CursorQuery = None,
) -> ActivityPage:
    filters = ActivityFilters(project_id=project_id, task_id=task_id, actor_id=actor_id)
    position = None if cursor is None else Cursor.decode(cursor)
    return activity_service.list_activity(db, access, filters, limit=limit, cursor=position)
