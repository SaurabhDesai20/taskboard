"""The built React app served from the API process, with an SPA fallback outside /api."""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security_headers import APP_CSP
from app.frontend import FRONTEND_NOT_BUILT_MESSAGE, IMMUTABLE, NO_CACHE
from tests.api.helpers import assert_error
from tests.conftest import CSRF_HEADERS

INDEX_HTML = '<!doctype html><div id="root"></div><script type="module" src="/assets/app-1a2b.js">'
APP_JS = "console.log('taskboard')"
SECRET = "outside dist"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (dist / "assets" / "app-1a2b.js").write_text(APP_JS, encoding="utf-8")
    (dist / "favicon.ico").write_bytes(b"\x00\x00\x01\x00")
    (tmp_path / "secret.txt").write_text(SECRET, encoding="utf-8")
    return dist


@pytest.fixture
def frontend_client(app_with: Callable[..., FastAPI], dist: Path) -> Iterator[TestClient]:
    with TestClient(app_with(frontend_dist_dir=dist), headers=CSRF_HEADERS) as client:
        yield client


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/login",
        "/w/acme",
        "/w/acme/projects/30000000-0000-4000-8000-000000000001",
        "/w/acme/settings?tab=members",
        "/apix",
        "/docs/oauth2-redirect",
    ],
)
def test_client_side_routes_get_index_html(frontend_client: TestClient, path: str) -> None:
    response = frontend_client.get(path)

    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == NO_CACHE
    assert response.headers["content-security-policy"] == APP_CSP
    assert response.headers["x-request-id"]


def test_assets_are_served_and_cached_for_good(frontend_client: TestClient) -> None:
    response = frontend_client.get("/assets/app-1a2b.js")

    assert response.status_code == 200
    assert response.text == APP_JS
    assert "javascript" in response.headers["content-type"]
    assert response.headers["cache-control"] == IMMUTABLE
    assert response.headers["x-content-type-options"] == "nosniff"


def test_unchanged_asset_gets_304(frontend_client: TestClient) -> None:
    etag = frontend_client.get("/assets/app-1a2b.js").headers["etag"]

    response = frontend_client.get("/assets/app-1a2b.js", headers={"If-None-Match": etag})

    assert response.status_code == 304


def test_missing_asset_is_a_404_not_index_html(frontend_client: TestClient) -> None:
    response = frontend_client.get("/assets/missing-9z.js")

    assert_error(response, 404, "not_found")


def test_root_files_are_served_as_they_are(frontend_client: TestClient) -> None:
    response = frontend_client.get("/favicon.ico")

    assert response.status_code == 200
    assert response.content == b"\x00\x00\x01\x00"
    assert response.headers["cache-control"] == NO_CACHE


def test_head_request(frontend_client: TestClient) -> None:
    response = frontend_client.head("/w/acme")

    assert response.status_code == 200
    assert response.content == b""
    assert int(response.headers["content-length"]) == len(INDEX_HTML)


@pytest.mark.parametrize("path", ["/..%2Fsecret.txt", "/assets/..%2F..%2Fsecret.txt"])
def test_paths_cannot_escape_dist(frontend_client: TestClient, path: str) -> None:
    response = frontend_client.get(path)

    assert SECRET not in response.text


@pytest.mark.parametrize("path", ["/api", "/api/", "/api/does-not-exist", "/api/w/acme"])
def test_unknown_api_paths_keep_the_json_404(frontend_client: TestClient, path: str) -> None:
    response = frontend_client.get(path)

    assert_error(response, 404, "not_found")
    assert response.headers["content-type"] == "application/json"


def test_api_routes_still_win(frontend_client: TestClient) -> None:
    assert frontend_client.get("/api/health").json() == {"status": "ok", "database": "ok"}
    assert frontend_client.get("/api/openapi.json").json()["info"]["title"] == "TaskBoard API"
    assert "swagger-ui" in frontend_client.get("/api/docs").text


def test_wrong_method_on_an_api_path_is_still_a_405(frontend_client: TestClient) -> None:
    assert_error(frontend_client.post("/api/health"), 405, "method_not_allowed")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_other_methods_outside_api_are_a_404(frontend_client: TestClient, method: str) -> None:
    assert_error(frontend_client.request(method, "/w/acme"), 404, "not_found")


def test_frontend_routes_are_not_in_the_openapi_schema(frontend_client: TestClient) -> None:
    paths = frontend_client.get("/api/openapi.json").json()["paths"]

    assert all(path.startswith("/api/") for path in paths)


# --- without a build ----------------------------------------------------------------------


@pytest.fixture
def unbuilt_client(app_with: Callable[..., FastAPI], tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(app_with(frontend_dist_dir=tmp_path / "dist"), headers=CSRF_HEADERS) as c:
        yield c


@pytest.mark.parametrize("path", ["/", "/w/acme/projects/1"])
def test_without_a_build_pages_explain_how_to_build(unbuilt_client: TestClient, path: str) -> None:
    response = unbuilt_client.get(path)

    assert_error(response, 503, "service_unavailable", message=FRONTEND_NOT_BUILT_MESSAGE)
    assert response.headers["x-request-id"]


def test_without_a_build_assets_are_a_404(unbuilt_client: TestClient) -> None:
    assert_error(unbuilt_client.get("/assets/app-1a2b.js"), 404, "not_found")


def test_without_a_build_the_api_still_works(unbuilt_client: TestClient) -> None:
    assert unbuilt_client.get("/api/health").status_code == 200
    assert_error(unbuilt_client.get("/api/nope"), 404, "not_found")


def test_a_build_made_while_running_is_picked_up(
    app_with: Callable[..., FastAPI], tmp_path: Path
) -> None:
    dist = tmp_path / "later"
    with TestClient(app_with(frontend_dist_dir=dist)) as client:
        assert client.get("/").status_code == 503

        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text(INDEX_HTML, encoding="utf-8")
        (dist / "assets" / "app-1a2b.js").write_text(APP_JS, encoding="utf-8")

        assert client.get("/w/acme").text == INDEX_HTML
        assert client.get("/assets/app-1a2b.js").text == APP_JS
