"""Security headers on every HTTP response: API, errors, the SPA and its static files.

The CSP fits the built Vite app: scripts and styles come from the app's own origin only, with
`'unsafe-inline'` for styles because React and dnd-kit set inline `style` attributes. No
inline scripts are allowed. Swagger UI (`/api/docs`) loads its bundle from a CDN and starts
with an inline script, so those pages, and only those, get a relaxed policy.

Headers a response already sets are left alone. HSTS is sent only when the app is served over
HTTPS (`COOKIE_SECURE=true` or `APP_ENV=production`): on plain http://localhost it would make
the browser insist on HTTPS for that host.

There is no CORS middleware on purpose: the UI and the API share one origin (the Vite dev
server proxies /api), so a cross-origin preflight gets no Access-Control-Allow-* headers and
browsers block cross-origin reads and non-simple requests.
"""

from collections.abc import Collection

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SWAGGER_CDN = "https://cdn.jsdelivr.net"
SWAGGER_FAVICON_HOST = "https://fastapi.tiangolo.com"


def _policy(*directives: str) -> str:
    return "; ".join(directives)


APP_CSP = _policy(
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
)
DOCS_CSP = _policy(
    "default-src 'self'",
    f"script-src 'self' 'unsafe-inline' {SWAGGER_CDN}",
    f"style-src 'self' 'unsafe-inline' {SWAGGER_CDN}",
    f"img-src 'self' data: {SWAGGER_FAVICON_HOST}",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
)
PERMISSIONS_POLICY = ", ".join(
    f"{feature}=()"
    for feature in (
        "accelerometer",
        "camera",
        "geolocation",
        "gyroscope",
        "magnetometer",
        "microphone",
        "payment",
        "usb",
    )
)
HSTS = "max-age=31536000; includeSubDomains"

COMMON_HEADERS: tuple[tuple[str, str], ...] = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "same-origin"),
    ("Permissions-Policy", PERMISSIONS_POLICY),
    ("Cross-Origin-Opener-Policy", "same-origin"),
)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool, docs_paths: Collection[str] = ()) -> None:
        self.app = app
        self.docs_paths = frozenset(docs_paths)
        self.headers = COMMON_HEADERS + ((("Strict-Transport-Security", HSTS),) if hsts else ())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        csp = DOCS_CSP if scope["path"] in self.docs_paths else APP_CSP

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers:
                    headers.setdefault(name, value)
                headers.setdefault("Content-Security-Policy", csp)
            await send(message)

        await self.app(scope, receive, send_with_headers)
