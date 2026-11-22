"""URLs and request helpers shared by the task API tests (contract section 3.6)."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient

TASK_FIELDS = {
    "id",
    "project_id",
    "workspace_id",
    "number",
    "key",
    "title",
    "description",
    "status",
    "priority",
    "position",
    "assignee",
    "due_date",
    "comment_count",
    "created_by",
    "created_at",
    "updated_at",
}
MY_TASK_FIELDS = TASK_FIELDS | {"project", "workspace"}

Json = dict[str, Any]


def tasks_url(project_id: UUID | str) -> str:
    return f"/api/projects/{project_id}/tasks"


def task_url(task_id: UUID | str) -> str:
    return f"/api/tasks/{task_id}"


def move_url(task_id: UUID | str) -> str:
    return f"/api/tasks/{task_id}/move"


def create_task(client: TestClient, project_id: UUID | str, /, **body: Any) -> Json:
    response = client.post(tasks_url(project_id), json=body)
    assert response.status_code == 201, response.text
    created: Json = response.json()
    return created


def list_tasks(client: TestClient, project_id: UUID | str, /, **params: Any) -> list[Json]:
    response = client.get(tasks_url(project_id), params=params)
    assert response.status_code == 200, response.text
    tasks: list[Json] = response.json()
    return tasks


def get_task(client: TestClient, task_id: UUID | str) -> Json:
    response = client.get(task_url(task_id))
    assert response.status_code == 200, response.text
    task: Json = response.json()
    return task


def patch_task(client: TestClient, task_id: UUID | str, body: Json) -> Json:
    response = client.patch(task_url(task_id), json=body)
    assert response.status_code == 200, response.text
    updated: Json = response.json()
    assert get_task(client, task_id) == updated
    return updated


def move_task(
    client: TestClient,
    task_id: UUID | str,
    status: str,
    *,
    after: UUID | str | None = None,
    before: UUID | str | None = None,
) -> Json:
    body = {
        "status": status,
        "after_task_id": str(after) if after else None,
        "before_task_id": str(before) if before else None,
    }
    response = client.post(move_url(task_id), json=body)
    assert response.status_code == 200, response.text
    moved: Json = response.json()
    assert get_task(client, task_id) == moved
    return moved


def ids(tasks: list[Json]) -> list[str]:
    return [task["id"] for task in tasks]
