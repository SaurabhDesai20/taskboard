"""Task rules that only concurrent requests can reach through the API.

The concurrency tests use real, committed data and separate database connections (one per
simulated request), because the per-test rolled-back transaction of the other tests is a single
connection and cannot block itself. Their fixture deletes what it committed.
"""

import functools
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from uuid import UUID

import pytest
from sqlalchemy import Engine, delete, func, select, update
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound
from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.models.workspace import Workspace
from app.repositories import projects as projects_repo
from app.schemas.task import TaskCreate, TaskMoveRequest, TaskRead, TaskUpdate
from app.services import tasks as tasks_service
from app.services.access import project_access, task_access
from tests.concurrency import (
    LOCK_WAIT_TIMEOUT,
    Background,
    backend_pid,
    new_session,
    wait_until_blocked,
)
from tests.factories import create_project, create_task, create_team, create_user, create_workspace


@dataclass(frozen=True)
class Committed:
    engine: Engine
    user_id: UUID
    project_id: UUID


@pytest.fixture
def committed(engine: Engine) -> Iterator[Committed]:
    """An owner, their workspace and a project, committed so other connections see them."""
    with Session(engine) as db:
        user = create_user(db)
        workspace = create_workspace(db, owner=user)
        project = create_project(db, workspace, key="RACE")
        db.commit()
        user_id, workspace_id, project_id = user.id, workspace.id, project.id
    try:
        yield Committed(engine=engine, user_id=user_id, project_id=project_id)
    finally:
        with Session(engine) as db:
            # Cascades to the members, the project and its tasks.
            db.execute(delete(Workspace).where(Workspace.id == workspace_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


def create_in_new_session(committed: Committed, title: str) -> TaskRead:
    """One POST /projects/{pid}/tasks request, on its own connection."""
    with new_session(committed.engine) as db:
        access = project_access(db, committed.project_id, committed.user_id, "task.write")
        return tasks_service.create(db, access, TaskCreate(title=title))


def test_a_create_waits_for_a_concurrent_create_and_takes_the_next_number(
    committed: Committed,
) -> None:
    """Request A holds the project lock (it is between its lock and its commit). Request B
    must wait for it, then see A's number as taken."""
    with new_session(committed.engine) as first:
        access = project_access(first, committed.project_id, committed.user_id, "task.write")
        projects_repo.lock_for_task_write(first, access.project)

        second = Background(lambda: create_in_new_session(committed, "B")).start()
        wait_until_blocked(committed.engine, second, backend_pid(first))

        created_first = tasks_service.create(first, access, TaskCreate(title="A"))

    created_second: TaskRead = second.join()
    assert (created_first.number, created_first.key) == (1, "RACE-1")
    assert (created_second.number, created_second.key) == (2, "RACE-2")
    # The position was also computed after the lock: B goes after A in the column.
    assert (created_first.position, created_second.position) == (1024.0, 2048.0)


def test_many_simultaneous_creates_get_distinct_consecutive_numbers(committed: Committed) -> None:
    count = 8
    barrier = threading.Barrier(count)

    def create(n: int) -> TaskRead:
        barrier.wait(LOCK_WAIT_TIMEOUT)
        return create_in_new_session(committed, f"Task {n}")

    requests = [Background(functools.partial(create, n)).start() for n in range(count)]
    created: list[TaskRead] = [request.join() for request in requests]

    assert sorted(task.number for task in created) == list(range(1, count + 1))
    assert sorted(task.position for task in created) == [1024.0 * n for n in range(1, count + 1)]
    with new_session(committed.engine) as db:
        next_number = db.scalar(
            select(Project.next_task_number).where(Project.id == committed.project_id)
        )
    assert next_number == count + 1


def test_a_create_waits_for_a_concurrent_archive_and_then_conflicts(committed: Committed) -> None:
    with new_session(committed.engine) as archiver:
        project = archiver.get(Project, committed.project_id)
        assert project is not None
        assert projects_repo.archive(archiver, project)

        creator = Background(lambda: create_in_new_session(committed, "Too late")).start()
        wait_until_blocked(committed.engine, creator, backend_pid(archiver))
        archiver.commit()

    with pytest.raises(Conflict) as exc_info:
        creator.join()
    assert exc_info.value.details == {"reason": "project_archived"}
    with new_session(committed.engine) as db:
        count = db.scalar(
            select(func.count()).select_from(Task).where(Task.project_id == committed.project_id)
        )
    assert count == 0


# --- stale access (same session, no threads) -------------------------------------------


def test_write_rechecks_archived_after_taking_the_lock(db_session: Session) -> None:
    """The access check loaded the project before an archive committed: the write still sees it
    archived, because the lock re-reads the row."""
    team = create_team(db_session)
    project = create_project(db_session, team.workspace)
    task = create_task(db_session, project)
    project_gate = project_access(db_session, project.id, team.owner.id, "task.write")
    task_gate = task_access(db_session, task.id, team.owner.id, "task.write")
    db_session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(archived_at=func.now())
        .execution_options(synchronize_session=False)
    )
    assert project_gate.project.archived_at is None

    attempts: list[Callable[[], object]] = [
        lambda: tasks_service.create(db_session, project_gate, TaskCreate(title="Late")),
        lambda: tasks_service.update(db_session, task_gate, TaskUpdate(title="Late")),
        lambda: tasks_service.move(db_session, task_gate, TaskMoveRequest(status=TaskStatus.DONE)),
    ]
    for attempt in attempts:
        with pytest.raises(Conflict) as exc_info:
            attempt()
        assert exc_info.value.details == {"reason": "project_archived"}


def test_write_on_a_task_deleted_meanwhile_is_not_found(db_session: Session) -> None:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace)
    task = create_task(db_session, project)
    gate = task_access(db_session, task.id, team.owner.id, "task.write")
    delete_gate = task_access(db_session, task.id, team.owner.id, "task.delete")
    db_session.execute(
        delete(Task).where(Task.id == task.id).execution_options(synchronize_session=False)
    )

    attempts: list[Callable[[], object]] = [
        lambda: tasks_service.update(db_session, gate, TaskUpdate(title="Gone")),
        lambda: tasks_service.move(db_session, gate, TaskMoveRequest(status=TaskStatus.DONE)),
        lambda: tasks_service.delete(db_session, delete_gate),
    ]
    for attempt in attempts:
        with pytest.raises(NotFound) as exc_info:
            attempt()
        assert exc_info.value.message == "Task not found"
