"""Helpers for tests that simulate concurrent requests.

Such tests use real, committed data and separate database connections (one per simulated
request), because the per-test rolled-back transaction of the other tests is a single connection
and cannot block itself. Their fixtures delete what they committed.
"""

import threading
import time
from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

LOCK_WAIT_TIMEOUT = 10.0


def new_session(engine: Engine) -> Session:
    """A request's session, configured like app.db.session.get_session_factory()."""
    return Session(engine, autoflush=False, expire_on_commit=False)


class Background:
    """Run a function on another thread and keep its result or exception."""

    def __init__(self, target: Callable[[], Any]) -> None:
        self.result: Any = None
        self.error: BaseException | None = None
        self._target = target
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        try:
            self.result = self._target()
        except BaseException as exc:
            self.error = exc

    def start(self) -> "Background":
        self._thread.start()
        return self

    def join(self) -> Any:
        self._thread.join(LOCK_WAIT_TIMEOUT)
        assert not self._thread.is_alive(), "the background request never finished"
        if self.error is not None:
            raise self.error
        return self.result

    @property
    def running(self) -> bool:
        return self._thread.is_alive()


def server_activity(engine: Engine) -> str:
    """Every other connection to the server, for failure messages."""
    query = text(
        "SELECT pid, datname, state, wait_event_type, pg_blocking_pids(pid) AS blocked_by,"
        " left(query, 100) AS query FROM pg_stat_activity"
        " WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()"
    )
    with engine.connect() as conn:
        return "\n".join(str(tuple(row)) for row in conn.execute(query))


def backend_pid(db: Session) -> int:
    """The Postgres process id of the session's connection (starts its transaction)."""
    pid = db.scalar(select(func.pg_backend_pid()))
    assert isinstance(pid, int)
    return pid


def wait_until_blocked(engine: Engine, waiter: Background, holder_pid: int) -> None:
    """Block until `waiter`'s request is waiting for a lock held by the `holder_pid` connection.

    Fails at once, with the request's own error, if it finished instead of waiting.
    """
    deadline = time.monotonic() + LOCK_WAIT_TIMEOUT
    blocked = text(
        "SELECT count(*) FROM pg_stat_activity WHERE :holder = ANY(pg_blocking_pids(pid))"
    )
    with engine.connect() as conn:
        while time.monotonic() < deadline:
            waiting = conn.scalar(blocked, {"holder": holder_pid})
            # pg_stat_activity is snapshotted once per transaction, so end it: otherwise every
            # poll would repeat the first one's answer.
            conn.rollback()
            if waiting:
                return
            if not waiter.running:
                waiter.join()
                pytest.fail("the concurrent request finished without waiting for the lock")
            time.sleep(0.02)
    pytest.fail(
        "the concurrent request never waited for the lock; connections:\n" + server_activity(engine)
    )
