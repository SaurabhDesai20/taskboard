"""App factory. Run with: uvicorn app.main:app (from backend/)."""

from fastapi import FastAPI

from app.api.routers import auth, health
from app.core.config import Settings, get_settings
from app.core.csrf import CSRFMiddleware
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="TaskBoard API",
        version="0.1.0",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
    )
    register_exception_handlers(app)
    # Runs before routing, validation and auth (docs/api-contract.md section 1.4).
    app.add_middleware(CSRFMiddleware, path_prefix=API_PREFIX)

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)

    # Phase 7: serve frontend/dist with StaticFiles plus an SPA fallback that excludes /api.
    return app


app = create_app()
