"""Per-request id, access log and the last line of defence for unhandled errors.

For every HTTP request this ASGI middleware:
- takes the client's `X-Request-ID` when it is sane (REQUEST_ID_PATTERN), else generates one;
- makes it the current request id for logging (app/core/logging.py) and `request.state`;
- returns it as `X-Request-ID` on the response, errors included;
- writes one access line: method, path, status, duration in ms (the id is on the line);
- turns an unhandled exception into the contract's 500 envelope, after logging it with its
  traceback and the request id.

Starlette's own 500 handler runs outside all user middleware, so its responses would miss
this header and the security headers. Catching here, inside the security-headers middleware,
gives every response both. The exception is not re-raised once the 500 has been sent: it is
already logged, and the server would only log it again without the request id.
"""

import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import error_response
from app.core.logging import request_id_var

REQUEST_ID_HEADER = "X-Request-ID"
# Accepted from clients and proxies as is: UUIDs, hex and similar tokens. Anything else (too
# long, spaces, quotes, control characters) is replaced, so it cannot forge log lines.
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

access_logger = logging.getLogger("app.access")
logger = logging.getLogger(__name__)


def new_request_id() -> str:
    return uuid.uuid4().hex


def request_id_from(headers: Headers) -> str:
    """The client's request id if it is sane, else a new one."""
    incoming = headers.get(REQUEST_ID_HEADER)
    if incoming is not None and REQUEST_ID_PATTERN.fullmatch(incoming):
        return incoming
    return new_request_id()


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = request_id_from(Headers(scope=scope))
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)
        started_at = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            logger.exception("Unhandled error in %s %s", scope["method"], scope["path"])
            if response_started:
                # Too late for an error response: let the server close the connection.
                raise
            response = error_response(500, "internal_error", "Internal server error")
            await response(scope, receive, send_with_request_id)
        finally:
            duration_ms = (time.perf_counter() - started_at) * 1000
            access_logger.info(
                "%s %s %s %.1fms", scope["method"], scope["path"], status_code, duration_ms
            )
            request_id_var.reset(token)
