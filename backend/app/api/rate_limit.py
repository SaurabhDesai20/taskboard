"""Dependencies that apply the auth rate limits (app/core/rate_limit.py) to a route.

`create_app()` puts one `AuthRateLimiter` per app in `app.state.auth_rate_limiter`.
On POST /auth/login the checks run in this order:
1. CSRF header (middleware), so requests without it are never counted;
2. `limit_by_ip("login")`: before the body is validated, so invalid requests count too;
3. body validation (422);
4. `login_body`: the per-IP-and-email limit, which needs the validated (normalized) email.
"""

from collections.abc import Callable

from fastapi import Request

from app.core.rate_limit import AuthEndpoint, AuthRateLimiter
from app.schemas.auth import LoginRequest


def auth_rate_limiter(request: Request) -> AuthRateLimiter:
    limiter = request.app.state.auth_rate_limiter
    assert isinstance(limiter, AuthRateLimiter)
    return limiter


def client_ip(request: Request) -> str:
    """The peer address. Behind a reverse proxy, run uvicorn with --proxy-headers (and
    --forwarded-allow-ips) so this is the client's address, not the proxy's."""
    return request.client.host if request.client else "unknown"


def limit_by_ip(endpoint: AuthEndpoint) -> Callable[[Request], None]:
    """429 `rate_limited` when the client IP is over its limit for `endpoint`."""

    def check(request: Request) -> None:
        auth_rate_limiter(request).check_ip(endpoint, client_ip(request))

    return check


def login_body(request: Request, body: LoginRequest) -> LoginRequest:
    """The login body, once the client IP is within its limit for this email (else 429).

    Declaring the body here, and only here, keeps one copy of it in the request schema and
    in validation errors.
    """
    auth_rate_limiter(request).check_login_email(client_ip(request), body.email)
    return body
