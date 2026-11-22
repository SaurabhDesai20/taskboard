from uuid import UUID

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.orm import Session

from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.schemas.pagination import Cursor

# A thread reads oldest first; the id breaks ties between equal timestamps.
_THREAD_ORDER = (Comment.created_at, Comment.id)


def get_with_task_and_project(
    db: Session, comment_id: UUID
) -> tuple[Comment, Task, Project] | None:
    """The comment with its task and project, in any workspace. Callers check membership next."""
    stmt = (
        select(Comment, Task, Project)
        .join(Task, Task.id == Comment.task_id)
        .join(Project, Project.id == Task.project_id)
        .where(Comment.id == comment_id)
    )
    row = db.execute(stmt).one_or_none()
    if row is None:
        return None
    comment, task, project = row
    return comment, task, project


def list_for_task(
    db: Session, task: Task, *, after: Cursor | None, limit: int
) -> list[tuple[Comment, User]]:
    """Up to `limit` of the task's comments with their authors, oldest first, starting after
    the keyset position `after` (from the beginning if None)."""
    stmt = (
        select(Comment, User)
        .join(User, User.id == Comment.author_id)
        .where(Comment.workspace_id == task.workspace_id, Comment.task_id == task.id)
        .order_by(*_THREAD_ORDER)
        .limit(limit)
    )
    if after is not None:
        stmt = stmt.where(tuple_(*_THREAD_ORDER) > tuple_(after.created_at, after.id))
    return [(comment, author) for comment, author in db.execute(stmt)]


def count_for_task(db: Session, task: Task) -> int:
    stmt = select(func.count()).where(
        Comment.workspace_id == task.workspace_id, Comment.task_id == task.id
    )
    return db.scalar(stmt) or 0


def create(db: Session, *, task: Task, author_id: UUID, body: str) -> Comment:
    """Insert and flush, so the id and created_at are set. The caller commits."""
    comment = Comment(
        task_id=task.id, workspace_id=task.workspace_id, author_id=author_id, body=body
    )
    db.add(comment)
    db.flush()
    return comment


def lock(db: Session, comment: Comment) -> bool:
    """Lock the comment's row until the transaction ends and re-read it into `comment`.

    False if it has been deleted meanwhile (directly, or with its task).
    """
    stmt = (
        select(Comment)
        .where(Comment.workspace_id == comment.workspace_id, Comment.id == comment.id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    return db.scalars(stmt).one_or_none() is not None


def edit(db: Session, comment: Comment, body: str) -> None:
    """Replace the body and set `edited_at` to the database's now(). The caller commits."""
    comment.body = body
    comment.edited_at = func.now()
    db.flush()


def delete_comment(db: Session, comment: Comment) -> bool:
    """Delete the comment. False if it was already gone (a concurrent delete). The caller
    commits."""
    stmt = delete(Comment).where(
        Comment.workspace_id == comment.workspace_id, Comment.id == comment.id
    )
    deleted_id = db.scalar(stmt.returning(Comment.id))
    return deleted_id is not None
