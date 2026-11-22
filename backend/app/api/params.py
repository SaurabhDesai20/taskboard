"""Query parameters shared by several routers."""

from typing import Annotated

from fastapi import Query

from app.schemas.pagination import MAX_LIMIT, PageCursor

# Cursor pagination (docs/api-contract.md section 1.6). Use with `= DEFAULT_LIMIT` / `= None`.
LimitQuery = Annotated[int, Query(ge=1, le=MAX_LIMIT, description="Page size")]
CursorQuery = Annotated[
    PageCursor | None,
    Query(description="The previous page's `next_cursor`; omit for the first page"),
]
