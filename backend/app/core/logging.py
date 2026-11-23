"""Logging setup: one format for the whole app, with the request id on every line.

`app/core/request_context.py` sets `request_id_var` for the duration of each HTTP request.
`RequestIdFilter` copies it onto every record the app's handler emits (`-` outside a request),
so a request's access line, its warnings and an unhandled error's traceback share one id.
Sync endpoints run in a worker thread with a copy of the request's context, so their records
carry the id too.
"""

import logging
from contextvars import ContextVar

LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] request_id=%(request_id)s %(message)s"
NO_REQUEST_ID = "-"

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def current_request_id() -> str | None:
    """The id of the request being handled, or None outside a request."""
    return request_id_var.get()


class RequestIdFilter(logging.Filter):
    """Adds `record.request_id` (the current request's id, or `-`) unless a record has one."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = current_request_id() or NO_REQUEST_ID
        return True


class _AppLogHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """The root handler configure_logging installs (a class of its own, so it is added once)."""


def configure_logging(level: str) -> None:
    """Log to stderr in LOG_FORMAT at `level`. Safe to call more than once."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    if not any(isinstance(handler, _AppLogHandler) for handler in root.handlers):
        handler = _AppLogHandler()
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        handler.addFilter(RequestIdFilter())
        root.addHandler(handler)
    # The app writes its own access line per request (with the request id and duration), so
    # uvicorn's would only duplicate it. Its startup and error messages still show.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
