"""Comment request and response models (docs/api-contract.md sections 1.6, 1.8, 2 and 3.7)."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints

from app.schemas.common import NotNull, UtcDatetime
from app.schemas.user import UserRef

# Trimmed, then 1 to 5000 characters. Inner whitespace and line breaks are kept.
CommentBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]


class CommentRead(BaseModel):
    """The contract's `Comment`."""

    id: UUID
    task_id: UUID
    author: UserRef
    body: str
    created_at: UtcDatetime
    # Null until the author edits the comment.
    edited_at: UtcDatetime | None


class CommentPage(BaseModel):
    """One page of a task's comments, oldest first. `next_cursor` is null on the last page."""

    items: list[CommentRead]
    next_cursor: str | None


class CommentCreate(BaseModel):
    body: CommentBody


class CommentUpdate(BaseModel):
    """Partial update: an omitted body stays unchanged; `null` is invalid."""

    body: Annotated[CommentBody | None, NotNull] = None
