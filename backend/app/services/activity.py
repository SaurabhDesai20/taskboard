"""The activity log (docs/api-contract.md section 3.8).

Writing: `record(...)` is the single entry point; the `record_*` helpers below only fill in its
arguments for each kind of entity. Every mutating service calls it after all of its checks have
passed and right before its single `db.commit()`, so the entry is part of the change's own
transaction:
- a request that fails never commits, and the session's rollback discards its entries too;
- a committed change always has its entries.
A request that changes nothing (a PATCH with `{}` or the current values) records nothing.

`metadata` holds snapshots: names, keys and titles as they were when the action happened, so the
UI renders a message from `action` + `metadata` alone, even after renames and deletes. It is
stored as JSON: UUIDs and dates become strings.

Reading: `list_activity(...)` serves GET /workspaces/{wid}/activity.
"""

from typing import Any
from uuid import UUID

from pydantic_core import to_jsonable_python
from sqlalchemy.orm import Session

from app.models.activity import ActivityAction, ActivityLog
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Workspace
from app.repositories import activity as activity_repo
from app.schemas.activity import ActivityFilters, ActivityPage, ActivityRead
from app.schemas.pagination import Cursor
from app.schemas.user import UserRef
from app.services.access import WorkspaceAccess

# `excerpt` in comment entries: the first this many characters of the body.
EXCERPT_LENGTH = 140

Metadata = dict[str, Any]


def record(
    db: Session,
    *,
    actor_id: UUID,
    action: ActivityAction,
    workspace_id: UUID,
    entity_id: UUID,
    metadata: Metadata,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
) -> None:
    """Add an activity entry to the current transaction. The caller commits.

    The entity type is the part of `action` before the dot.
    """
    activity_repo.add(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        action=action,
        entity_type=action.entity_type,
        entity_id=entity_id,
        metadata=to_jsonable_python(metadata),
    )


def record_workspace(
    db: Session, actor_id: UUID, action: ActivityAction, workspace: Workspace, metadata: Metadata
) -> None:
    record(
        db,
        actor_id=actor_id,
        action=action,
        workspace_id=workspace.id,
        entity_id=workspace.id,
        metadata=metadata,
    )


def record_member(
    db: Session,
    actor_id: UUID,
    action: ActivityAction,
    workspace_id: UUID,
    user: User,
    metadata: Metadata,
) -> None:
    """A member entry: its entity id is the member's user id; `metadata.user` names them."""
    record(
        db,
        actor_id=actor_id,
        action=action,
        workspace_id=workspace_id,
        entity_id=user.id,
        metadata={"user": user_ref(user), **metadata},
    )


def record_project(
    db: Session,
    actor_id: UUID,
    action: ActivityAction,
    project: Project,
    metadata: Metadata | None = None,
) -> None:
    """A project entry; `metadata.project` is the project as it is now."""
    record(
        db,
        actor_id=actor_id,
        action=action,
        workspace_id=project.workspace_id,
        project_id=project.id,
        entity_id=project.id,
        metadata={"project": project_ref(project), **(metadata or {})},
    )


def record_task(
    db: Session,
    actor_id: UUID,
    action: ActivityAction,
    task: Task,
    project: Project,
    metadata: Metadata | None = None,
    *,
    deleted: bool = False,
) -> None:
    """A task entry; `metadata.task` is the task as it is now. A `deleted` task's entry has no
    `task_id`, like the task's earlier entries once the delete nulls theirs."""
    record(
        db,
        actor_id=actor_id,
        action=action,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=None if deleted else task.id,
        entity_id=task.id,
        metadata={"task": task_ref(task, project), **(metadata or {})},
    )


def record_comment(
    db: Session,
    actor_id: UUID,
    action: ActivityAction,
    comment_id: UUID,
    task: Task,
    project: Project,
    metadata: Metadata | None = None,
) -> None:
    """A comment entry; `metadata.task` is the comment's task as it is now."""
    record(
        db,
        actor_id=actor_id,
        action=action,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        entity_id=comment_id,
        metadata={"task": task_ref(task, project), **(metadata or {})},
    )


# --- snapshots ----------------------------------------------------------------------------


def user_ref(user: User | None) -> Metadata | None:
    """The contract's `UserRef`: `{id, name}`, or None for no user (e.g. unassigned)."""
    return None if user is None else {"id": user.id, "name": user.name}


def project_ref(project: Project) -> Metadata:
    """The contract's `ProjectRef`: `{id, name, key}`."""
    return {"id": project.id, "name": project.name, "key": project.key}


def task_ref(task: Task, project: Project) -> Metadata:
    """The contract's `TaskRef`: `{id, key, title}`, with the key like "WEB-12"."""
    return {"id": task.id, "key": f"{project.key}-{task.number}", "title": task.title}


def excerpt(body: str) -> str:
    return body[:EXCERPT_LENGTH]


# --- reading ------------------------------------------------------------------------------


def list_activity(
    db: Session,
    access: WorkspaceAccess,
    filters: ActivityFilters,
    *,
    limit: int,
    cursor: Cursor | None,
) -> ActivityPage:
    """One page of the workspace's activity, newest first. Gate: `workspace.view`.

    The filters only narrow the workspace's entries. `next_cursor` is the position of the page's
    last entry, or None when no older entry matches.
    """
    # One extra row tells whether another page follows.
    rows = activity_repo.list_for_workspace(
        db, access.workspace.id, filters, before=cursor, limit=limit + 1
    )
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last, _actor = page[-1]
        next_cursor = Cursor(created_at=last.created_at, id=last.id).encode()
    return ActivityPage(
        items=[_read(entry, actor) for entry, actor in page], next_cursor=next_cursor
    )


def _read(entry: ActivityLog, actor: User) -> ActivityRead:
    return ActivityRead(
        id=entry.id,
        workspace_id=entry.workspace_id,
        project_id=entry.project_id,
        task_id=entry.task_id,
        actor=UserRef(id=actor.id, name=actor.name),
        action=entry.action,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        metadata=entry.metadata_,
        created_at=entry.created_at,
    )
