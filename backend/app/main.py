"""App factory. Run with: uvicorn app.main:app (from backend/)."""

from fastapi import FastAPI

from app.api.routers import (
    activity,
    auth,
    comments,
    health,
    members,
    projects,
    tasks,
    workspaces,
)
from app.core.config import Settings, get_settings
from app.core.csrf import CSRFMiddleware
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.rate_limit import AuthRateLimiter
from app.core.request_context import RequestContextMiddleware
from app.core.security_headers import SecurityHeadersMiddleware
from app.frontend import add_frontend_route

API_PREFIX = "/api"
DOCS_URL = f"{API_PREFIX}/docs"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="TaskBoard API",
        version="0.1.0",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=DOCS_URL,
        redoc_url=None,
        # Cookie auth needs no OAuth2 redirect page, and its default path (/docs/...) lies
        # outside /api, where every path belongs to the frontend.
        swagger_ui_oauth2_redirect_url=None,
    )
    register_exception_handlers(app)
    # One limiter per app, read by app/api/rate_limit.py (docs/api-contract.md section 1.5).
    app.state.auth_rate_limiter = AuthRateLimiter.from_settings(settings)

    # Middleware, outermost first (each add_middleware call wraps the ones before it):
    # 1. security headers on every response, the 500s of (2) included;
    # 2. request id, access log, unhandled errors -> 500 envelope;
    # 3. CSRF check, before routing, validation and auth (docs/api-contract.md section 1.4).
    # No CORS middleware: UI and API share one origin (see app/core/security_headers.py).
    app.add_middleware(CSRFMiddleware, path_prefix=API_PREFIX)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, hsts=settings.hsts_enabled, docs_paths=[DOCS_URL])

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(workspaces.router, prefix=API_PREFIX)
    app.include_router(members.router, prefix=API_PREFIX)
    app.include_router(projects.router, prefix=API_PREFIX)
    app.include_router(tasks.router, prefix=API_PREFIX)
    app.include_router(comments.router, prefix=API_PREFIX)
    app.include_router(activity.router, prefix=API_PREFIX)

    # Last: the built React app and its client-side routes, for every path outside /api.
    add_frontend_route(app, settings.frontend_dist_dir, api_prefix=API_PREFIX)
    return app


app = create_app()
