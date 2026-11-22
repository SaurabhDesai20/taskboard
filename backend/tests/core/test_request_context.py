"""X-Request-ID on every response, the request id on every log record, one access line per
request, and unhandled errors as logged 500 envelopes."""

import io
import logging
import re
from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.logging import (
    LOG_FORMAT,
    RequestIdFilter,
    _AppLogHandler,
    configure_logging,
    request_id_var,
)
from app.core.request_context import REQUEST_ID_PATTERN
from tests.conftest import CSRF_HEADERS

GENERATED_ID = re.compile(r"^[0-9a-f]{32}$")
test_logger = logging.getLogger("tests.request_context")


@pytest.fixture
def context_client(app_with: Callable[..., FastAPI]) -> Iterator[TestClient]:
    app = app_with()

    @app.get("/api/_test/log")
    def log_something() -> dict[str, str]:
        test_logger.info("inside the endpoint")
        return {"ok": "yes"}

    @app.get("/api/_test/async-log")
    async def log_something_async() -> dict[str, str]:
        test_logger.info("inside the async endpoint")
        return {"ok": "yes"}

    @app.get("/api/_test/boom")
    def boom() -> None:
        raise RuntimeError("unexpected")

    # The default raise_server_exceptions=True: the middleware answers unhandled errors itself.
    with TestClient(app, headers=CSRF_HEADERS) as client:
        yield client


@pytest.fixture
def logs(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    """caplog at INFO, with the request id added to records the way the app's handler adds it.
    (pytest reuses its capture handler, so the filter comes off again afterwards.)"""
    caplog.set_level(logging.INFO)
    request_id_filter = RequestIdFilter()
    caplog.handler.addFilter(request_id_filter)
    yield caplog
    caplog.handler.removeFilter(request_id_filter)


def test_response_gets_a_generated_request_id(context_client: TestClient) -> None:
    first = context_client.get("/api/health")
    second = context_client.get("/api/health")

    assert GENERATED_ID.fullmatch(first.headers["x-request-id"])
    assert GENERATED_ID.fullmatch(second.headers["x-request-id"])
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


@pytest.mark.parametrize(
    "incoming",
    ["abc123", "3f2b8c1e-7a6d-4e2f-9b1a-0c5d4e3f2a1b", "trace.span:42_x-y", "a" * 128],
)
def test_sane_incoming_request_id_is_kept(context_client: TestClient, incoming: str) -> None:
    response = context_client.get("/api/health", headers={"X-Request-ID": incoming})

    assert response.headers["x-request-id"] == incoming


@pytest.mark.parametrize(
    "incoming",
    ["", "a" * 129, "has space", 'quote"', "back\\slash", "semi;colon", "slash/path", "<b>"],
)
def test_other_incoming_request_ids_are_replaced(context_client: TestClient, incoming: str) -> None:
    response = context_client.get("/api/health", headers={"X-Request-ID": incoming})

    request_id = response.headers["x-request-id"]
    assert request_id != incoming
    assert GENERATED_ID.fullmatch(request_id)


def test_request_id_pattern() -> None:
    assert REQUEST_ID_PATTERN.fullmatch("A-z_0.9:")
    assert not REQUEST_ID_PATTERN.fullmatch("a\n")


@pytest.mark.parametrize(
    ("method", "path", "headers", "status"),
    [
        ("GET", "/api/does-not-exist", {}, 404),
        ("POST", "/api/health", {}, 405),
        ("GET", "/api/auth/me", {}, 401),
        ("POST", "/api/auth/logout", {"X-Requested-With": "nope"}, 403),
        ("POST", "/api/auth/login", {}, 422),
        ("GET", "/api/_test/boom", {}, 500),
    ],
)
def test_error_responses_carry_the_request_id(
    context_client: TestClient, method: str, path: str, headers: dict[str, str], status: int
) -> None:
    response = context_client.request(
        method, path, headers={"X-Request-ID": "req-1", **headers}, json={}
    )

    assert response.status_code == status
    assert response.json()["error"]["code"]
    assert response.headers["x-request-id"] == "req-1"


def test_unhandled_error_is_a_500_envelope_logged_with_the_request_id(
    context_client: TestClient, logs: pytest.LogCaptureFixture
) -> None:
    response = context_client.get("/api/_test/boom", headers={"X-Request-ID": "boom-1"})

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error", "details": {}}
    }
    [error] = [r for r in logs.records if r.levelno == logging.ERROR]
    assert error.getMessage() == "Unhandled error in GET /api/_test/boom"
    assert error.request_id == "boom-1"  # type: ignore[attr-defined]
    assert error.exc_info is not None
    assert isinstance(error.exc_info[1], RuntimeError)


@pytest.mark.parametrize("path", ["/api/_test/log", "/api/_test/async-log"])
def test_records_logged_during_a_request_carry_its_id(
    context_client: TestClient, logs: pytest.LogCaptureFixture, path: str
) -> None:
    response = context_client.get(path)

    request_id = response.headers["x-request-id"]
    [inside] = [r for r in logs.records if r.name == test_logger.name]
    assert inside.request_id == request_id  # type: ignore[attr-defined]


def test_one_access_line_per_request(
    context_client: TestClient, logs: pytest.LogCaptureFixture
) -> None:
    context_client.get("/api/health", headers={"X-Request-ID": "ok-1"})
    context_client.get("/api/does-not-exist", headers={"X-Request-ID": "missing-1"})
    context_client.get("/api/_test/boom", headers={"X-Request-ID": "boom-1"})

    access = [r for r in logs.records if r.name == "app.access"]
    assert [r.request_id for r in access] == ["ok-1", "missing-1", "boom-1"]  # type: ignore[attr-defined]
    lines = [r.getMessage() for r in access]
    assert re.fullmatch(r"GET /api/health 200 \d+\.\dms", lines[0])
    assert re.fullmatch(r"GET /api/does-not-exist 404 \d+\.\dms", lines[1])
    assert re.fullmatch(r"GET /api/_test/boom 500 \d+\.\dms", lines[2])
    assert all(r.levelno == logging.INFO for r in access)


def test_request_id_is_cleared_after_the_request(context_client: TestClient) -> None:
    context_client.get("/api/health")

    assert request_id_var.get() is None


def test_request_id_is_available_on_request_state(app_with: Callable[..., FastAPI]) -> None:
    from fastapi import Request

    app = app_with()

    @app.get("/api/_test/state")
    def state(request: Request) -> dict[str, str]:
        return {"request_id": request.state.request_id}

    with TestClient(app) as client:
        response = client.get("/api/_test/state", headers={"X-Request-ID": "state-1"})

    assert response.json() == {"request_id": "state-1"}


def test_filter_uses_a_dash_outside_requests_and_keeps_existing_ids() -> None:
    outside = logging.LogRecord("x", logging.INFO, __file__, 1, "message", None, None)
    preset = logging.LogRecord("x", logging.INFO, __file__, 1, "message", None, None)
    preset.request_id = "preset"
    token = request_id_var.set("current")
    try:
        RequestIdFilter().filter(preset)
    finally:
        request_id_var.reset(token)
    RequestIdFilter().filter(outside)

    assert outside.request_id == "-"  # type: ignore[attr-defined]
    assert preset.request_id == "preset"  # type: ignore[attr-defined]


def test_log_format_shows_the_request_id() -> None:
    record = logging.LogRecord("app.access", logging.INFO, __file__, 1, "GET / 200", None, None)
    token = request_id_var.set("abc123")
    try:
        RequestIdFilter().filter(record)
    finally:
        request_id_var.reset(token)

    line = logging.Formatter(LOG_FORMAT).format(record)

    assert line.endswith("INFO [app.access] request_id=abc123 GET / 200")


def test_configure_logging_installs_one_handler_and_silences_uvicorn_access() -> None:
    configure_logging("INFO")
    configure_logging("INFO")

    root = logging.getLogger()
    [handler] = [h for h in root.handlers if isinstance(h, _AppLogHandler)]
    assert logging.getLogger("uvicorn.access").level == logging.WARNING

    stream = io.StringIO()
    original = handler.setStream(stream)
    assert original is not None
    try:
        token = request_id_var.set("fmt-1")
        try:
            logging.getLogger("tests.format").warning("hello")
        finally:
            request_id_var.reset(token)
    finally:
        handler.setStream(original)
    assert stream.getvalue().rstrip().endswith("WARNING [tests.format] request_id=fmt-1 hello")
