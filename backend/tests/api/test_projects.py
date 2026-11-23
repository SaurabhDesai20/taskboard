"""Project CRUD and archive (contract sections 1.8 and 3.5).

Role gates and 404s: test_project_access.py. Cross-workspace isolation: test_project_isolation.py.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.factories import Team, create_project, create_team, log_in

PROJECT_FIELDS = {
    "id",
    "workspace_id",
    "name",
    "key",
    "description",
    "archived_at",
    "created_by",
    "created_at",
}
ARCHIVED_AT = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


def projects_url(team: Team) -> str:
    return f"/api/workspaces/{team.workspace.id}/projects"


def project_url(project_id: UUID | str) -> str:
    return f"/api/projects/{project_id}"


def act_as(client: TestClient, team: Team, role: Role) -> None:
    log_in(client, team.users[role])


def create(client: TestClient, team: Team, **body: Any) -> dict[str, Any]:
    response = client.post(projects_url(team), json=body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def listed(client: TestClient, team: Team, **params: Any) -> list[dict[str, Any]]:
    response = client.get(projects_url(team), params=params)
    assert response.status_code == 200, response.text
    projects: list[dict[str, Any]] = response.json()
    return projects


# --- create -----------------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.OWNER, Role.ADMIN])
def test_create_returns_the_new_project(client: TestClient, team: Team, role: Role) -> None:
    act_as(client, team, role)

    response = client.post(
        projects_url(team),
        json={"name": "Website", "key": "WEB", "description": "Marketing site and signup flow"},
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == PROJECT_FIELDS
    assert UUID(body["id"]).version == 4
    assert body["workspace_id"] == str(team.workspace.id)
    assert body["name"] == "Website"
    assert body["key"] == "WEB"
    assert body["description"] == "Marketing site and signup flow"
    assert body["archived_at"] is None
    assert body["created_by"] == str(team.users[role].id)
    assert body["created_at"].endswith("Z")
    assert client.get(project_url(body["id"])).json() == body
    assert listed(client, team) == [body]


@pytest.mark.parametrize("body", [{}, {"description": None}])
def test_create_without_description_stores_null(
    client: TestClient, team: Team, body: dict[str, Any]
) -> None:
    act_as(client, team, Role.OWNER)

    created = create(client, team, name="Website", key="WEB", **body)

    assert created["description"] is None


def test_create_trims_strings(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    created = create(client, team, name="  Website  ", key="  WEB ", description="  Site  ")

    assert (created["name"], created["key"], created["description"]) == ("Website", "WEB", "Site")


def test_blank_description_is_kept_as_an_empty_string(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    created = create(client, team, name="Website", key="WEB", description="   ")

    assert created["description"] == ""


def test_create_accepts_boundary_values(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    short = create(client, team, name="n", key="AB", description="")
    long = create(client, team, name="n" * 100, key="A" + "9" * 9, description="d" * 2000)

    assert short["key"] == "AB"
    assert (long["name"], long["key"], long["description"]) == ("n" * 100, "A999999999", "d" * 2000)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", None),
        ("name", ""),
        ("name", "   "),
        ("name", "n" * 101),
        ("key", None),
        ("key", ""),
        ("key", "W"),
        ("key", "web"),
        ("key", "Web"),
        ("key", "1WEB"),
        ("key", "WEB-1"),
        ("key", "WE B"),
        ("key", "WEB_1"),
        ("key", "ÄBC"),
        ("key", "ABCDEFGHIJK"),
        ("key", 123),
        ("description", "d" * 2001),
        ("description", 42),
    ],
)
def test_create_rejects_invalid_fields(
    client: TestClient, team: Team, field: str, value: Any
) -> None:
    act_as(client, team, Role.OWNER)
    body = {"name": "Website", "key": "WEB", "description": "Site"} | {field: value}

    response = client.post(projects_url(team), json=body)

    assert validation_fields(response) == {(field, "body")}
    assert listed(client, team, include_archived=True) == []


def test_create_requires_name_and_key(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    response = client.post(projects_url(team), json={})

    assert validation_fields(response) == {("name", "body"), ("key", "body")}


def test_create_with_a_taken_key_conflicts(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.ADMIN)
    existing = create(client, team, name="Website", key="WEB")

    response = client.post(projects_url(team), json={"name": "Web app", "key": "WEB"})

    assert_error(
        response,
        409,
        "conflict",
        reason="project_key_taken",
        message="This project key is already used in this workspace",
    )
    assert listed(client, team) == [existing]


def test_key_of_an_archived_project_stays_taken(
    client: TestClient, db_session: Session, team: Team
) -> None:
    create_project(db_session, team.workspace, key="OLD", archived_at=ARCHIVED_AT)
    act_as(client, team, Role.OWNER)

    response = client.post(projects_url(team), json={"name": "Old again", "key": "OLD"})

    assert_error(response, 409, "conflict", reason="project_key_taken")


def test_same_key_is_allowed_in_another_workspace(
    client: TestClient, db_session: Session, team: Team
) -> None:
    other = create_team(db_session)
    create_project(db_session, other.workspace, key="WEB")
    act_as(client, team, Role.OWNER)

    created = create(client, team, name="Website", key="WEB")

    assert created["workspace_id"] == str(team.workspace.id)


def test_create_ignores_server_controlled_fields(
    client: TestClient, db_session: Session, team: Team
) -> None:
    other = create_team(db_session)
    act_as(client, team, Role.OWNER)

    created = create(
        client,
        team,
        name="Website",
        key="WEB",
        archived_at="2026-01-01T00:00:00Z",
        created_by=str(other.owner.id),
        workspace_id=str(other.workspace.id),
    )

    assert created["archived_at"] is None
    assert created["created_by"] == str(team.owner.id)
    assert created["workspace_id"] == str(team.workspace.id)


# --- list -------------------------------------------------------------------------------


def test_list_is_empty_without_projects(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.VIEWER)

    assert listed(client, team) == []


def test_list_orders_by_name_case_insensitively_then_key(
    client: TestClient, db_session: Session, team: Team
) -> None:
    charlie = create_project(db_session, team.workspace, name="charlie", key="CH")
    same_z = create_project(db_session, team.workspace, name="Same", key="ZZ")
    alpha = create_project(db_session, team.workspace, name="alpha", key="AL")
    same_a = create_project(db_session, team.workspace, name="Same", key="AA")
    bravo = create_project(db_session, team.workspace, name="Bravo", key="BR")
    act_as(client, team, Role.VIEWER)

    body = listed(client, team)

    assert [p["id"] for p in body] == [str(p.id) for p in (alpha, bravo, charlie, same_a, same_z)]
    assert all(set(p) == PROJECT_FIELDS for p in body)


def test_list_hides_archived_projects_by_default(
    client: TestClient, db_session: Session, team: Team
) -> None:
    active = create_project(db_session, team.workspace, name="Active")
    create_project(db_session, team.workspace, name="Archived", archived_at=ARCHIVED_AT)
    act_as(client, team, Role.MEMBER)

    for params in ({}, {"include_archived": "false"}):
        assert [p["id"] for p in listed(client, team, **params)] == [str(active.id)]


def test_list_includes_archived_projects_on_request_in_name_order(
    client: TestClient, db_session: Session, team: Team
) -> None:
    beta = create_project(db_session, team.workspace, name="Beta")
    alpha = create_project(db_session, team.workspace, name="Alpha", archived_at=ARCHIVED_AT)
    act_as(client, team, Role.MEMBER)

    body = listed(client, team, include_archived="true")

    assert [(p["id"], p["archived_at"]) for p in body] == [
        (str(alpha.id), "2026-11-01T12:00:00Z"),
        (str(beta.id), None),
    ]


def test_list_rejects_an_invalid_include_archived(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    response = client.get(projects_url(team), params={"include_archived": "maybe"})

    assert validation_fields(response) == {("include_archived", "query")}


# --- get --------------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_get_returns_the_project(
    client: TestClient, db_session: Session, team: Team, role: Role
) -> None:
    project = create_project(
        db_session, team.workspace, name="Website", key="WEB", description="Site"
    )
    act_as(client, team, role)

    response = client.get(project_url(project.id))

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "id": str(project.id),
        "workspace_id": str(team.workspace.id),
        "name": "Website",
        "key": "WEB",
        "description": "Site",
        "archived_at": None,
        "created_by": str(team.owner.id),
        "created_at": body["created_at"],
    }
    assert body["created_at"].endswith("Z")


def test_get_returns_an_archived_project(
    client: TestClient, db_session: Session, team: Team
) -> None:
    project = create_project(db_session, team.workspace, archived_at=ARCHIVED_AT)
    act_as(client, team, Role.VIEWER)

    response = client.get(project_url(project.id))

    assert response.status_code == 200
    assert response.json()["archived_at"] == "2026-11-01T12:00:00Z"


# --- update -----------------------------------------------------------------------------


@pytest.fixture
def website(client: TestClient, team: Team) -> dict[str, Any]:
    """A project created through the API by the owner, who stays logged in."""
    act_as(client, team, Role.OWNER)
    return create(client, team, name="Website", key="WEB", description="Marketing site")


def patch(client: TestClient, project: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    response = client.patch(project_url(project["id"]), json=body)
    assert response.status_code == 200, response.text
    updated: dict[str, Any] = response.json()
    assert client.get(project_url(project["id"])).json() == updated
    return updated


def test_update_changes_name_and_description(
    client: TestClient, team: Team, website: dict[str, Any]
) -> None:
    updated = patch(client, website, {"name": "  Website v2 ", "description": " New copy "})

    assert updated == website | {"name": "Website v2", "description": "New copy"}


def test_update_with_null_description_clears_it(
    client: TestClient, website: dict[str, Any]
) -> None:
    updated = patch(client, website, {"name": "Website v2", "description": None})

    assert updated == website | {"name": "Website v2", "description": None}


@pytest.mark.parametrize(
    ("body", "changes"),
    [
        ({"name": "Website v2"}, {"name": "Website v2"}),
        ({"description": "Only this"}, {"description": "Only this"}),
        ({}, {}),
        ({"name": "Website", "description": "Marketing site"}, {}),
    ],
)
def test_update_leaves_omitted_fields_unchanged(
    client: TestClient, website: dict[str, Any], body: dict[str, Any], changes: dict[str, Any]
) -> None:
    assert patch(client, website, body) == website | changes


def test_update_ignores_key_and_server_controlled_fields(
    client: TestClient, team: Team, website: dict[str, Any]
) -> None:
    updated = patch(
        client,
        website,
        {
            "name": "Website v2",
            "key": "NEW",
            "archived_at": "2026-01-01T00:00:00Z",
            "workspace_id": str(team.workspace.id),
            "created_by": str(team.users[Role.ADMIN].id),
        },
    )

    assert updated == website | {"name": "Website v2"}


def test_admin_can_update_a_project_someone_else_created(
    client: TestClient, team: Team, website: dict[str, Any]
) -> None:
    act_as(client, team, Role.ADMIN)

    assert patch(client, website, {"name": "Renamed"}) == website | {"name": "Renamed"}


def test_archived_project_can_still_be_edited(
    client: TestClient, db_session: Session, team: Team
) -> None:
    project = create_project(db_session, team.workspace, name="Old", archived_at=ARCHIVED_AT)
    act_as(client, team, Role.OWNER)

    response = client.patch(project_url(project.id), json={"name": "Old (read-only)"})

    assert response.status_code == 200
    assert response.json()["name"] == "Old (read-only)"
    assert response.json()["archived_at"] == "2026-11-01T12:00:00Z"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", None),
        ("name", ""),
        ("name", "   "),
        ("name", "n" * 101),
        ("description", "d" * 2001),
        ("description", 42),
    ],
)
def test_update_rejects_invalid_fields(
    client: TestClient, website: dict[str, Any], field: str, value: Any
) -> None:
    response = client.patch(project_url(website["id"]), json={field: value})

    assert validation_fields(response) == {(field, "body")}
    assert client.get(project_url(website["id"])).json() == website


# --- archive ----------------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.OWNER, Role.ADMIN])
def test_archive_sets_archived_at(
    client: TestClient, team: Team, website: dict[str, Any], role: Role
) -> None:
    act_as(client, team, role)
    before = datetime.now(UTC)

    response = client.post(f"{project_url(website['id'])}/archive")

    assert response.status_code == 200
    body = response.json()
    assert body == website | {"archived_at": body["archived_at"]}
    assert body["archived_at"].endswith("Z")
    archived_at = datetime.fromisoformat(body["archived_at"])
    # The database clock stamps it; allow for the test transaction having started earlier.
    assert abs((archived_at - before).total_seconds()) < 60
    assert client.get(project_url(website["id"])).json() == body


def test_archive_ignores_a_request_body(client: TestClient, website: dict[str, Any]) -> None:
    response = client.post(f"{project_url(website['id'])}/archive", json={"archived_at": None})

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


def test_archived_project_leaves_the_default_list(
    client: TestClient, team: Team, website: dict[str, Any]
) -> None:
    archived = client.post(f"{project_url(website['id'])}/archive").json()

    assert listed(client, team) == []
    assert listed(client, team, include_archived=True) == [archived]


def test_archiving_twice_conflicts_and_keeps_the_first_timestamp(
    client: TestClient, db_session: Session, team: Team
) -> None:
    project = create_project(db_session, team.workspace, archived_at=ARCHIVED_AT)
    act_as(client, team, Role.OWNER)

    response = client.post(f"{project_url(project.id)}/archive")

    assert_error(
        response,
        409,
        "conflict",
        reason="already_archived",
        message="This project is already archived",
    )
    assert client.get(project_url(project.id)).json()["archived_at"] == "2026-11-01T12:00:00Z"


# --- workspace delete -------------------------------------------------------------------


def test_deleting_a_workspace_deletes_its_projects(
    client: TestClient, db_session: Session, team: Team
) -> None:
    doomed = [
        create_project(db_session, team.workspace),
        create_project(db_session, team.workspace, archived_at=ARCHIVED_AT),
    ]
    other = create_team(db_session)
    survivor = create_project(db_session, other.workspace)
    act_as(client, team, Role.OWNER)

    response = client.delete(f"/api/workspaces/{team.workspace.id}")

    assert response.status_code == 204
    remaining = db_session.scalar(
        select(func.count()).select_from(Project).where(Project.workspace_id == team.workspace.id)
    )
    assert remaining == 0
    for project in doomed:
        assert_error(client.get(project_url(project.id)), 404, "not_found")
    log_in(client, other.owner)
    assert [p["id"] for p in listed(client, other)] == [str(survivor.id)]
