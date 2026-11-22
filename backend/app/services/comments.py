"""Comments on tasks (docs/api-contract.md section 3.7).

Functions that take a TaskAccess expect the route's `require_task_role(...)` gate to have run;
functions that take a CommentAccess expect `require_comment_role("comment.edit_own")`. Those
gates resolve the comment or task to its workspace and apply the 404/403 rules, so a comment of
a workspace the caller does not belong to never reaches this module.

Author-or-admin rule (PLAN.md section 4):
- Editing is author-only, and the author must still have `comment.edit_own` (the gate).
- Deleting is allowed to the author (with `comment.edit_own`, the gate) and to anyone with
  `comment.delete_any`.
- Anyone else gets 403 `not_author`.

Archived projects: creating and editing comments is a 409 `project_archived`; deleting works.
Create and edit share-lock the project first (`projects_repo.lock_for_comment_write`), so the
archived check is current under concurrent archives.
"""

from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound
from app.models.comment import Comment
from app.models.project import Project
from app.models.user import User
from app.repositories import comments as comments_repo
from app.repositories import projects as projects_repo
from app.repositories import tasks as tasks_repo
from app.repositories import users as users_repo
from app.schemas.comment import CommentCreate, CommentPage, CommentRead, CommentUpdate
from app.schemas.pagination import Cursor
from app.schemas.user import UserRef
from app.services.access import (
    COMMENT_NOT_FOUND_MESSAGE,
    TASK_NOT_FOUND_MESSAGE,
    CommentAccess,
    TaskAccess,
    denied_message,
)
from app.services.permissions import can

PROJECT_ARCHIVED_MESSAGE = "This project is archived, so its comments are read-only"
NOT_AUTHOR_EDIT_MESSAGE = "Only the author can edit this comment"


def list_comments(
    db: Session, access: TaskAccess, *, limit: int, cursor: Cursor | None
) -> CommentPage:
    """One page of the task's comments, oldest first. Gate: `workspace.view`.

    `next_cursor` is the position of the page's last comment, or None when no comment follows.
    """
    # One extra row tells whether another page follows.
    rows = comments_repo.list_for_task(db, access.task, after=cursor, limit=limit + 1)
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last, _author = page[-1]
        next_cursor = Cursor(created_at=last.created_at, id=last.id).encode()
    return CommentPage(
        items=[_read(comment, author) for comment, author in page], next_cursor=next_cursor
    )


def create(db: Session, access: TaskAccess, data: CommentCreate) -> CommentRead:
    """Add a comment by the caller. Gate: `comment.create`. 409 `project_archived`."""
    _lock_active_project(db, access.project)
    # The task may have been deleted since the access check.
    if not tasks_repo.lock_against_delete(db, access.task):
        raise NotFound(TASK_NOT_FOUND_MESSAGE)
    comment = comments_repo.create(db, task=access.task, author_id=access.user_id, body=data.body)
    db.commit()
    return _read(comment, users_repo.get_existing(db, comment.author_id))


def update(db: Session, access: CommentAccess, data: CommentUpdate) -> CommentRead:
    """Replace the body and set `edited_at`. Gate: `comment.edit_own`.

    403 `not_author` unless the caller wrote the comment, then 409 `project_archived` (for any
    body). `{}` or the current body returns the comment unchanged (`edited_at` included).
    """
    comment = access.comment
    if not _is_author(access):
        raise Forbidden(NOT_AUTHOR_EDIT_MESSAGE, {"reason": "not_author"})
    _lock_active_project(db, access.project)
    if not comments_repo.lock(db, comment):
        raise NotFound(COMMENT_NOT_FOUND_MESSAGE)
    if data.body is not None and data.body != comment.body:
        comments_repo.edit(db, comment, data.body)
        db.commit()
    return _read(comment, users_repo.get_existing(db, comment.author_id))


def delete(db: Session, access: CommentAccess) -> None:
    """Gate: `comment.edit_own`, which lets authors delete their own comments. Someone else's
    comment also needs `comment.delete_any`, else 403 `not_author`. Allowed in archived
    projects."""
    if not _is_author(access) and not can(access.role, "comment.delete_any"):
        raise Forbidden(denied_message("comment.delete_any"), {"reason": "not_author"})
    if not comments_repo.delete_comment(db, access.comment):
        raise NotFound(COMMENT_NOT_FOUND_MESSAGE)
    db.commit()


# --- helpers ------------------------------------------------------------------------------


def _is_author(access: CommentAccess) -> bool:
    return access.comment.author_id == access.user_id


def _lock_active_project(db: Session, project: Project) -> None:
    """Share-lock the project for this comment write; 409 `project_archived` if archived."""
    projects_repo.lock_for_comment_write(db, project)
    if project.archived_at is not None:
        raise Conflict(PROJECT_ARCHIVED_MESSAGE, {"reason": "project_archived"})


def _read(comment: Comment, author: User) -> CommentRead:
    return CommentRead(
        id=comment.id,
        task_id=comment.task_id,
        author=UserRef(id=author.id, name=author.name),
        body=comment.body,
        created_at=comment.created_at,
        edited_at=comment.edited_at,
    )
