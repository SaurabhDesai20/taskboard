"""Security headers on every response, a relaxed CSP for Swagger UI only, HSTS only over HTTPS,
and no CORS."""

import re
from collections.abc import Callable, Iterator

import httpx2
import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from app.core.security_headers import APP_CSP, DOCS_CSP, HSTS, PERMISSIONS_POLICY
from tests.conftest import CSRF_HEADERS

EXPECTED = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy": PERMISSIONS_POLICY,
    "cross-origin-opener-policy": "same-origin",
}


@pytest.fixture
def headers_client(app_with: Callable[..., FastAPI]) -> Iterator[TestClient]:
    app = app_with()

    @app.get("/api/_test/boom")
    def boom() -> None:
        raise RuntimeError("unexpected")

    @app.get("/api/_test/own-csp")
    def own_csp(response: Response) -> dict[str, str]:
        response.headers["Content-Security-Policy"] = "default-src 'none'"
        return {}

    with TestClient(app, headers=CSRF_HEADERS) as client:
        yield client


def directives(csp: str) -> dict[str, list[str]]:
    parsed = {}
    for directive in csp.split(";"):
        name, *values = directive.split()
        parsed[name] = values
    return parsed


def assert_security_headers(response: httpx2.Response, csp: str = APP_CSP) -> None:
    for name, value in EXPECTED.items():
        assert response.headers[name] == value, name
    assert response.headers["content-security-policy"] == csp
    assert "strict-transport-security" not in response.headers


@pytest.mark.parametrize(
    ("method", "path", "headers", "status"),
    [
        ("GET", "/api/health", {}, 200),
        ("GET", "/api/openapi.json", {}, 200),
        ("GET", "/api/auth/me", {}, 401),
        ("GET", "/api/does-not-exist", {}, 404),
        ("POST", "/api/health", {}, 405),
        ("POST", "/api/auth/logout", {"X-Requested-With": "nope"}, 403),
        ("POST", "/api/auth/login", {}, 422),
        ("GET", "/api/_test/boom", {}, 500),
    ],
)
def test_every_response_has_the_security_headers(
    headers_client: TestClient, method: str, path: str, headers: dict[str, str], status: int
) -> None:
    response = headers_client.request(method, path, headers=headers, json={})

    assert response.status_code == status
    assert_security_headers(response)


def test_app_csp_fits_the_vite_build() -> None:
    policy = directives(APP_CSP)

    assert policy["default-src"] == ["'self'"]
    # No inline or remote scripts; inline styles are needed for React/dnd-kit style attributes.
    assert policy["script-src"] == ["'self'"]
    assert policy["style-src"] == ["'self'", "'unsafe-inline'"]
    assert policy["connect-src"] == ["'self'"]
    assert policy["frame-ancestors"] == ["'none'"]
    assert policy["object-src"] == ["'none'"]


def test_headers_a_response_sets_itself_are_kept(headers_client: TestClient) -> None:
    response = headers_client.get("/api/_test/own-csp")

    assert response.headers["content-security-policy"] == "default-src 'none'"
    assert response.headers["x-frame-options"] == "DENY"


def test_swagger_ui_gets_the_docs_csp(headers_client: TestClient) -> None:
    response = headers_client.get("/api/docs")

    assert response.status_code == 200
    assert_security_headers(response, csp=DOCS_CSP)


def test_docs_csp_allows_everything_swagger_ui_loads(headers_client: TestClient) -> None:
    html = headers_client.get("/api/docs").text
    policy = directives(DOCS_CSP)

    scripts = re.findall(r'<script src="([^"]+)"', html)
    styles = re.findall(r'<link type="text/css" rel="stylesheet" href="([^"]+)"', html)
    icons = re.findall(r'<link rel="shortcut icon" href="([^"]+)"', html)
    assert scripts and styles and icons
    for urls, directive in ((scripts, "script-src"), (styles, "style-src"), (icons, "img-src")):
        for url in urls:
            assert any(url.startswith(source) for source in policy[directive]), (directive, url)
    # Swagger UI starts with an inline script.
    assert "<script>" in html
    assert "'unsafe-inline'" in policy["script-src"]
    assert policy["frame-ancestors"] == ["'none'"]


def test_only_the_docs_pages_get_the_relaxed_csp(headers_client: TestClient) -> None:
    for path in ("/api/openapi.json", "/api/docsx", "/docs"):
        assert headers_client.get(path).headers["content-security-policy"] == APP_CSP


@pytest.mark.parametrize(
    "overrides",
    [{"cookie_secure": True}, {"app_env": "production"}],
    ids=["cookie_secure", "production"],
)
def test_hsts_is_sent_over_https_only(
    app_with: Callable[..., FastAPI], overrides: dict[str, object]
) -> None:
    with TestClient(app_with(**overrides), headers=CSRF_HEADERS) as client:
        ok = client.get("/api/health")
        error = client.get("/api/does-not-exist")

    assert ok.headers["strict-transport-security"] == HSTS
    assert error.headers["strict-transport-security"] == HSTS


def test_no_hsts_in_development(app_with: Callable[..., FastAPI]) -> None:
    app = app_with(app_env="development", cookie_secure=False)
    with TestClient(app) as client:
        assert "strict-transport-security" not in client.get("/api/health").headers


# --- CORS: none (same-origin app) ---------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/auth/login", "/api/workspaces", "/api/health"])
def test_cross_origin_preflight_is_not_approved(headers_client: TestClient, path: str) -> None:
    response = headers_client.options(
        path,
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-requested-with",
        },
    )

    assert response.status_code >= 400
    assert not [name for name in response.headers if name.startswith("access-control-")]


def test_cross_origin_request_gets_no_cors_headers(headers_client: TestClient) -> None:
    response = headers_client.get("/api/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers
