"""Comment endpoints (docs/api-contract.md section 3.7)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    CommentAccess,
    DbSession,
    TaskAccess,
    require_comment_role,
    require_task_role,
)
from app.schemas.comment import CommentCreate, CommentPage, CommentRead, CommentUpdate
from app.schemas.errors import error_responses
from app.schemas.pagination import DEFAULT_LIMIT, MAX_LIMIT, Cursor, PageCursor
from app.services import comments as comments_service

router = APIRouter(tags=["comments"])

CanViewTask = Annotated[TaskAccess, Depends(require_task_role("workspace.view"))]
CanCommentOnTask = Annotated[TaskAccess, Depends(require_task_role("comment.create"))]
# Edit and delete both need at least `comment.edit_own`; the service applies the author rule.
CanChangeComment = Annotated[CommentAccess, Depends(require_comment_role("comment.edit_own"))]

LimitQuery = Annotated[int, Query(ge=1, le=MAX_LIMIT, description="Page size")]
CursorQuery = Annotated[
    PageCursor | None,
    Query(description="The previous page's `next_cursor`; omit for the first page"),
]


@router.get(
    "/tasks/{tid}/comments",
    response_model=CommentPage,
    responses=error_responses(401, 404, 422),
)
def list_comments(
    db: DbSession,
    access: CanViewTask,
    limit: LimitQuery = DEFAULT_LIMIT,
    cursor: CursorQuery = None,
) -> CommentPage:
    position = None if cursor is None else Cursor.decode(cursor)
    return comments_service.list_comments(db, access, limit=limit, cursor=position)


@router.post(
    "/tasks/{tid}/comments",
    status_code=status.HTTP_201_CREATED,
    response_model=CommentRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_comment(body: CommentCreate, db: DbSession, access: CanCommentOnTask) -> CommentRead:
    return comments_service.create(db, access, body)


@router.patch(
    "/comments/{cid}",
    response_model=CommentRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_comment(body: CommentUpdate, db: DbSession, access: CanChangeComment) -> CommentRead:
    return comments_service.update(db, access, body)


@router.delete(
    "/comments/{cid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 422),
)
def delete_comment(db: DbSession, access: CanChangeComment) -> None:
    comments_service.delete(db, access)
