"""Comment rules that only concurrent requests can reach through the API.

The stale-access tests change the database between the access check and the service call in
one session. The concurrency tests use committed data and one connection per simulated request
(see tests/concurrency.py); their fixture deletes what it committed.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from uuid import UUID

import pytest
from sqlalchemy import Engine, delete, func, select, update
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound
from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Workspace
from app.repositories import projects as projects_repo
from app.repositories import tasks as tasks_repo
from app.schemas.comment import CommentCreate, CommentRead, CommentUpdate
from app.services import comments as comments_service
from app.services.access import comment_access, task_access
from tests.concurrency import Background, backend_pid, new_session, wait_until_blocked
from tests.factories import (
    create_comment,
    create_project,
    create_task,
    create_team,
    create_user,
    create_workspace,
)

# --- stale access (same session, no threads) -------------------------------------------


def test_create_and_edit_recheck_archived_after_taking_the_lock(db_session: Session) -> None:
    """The access check loaded the project before an archive committed: the write still sees it
    archived, because the lock re-reads the row."""
    team = create_team(db_session)
    project = create_project(db_session, team.workspace)
    task = create_task(db_session, project)
    comment = create_comment(db_session, task, team.owner)
    task_gate = task_access(db_session, task.id, team.owner.id, "comment.create")
    comment_gate = comment_access(db_session, comment.id, team.owner.id, "comment.edit_own")
    db_session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(archived_at=func.now())
        .execution_options(synchronize_session=False)
    )
    assert task_gate.project.archived_at is None

    attempts: list[Callable[[], object]] = [
        lambda: comments_service.create(db_session, task_gate, CommentCreate(body="Late")),
        lambda: comments_service.update(db_session, comment_gate, CommentUpdate(body="Late")),
    ]
    for attempt in attempts:
        with pytest.raises(Conflict) as exc_info:
            attempt()
        assert exc_info.value.details == {"reason": "project_archived"}


def test_create_on_a_task_deleted_meanwhile_is_not_found(db_session: Session) -> None:
    team = create_team(db_session)
    task = create_task(db_session, create_project(db_session, team.workspace))
    gate = task_access(db_session, task.id, team.owner.id, "comment.create")
    db_session.execute(
        delete(Task).where(Task.id == task.id).execution_options(synchronize_session=False)
    )

    with pytest.raises(NotFound) as exc_info:
        comments_service.create(db_session, gate, CommentCreate(body="Gone"))

    assert exc_info.value.message == "Task not found"


def test_writes_on_a_comment_deleted_meanwhile_are_not_found(db_session: Session) -> None:
    team = create_team(db_session)
    task = create_task(db_session, create_project(db_session, team.workspace))
    comment = create_comment(db_session, task, team.owner)
    gate = comment_access(db_session, comment.id, team.owner.id, "comment.edit_own")
    db_session.execute(
        delete(Comment).where(Comment.id == comment.id).execution_options(synchronize_session=False)
    )

    attempts: list[Callable[[], object]] = [
        lambda: comments_service.update(db_session, gate, CommentUpdate(body="Gone")),
        lambda: comments_service.delete(db_session, gate),
    ]
    for attempt in attempts:
        with pytest.raises(NotFound) as exc_info:
            attempt()
        assert exc_info.value.message == "Comment not found"


# --- concurrent requests ---------------------------------------------------------------


@dataclass(frozen=True)
class Committed:
    engine: Engine
    user_id: UUID
    project_id: UUID
    task_id: UUID


@pytest.fixture
def committed(engine: Engine) -> Iterator[Committed]:
    """An owner, their workspace, a project and a task, committed so other connections see
    them."""
    with Session(engine) as db:
        user = create_user(db)
        workspace = create_workspace(db, owner=user)
        project = create_project(db, workspace, key="RACE")
        task = create_task(db, project)
        db.commit()
        ids = (user.id, workspace.id, project.id, task.id)
    user_id, workspace_id, project_id, task_id = ids
    try:
        yield Committed(engine=engine, user_id=user_id, project_id=project_id, task_id=task_id)
    finally:
        with Session(engine) as db:
            # Cascades to the members, the project, its tasks and their comments.
            db.execute(delete(Workspace).where(Workspace.id == workspace_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


def comment_in_new_session(committed: Committed, body: str) -> CommentRead:
    """One POST /tasks/{tid}/comments request, on its own connection."""
    with new_session(committed.engine) as db:
        access = task_access(db, committed.task_id, committed.user_id, "comment.create")
        return comments_service.create(db, access, CommentCreate(body=body))


def stored_comments(committed: Committed) -> int:
    with new_session(committed.engine) as db:
        count = db.scalar(
            select(func.count()).select_from(Comment).where(Comment.task_id == committed.task_id)
        )
    assert isinstance(count, int)
    return count


def test_a_comment_waits_for_a_concurrent_archive_and_then_conflicts(
    committed: Committed,
) -> None:
    with new_session(committed.engine) as archiver:
        project = archiver.get(Project, committed.project_id)
        assert project is not None
        assert projects_repo.archive(archiver, project)

        commenter = Background(lambda: comment_in_new_session(committed, "Too late")).start()
        wait_until_blocked(committed.engine, commenter, backend_pid(archiver))
        archiver.commit()

    with pytest.raises(Conflict) as exc_info:
        commenter.join()
    assert exc_info.value.details == {"reason": "project_archived"}
    assert stored_comments(committed) == 0


def test_a_comment_waits_for_a_concurrent_task_delete_and_then_is_not_found(
    committed: Committed,
) -> None:
    with new_session(committed.engine) as deleter:
        task = deleter.get(Task, committed.task_id)
        assert task is not None
        assert tasks_repo.delete_task(deleter, task)

        commenter = Background(lambda: comment_in_new_session(committed, "Too late")).start()
        wait_until_blocked(committed.engine, commenter, backend_pid(deleter))
        deleter.commit()

    with pytest.raises(NotFound) as exc_info:
        commenter.join()
    assert exc_info.value.message == "Task not found"
    assert stored_comments(committed) == 0
