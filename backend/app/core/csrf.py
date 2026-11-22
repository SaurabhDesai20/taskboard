"""CSRF defense (docs/api-contract.md section 1.4).

Every POST, PUT, PATCH and DELETE under /api must carry `X-Requested-With: taskboard`.
A cross-site form cannot set custom headers, and a cross-site fetch that does triggers a CORS
preflight the API never approves. The check runs as ASGI middleware, so it happens before
routing, validation and authentication.
"""

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import error_response

CSRF_HEADER = "X-Requested-With"
CSRF_HEADER_VALUE = "taskboard"
CSRF_PROTECTED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_ERROR_MESSAGE = "Missing or invalid X-Requested-With header"


class CSRFMiddleware:
    def __init__(self, app: ASGIApp, path_prefix: str = "/api") -> None:
        self.app = app
        self.path_prefix = path_prefix

    def _is_protected(self, scope: Scope) -> bool:
        if scope["type"] != "http" or scope["method"] not in CSRF_PROTECTED_METHODS:
            return False
        path: str = scope["path"]
        return path == self.path_prefix or path.startswith(self.path_prefix + "/")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self._is_protected(scope):
            header = Headers(scope=scope).get(CSRF_HEADER)
            if header != CSRF_HEADER_VALUE:
                response = error_response(403, "forbidden", CSRF_ERROR_MESSAGE, {"reason": "csrf"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
