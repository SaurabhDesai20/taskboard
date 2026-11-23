"""Serve the built React app (`frontend/dist`) from the API process (PLAN.md section 1).

For GET and HEAD requests outside /api:
- a file that exists in dist is served as is: `/assets/*` (Vite's content-hashed bundles, cached
  for a year) and root files such as `/favicon.ico`;
- any other path gets `index.html` (`Cache-Control: no-cache`), so the client-side router
  handles deep links like `/w/acme/projects/<id>` on refresh;
- a missing `/assets/*` file is a 404 (a JS or CSS request must not get HTML back);
- without a build (no `index.html`), a 503 envelope that says how to build one.

/api paths never reach this route: unknown ones keep the JSON 404 envelope and wrong methods
the 405. Other methods outside /api get a 404. The dist directory is read per request, so
building while the server runs just works.
"""

import os
from pathlib import Path

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.routing import Match, Route
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.core.errors import ServiceUnavailable

INDEX_FILE = "index.html"
ASSETS_PATH = "/assets/"
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"
FRONTEND_NOT_BUILT_MESSAGE = (
    "The frontend is not built. Run scripts\\build.ps1, or use the Vite dev server "
    "(scripts\\frontend.ps1) on http://localhost:5173"
)


def is_api_path(path: str, api_prefix: str) -> bool:
    return path == api_prefix or path.startswith(api_prefix + "/")


class _DistFiles(StaticFiles):
    """StaticFiles over dist: safe path lookup, ETag/304 and HEAD, plus cache headers."""

    async def check_config(self) -> None:
        """Skip StaticFiles' first-request check, which raises when dist does not exist yet;
        a missing build is answered per request instead."""

    def file_response(
        self,
        full_path: str | os.PathLike[str],
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        path: str = scope["path"]
        response.headers["Cache-Control"] = IMMUTABLE if path.startswith(ASSETS_PATH) else NO_CACHE
        return response


class _FrontendRoute(Route):
    """`/{path:path}` for GET and HEAD outside /api only.

    Anything else does not match at all, so the router still answers it as before: a 404 for
    an unknown path, a 405 for a known /api path with the wrong method. (A plain GET catch-all
    would turn every other unknown request into a 405.)
    """

    def __init__(self, dist_dir: Path, *, api_prefix: str) -> None:
        self.dist_dir = dist_dir
        self.api_prefix = api_prefix
        self.files = _DistFiles(directory=dist_dir, check_dir=False)
        super().__init__(
            "/{path:path}", self.serve, methods=["GET", "HEAD"], include_in_schema=False
        )

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        if (
            scope["type"] == "http"
            and scope["method"] in ("GET", "HEAD")
            and not is_api_path(scope["path"], self.api_prefix)
        ):
            return super().matches(scope)
        return Match.NONE, {}

    async def serve(self, request: Request) -> Response:
        try:
            return await self.files.get_response(self.files.get_path(request.scope), request.scope)
        except HTTPException as exc:
            if exc.status_code != 404 or request.url.path.startswith(ASSETS_PATH):
                raise
        if not (self.dist_dir / INDEX_FILE).is_file():
            raise ServiceUnavailable(FRONTEND_NOT_BUILT_MESSAGE)
        return await self.files.get_response(INDEX_FILE, request.scope)


def add_frontend_route(app: FastAPI, dist_dir: Path, *, api_prefix: str) -> None:
    """Register the frontend catch-all. Call it last, after every API route."""
    app.router.routes.append(_FrontendRoute(dist_dir, api_prefix=api_prefix))
