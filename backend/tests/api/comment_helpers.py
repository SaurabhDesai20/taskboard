"""URLs and request helpers shared by the comment API tests (contract section 3.7)."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient

from app.models.comment import Comment
from tests.api.task_helpers import Json

COMMENT_FIELDS = {"id", "task_id", "author", "body", "created_at", "edited_at"}


def comments_url(task_id: UUID | str) -> str:
    return f"/api/tasks/{task_id}/comments"


def comment_url(comment_id: UUID | str) -> str:
    return f"/api/comments/{comment_id}"


def post_comment(client: TestClient, task_id: UUID | str, body: str) -> Json:
    response = client.post(comments_url(task_id), json={"body": body})
    assert response.status_code == 201, response.text
    created: Json = response.json()
    return created


def get_page(client: TestClient, task_id: UUID | str, /, **params: Any) -> Json:
    response = client.get(comments_url(task_id), params=params)
    assert response.status_code == 200, response.text
    page: Json = response.json()
    assert set(page) == {"items", "next_cursor"}
    return page


def all_pages(client: TestClient, task_id: UUID | str, *, limit: int) -> list[list[Json]]:
    """Follow `next_cursor` from the first page to the last; each page's items."""
    pages: list[list[Json]] = []
    params: dict[str, Any] = {"limit": limit}
    while True:
        page = get_page(client, task_id, **params)
        pages.append(page["items"])
        if page["next_cursor"] is None:
            return pages
        assert len(pages) < 1000, "pagination never ended"
        params["cursor"] = page["next_cursor"]


def thread_order(comments: list[Comment]) -> list[str]:
    """Comment ids in the API's order: oldest first, ties by id."""
    return [str(c.id) for c in sorted(comments, key=lambda c: (c.created_at, c.id))]


def comment_ids(items: list[Json]) -> list[str]:
    return [item["id"] for item in items]
