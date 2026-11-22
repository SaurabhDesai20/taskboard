"""Shared fixtures: migrated test database, one rolled-back transaction per test, TestClient."""

from collections.abc import Iterator

import pytest
from alembic import command
from argon2 import PasswordHasher, profiles
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

# Must be imported before app.main so settings point at the test database.
from tests.database import (
    TEST_DATABASE_URL,
    alembic_config,
    ensure_database_exists,
    reset_schema,
)

# What frontend/src/api/client.ts sends on every request (docs/api-contract.md 1.4).
CSRF_HEADERS = {"X-Requested-With": "taskboard"}


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Production argon2 parameters cost ~100 ms per hash; tests use the cheapest profile."""
    from app.core import security

    monkeypatch.setattr(
        security, "password_hasher", PasswordHasher.from_parameters(profiles.CHEAPEST)
    )


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    ensure_database_exists(TEST_DATABASE_URL)
    test_engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    reset_schema(test_engine)
    command.upgrade(alembic_config(), "head")
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Iterator[Session]:
    """A session inside an outer transaction that is rolled back after the test.

    Service code may call session.commit(): with create_savepoint it only releases a
    SAVEPOINT, so nothing a test writes survives the test.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=False,
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def app(db_session: Session) -> FastAPI:
    from app.api.deps import get_db
    from app.main import create_app

    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session
    return application


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """Sends the CSRF header on every request, like the real UI client.

    To test a request without it: `del client.headers["X-Requested-With"]`.
    """
    with TestClient(app, headers=CSRF_HEADERS) as test_client:
        yield test_client
