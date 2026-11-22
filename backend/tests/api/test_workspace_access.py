"""Who can call each workspace-scoped endpoint (contract sections 1.10, 3.3 and 3.4).

Every `/workspaces/{wid}/...` endpoint, for every role: allowed or 403 `insufficient_role`.
Non-members and unknown ids get 404 on every one of them, before any role or body check.
"""

import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.factories import Team, create_team, create_user, log_in

WORKSPACE = "/api/workspaces/{wid}"
MEMBERS = "/api/workspaces/{wid}/members"
MEMBER = "/api/workspaces/{wid}/members/{uid}"
NEWCOMER_EMAIL = "newcomer@example.com"

# The contract's "Min role" column, written out as role sets.
EVERYONE = frozenset(Role)
ADMINS_AND_OWNERS = frozenset({Role.OWNER, Role.ADMIN})
OWNERS = frozenset({Role.OWNER})


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    allowed: frozenset[Role]
    success: int
    body: dict[str, Any] | None = None
    invalid_body: dict[str, Any] | None = None


# PATCH/DELETE on a member target `team.other_member`, a plain member who is not the caller.
ENDPOINTS = {
    "get_workspace": Endpoint("GET", WORKSPACE, EVERYONE, 200),
    "update_workspace": Endpoint(
        "PATCH", WORKSPACE, OWNERS, 200, {"name": "Renamed"}, invalid_body={"name": ""}
    ),
    "delete_workspace": Endpoint("DELETE", WORKSPACE, OWNERS, 204),
    "list_members": Endpoint("GET", MEMBERS, EVERYONE, 200),
    "add_member": Endpoint(
        "POST",
        MEMBERS,
        ADMINS_AND_OWNERS,
        201,
        {"email": NEWCOMER_EMAIL, "role": "viewer"},
        invalid_body={"email": "not-an-email", "role": "boss"},
    ),
    "change_member_role": Endpoint(
        "PATCH", MEMBER, ADMINS_AND_OWNERS, 200, {"role": "viewer"}, invalid_body={"role": "boss"}
    ),
    "remove_member": Endpoint("DELETE", MEMBER, ADMINS_AND_OWNERS, 204),
}
WITH_BODY = [name for name, endpoint in ENDPOINTS.items() if endpoint.invalid_body is not None]
RESTRICTED_WITH_BODY = [name for name in WITH_BODY if ENDPOINTS[name].allowed != EVERYONE]
MEMBER_TARGETED = [name for name, endpoint in ENDPOINTS.items() if "{uid}" in endpoint.path]

WORKSPACE_NOT_FOUND = {
    "error": {"code": "not_found", "message": "Workspace not found", "details": {}}
}


@pytest.fixture
def team(db_session: Session) -> Team:
    team = create_team(db_session)
    create_user(db_session, email=NEWCOMER_EMAIL)
    return team


def call(
    client: TestClient,
    name: str,
    team: Team,
    *,
    wid: UUID | str | None = None,
    uid: UUID | str | None = None,
    invalid: bool = False,
) -> httpx2.Response:
    endpoint = ENDPOINTS[name]
    path = endpoint.path.format(wid=wid or team.workspace.id, uid=uid or team.other_member.id)
    body = endpoint.invalid_body if invalid else endpoint.body
    return client.request(endpoint.method, path, json=body)


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("name", ENDPOINTS)
def test_each_role_is_allowed_or_forbidden(
    client: TestClient, team: Team, name: str, role: Role
) -> None:
    log_in(client, team.users[role])

    response = call(client, name, team)

    if role in ENDPOINTS[name].allowed:
        assert response.status_code == ENDPOINTS[name].success, response.text
    else:
        assert_error(response, 403, "forbidden", reason="insufficient_role")


@pytest.mark.parametrize("name", ENDPOINTS)
def test_non_member_gets_not_found(client: TestClient, team: Team, name: str) -> None:
    log_in(client, team.outsider)

    response = call(client, name, team)

    assert response.status_code == 404
    assert response.json() == WORKSPACE_NOT_FOUND


@pytest.mark.parametrize("name", ENDPOINTS)
def test_unknown_workspace_gets_not_found(client: TestClient, team: Team, name: str) -> None:
    log_in(client, team.owner)

    response = call(client, name, team, wid=uuid.uuid4())

    assert response.status_code == 404
    assert response.json() == WORKSPACE_NOT_FOUND


@pytest.mark.parametrize("name", WITH_BODY)
def test_not_found_comes_before_body_validation(client: TestClient, team: Team, name: str) -> None:
    log_in(client, team.outsider)

    response = call(client, name, team, invalid=True)

    assert response.status_code == 404
    assert response.json() == WORKSPACE_NOT_FOUND


@pytest.mark.parametrize("name", RESTRICTED_WITH_BODY)
def test_forbidden_comes_before_body_validation(client: TestClient, team: Team, name: str) -> None:
    log_in(client, team.users[Role.VIEWER])

    response = call(client, name, team, invalid=True)

    assert_error(response, 403, "forbidden", reason="insufficient_role")


@pytest.mark.parametrize("name", ENDPOINTS)
def test_malformed_workspace_id_is_a_validation_error(
    client: TestClient, team: Team, name: str
) -> None:
    log_in(client, team.owner)

    response = call(client, name, team, wid="not-a-uuid")

    assert validation_fields(response) == {("wid", "path")}


@pytest.mark.parametrize("name", MEMBER_TARGETED)
def test_unknown_or_non_member_user_gets_member_not_found(
    client: TestClient, team: Team, name: str
) -> None:
    log_in(client, team.owner)

    for uid in (uuid.uuid4(), team.outsider.id):
        response = call(client, name, team, uid=uid)

        assert_error(response, 404, "not_found", message="Member not found")


@pytest.mark.parametrize("name", MEMBER_TARGETED)
def test_malformed_user_id_is_a_validation_error(client: TestClient, team: Team, name: str) -> None:
    log_in(client, team.owner)

    response = call(client, name, team, uid="not-a-uuid")

    assert validation_fields(response) == {("uid", "path")}


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/api/workspaces"), ("POST", "/api/workspaces")]
    + [(endpoint.method, endpoint.path) for endpoint in ENDPOINTS.values()],
)
def test_every_endpoint_requires_a_session(
    client: TestClient, team: Team, method: str, path: str
) -> None:
    url = path.format(wid=team.workspace.id, uid=team.other_member.id)

    response = client.request(method, url, json={"name": "Acme"} if method == "POST" else None)

    assert_error(response, 401, "unauthorized", message="Authentication required")


@pytest.mark.parametrize("name", [name for name in ENDPOINTS if ENDPOINTS[name].method != "GET"])
def test_mutations_require_the_csrf_header(client: TestClient, team: Team, name: str) -> None:
    log_in(client, team.owner)
    del client.headers["X-Requested-With"]

    response = call(client, name, team)

    assert_error(response, 403, "forbidden", reason="csrf")
