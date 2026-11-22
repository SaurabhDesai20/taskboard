"""URLs, request helpers and expected entries for the activity API tests (contract 3.8)."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import ActivityLog
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from tests.api.task_helpers import Json

ENTRY_FIELDS = {
    "id",
    "workspace_id",
    "project_id",
    "task_id",
    "actor",
    "action",
    "entity_type",
    "entity_id",
    "metadata",
    "created_at",
}


def activity_url(workspace_id: UUID | str) -> str:
    return f"/api/workspaces/{workspace_id}/activity"


def get_page(client: TestClient, workspace_id: UUID | str, /, **params: Any) -> Json:
    response = client.get(activity_url(workspace_id), params=params)
    assert response.status_code == 200, response.text
    page: Json = response.json()
    assert set(page) == {"items", "next_cursor"}
    for item in page["items"]:
        assert set(item) == ENTRY_FIELDS
    return page


def all_pages(
    client: TestClient, workspace_id: UUID | str, *, limit: int, **params: Any
) -> list[list[Json]]:
    """Follow `next_cursor` from the first page to the last; each page's items."""
    pages: list[list[Json]] = []
    query: dict[str, Any] = {"limit": limit, **params}
    while True:
        page = get_page(client, workspace_id, **query)
        pages.append(page["items"])
        if page["next_cursor"] is None:
            return pages
        assert len(pages) < 1000, "pagination never ended"
        query["cursor"] = page["next_cursor"]


def feed(client: TestClient, workspace_id: UUID | str, /, **params: Any) -> list[Json]:
    """Every matching entry (one page of up to 100), newest first, without `id` and
    `created_at` (checked here), ready to compare with `expected(...)`."""
    page = get_page(client, workspace_id, limit=100, **params)
    assert page["next_cursor"] is None
    entries = []
    for item in page["items"]:
        assert UUID(item.pop("id"))
        assert item.pop("created_at").endswith("Z")
        entries.append(item)
    return entries


def expected(
    *,
    workspace_id: UUID | str,
    actor: User,
    action: str,
    entity_id: UUID | str,
    metadata: Json,
    project_id: UUID | str | None = None,
    task_id: UUID | str | None = None,
) -> Json:
    """An entry as `feed` returns it."""
    return {
        "workspace_id": str(workspace_id),
        "project_id": None if project_id is None else str(project_id),
        "task_id": None if task_id is None else str(task_id),
        "actor": {"id": str(actor.id), "name": actor.name},
        "action": action,
        "entity_type": action.partition(".")[0],
        "entity_id": str(entity_id),
        "metadata": metadata,
    }


def task_ref(task: Task | Json, project: Project, title: str | None = None) -> Json:
    """The contract's TaskRef for a task (an ORM row or an API response)."""
    if isinstance(task, Task):
        task_id, number, current_title = str(task.id), task.number, task.title
    else:
        task_id, number, current_title = task["id"], task["number"], task["title"]
    return {
        "id": task_id,
        "key": f"{project.key}-{number}",
        "title": current_title if title is None else title,
    }


def project_ref(project: Project | Json) -> Json:
    if isinstance(project, Project):
        return {"id": str(project.id), "name": project.name, "key": project.key}
    return {"id": project["id"], "name": project["name"], "key": project["key"]}


def user_ref(user: User) -> Json:
    return {"id": str(user.id), "name": user.name}


def entry_ids(items: list[Json]) -> list[str]:
    return [item["id"] for item in items]


def feed_order(entries: list[ActivityLog]) -> list[str]:
    """Entry ids in the API's order: newest first, ties by id (descending)."""
    ordered = sorted(entries, key=lambda e: (e.created_at, e.id), reverse=True)
    return [str(e.id) for e in ordered]


def stored_count(db: Session, *workspace_ids: UUID) -> int:
    """Activity rows of these workspaces, read in the test's own transaction."""
    stmt = select(func.count()).where(ActivityLog.workspace_id.in_(workspace_ids))
    count = db.scalar(stmt)
    assert isinstance(count, int)
    return count
