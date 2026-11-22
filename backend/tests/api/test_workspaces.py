"""Workspace CRUD (contract section 3.3). Role gates and 404s: test_workspace_access.py."""

from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.factories import add_member, create_team, create_user, create_workspace, log_in

WORKSPACES = "/api/workspaces"
WORKSPACE_FIELDS = {"id", "name", "slug", "created_by", "created_at", "my_role"}


@pytest.fixture
def user(client: TestClient, db_session: Session) -> User:
    user = create_user(db_session, name="Asha Rao")
    log_in(client, user)
    return user


def create(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post(WORKSPACES, json=body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


# --- create -----------------------------------------------------------------------------


def test_create_returns_workspace_and_makes_creator_owner(
    client: TestClient, db_session: Session, user: User
) -> None:
    response = client.post(WORKSPACES, json={"name": "Acme", "slug": "acme"})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == WORKSPACE_FIELDS
    assert UUID(body["id"]).version == 4
    assert body["name"] == "Acme"
    assert body["slug"] == "acme"
    assert body["created_by"] == str(user.id)
    assert body["created_at"].endswith("Z")
    assert body["my_role"] == "owner"
    members = client.get(f"{WORKSPACES}/{body['id']}/members").json()
    assert [(m["user_id"], m["role"]) for m in members] == [(str(user.id), "owner")]
    assert client.get(f"{WORKSPACES}/{body['id']}").json() == body


def test_create_trims_name_and_slug(client: TestClient, user: User) -> None:
    body = create(client, name="  Acme Inc  ", slug="  acme  ")

    assert body["name"] == "Acme Inc"
    assert body["slug"] == "acme"


@pytest.mark.parametrize("body", [{"name": "Acme Inc."}, {"name": "Acme Inc.", "slug": None}])
def test_create_derives_slug_from_name_when_omitted(
    client: TestClient, user: User, body: dict[str, Any]
) -> None:
    assert create(client, **body)["slug"] == "acme-inc"


def test_derived_slug_gets_numbered_suffix_when_taken(client: TestClient, user: User) -> None:
    slugs = [create(client, name="Acme")["slug"] for _ in range(3)]

    assert slugs == ["acme", "acme-2", "acme-3"]


def test_derived_slug_skips_suffixes_already_taken(
    client: TestClient, db_session: Session, user: User
) -> None:
    create_workspace(db_session, slug="acme")
    create_workspace(db_session, slug="acme-2")
    create_workspace(db_session, slug="acme-4")

    assert create(client, name="ACME")["slug"] == "acme-3"


def test_derived_slug_stays_within_48_chars(client: TestClient, user: User) -> None:
    name = "a" * 60

    first = create(client, name=name)["slug"]
    second = create(client, name=name)["slug"]

    assert first == "a" * 48
    assert second == "a" * 46 + "-2"


def test_name_without_alphanumerics_gets_default_slug(client: TestClient, user: User) -> None:
    assert create(client, name="!!!")["slug"] == "workspace"
    assert create(client, name="???")["slug"] == "workspace-2"


def test_explicit_slug_that_is_taken_conflicts(
    client: TestClient, db_session: Session, user: User
) -> None:
    create_workspace(db_session, slug="acme")

    response = client.post(WORKSPACES, json={"name": "Acme", "slug": "acme"})

    assert_error(
        response,
        409,
        "conflict",
        reason="slug_taken",
        message="This workspace URL is already taken",
    )
    assert client.get(WORKSPACES).json() == []


def test_explicit_slug_is_used_as_given(client: TestClient, user: User) -> None:
    assert create(client, name="Acme", slug="acme-hq")["slug"] == "acme-hq"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", ""),
        ("name", "   "),
        ("name", "n" * 101),
        ("name", None),
        ("slug", ""),
        ("slug", "   "),
        ("slug", "Acme"),
        ("slug", "a--b"),
        ("slug", "-acme"),
        ("slug", "acme-"),
        ("slug", "a_b"),
        ("slug", "acme inc"),
        ("slug", "s" * 49),
    ],
)
def test_create_rejects_invalid_fields(
    client: TestClient, user: User, field: str, value: str | None
) -> None:
    body = {"name": "Acme", "slug": "acme"} | {field: value}

    response = client.post(WORKSPACES, json=body)

    assert validation_fields(response) == {(field, "body")}


def test_create_requires_a_name(client: TestClient, user: User) -> None:
    assert validation_fields(client.post(WORKSPACES, json={})) == {("name", "body")}


def test_create_accepts_boundary_lengths(client: TestClient, user: User) -> None:
    body = create(client, name="n" * 100, slug="s" * 48)

    assert body["name"] == "n" * 100
    assert body["slug"] == "s" * 48


# --- list -------------------------------------------------------------------------------


def test_list_is_empty_without_memberships(client: TestClient, user: User) -> None:
    response = client.get(WORKSPACES)

    assert response.status_code == 200
    assert response.json() == []


def test_list_returns_only_my_workspaces_with_my_role_ordered_by_name(
    client: TestClient, db_session: Session, user: User
) -> None:
    charlie = create_workspace(db_session, owner=user, name="charlie")
    bravo = create_workspace(db_session, name="Bravo")
    add_member(db_session, bravo, user, Role.VIEWER)
    alpha = create_workspace(db_session, name="alpha")
    add_member(db_session, alpha, user, Role.ADMIN)
    create_workspace(db_session, name="Aardvark")  # not a member

    response = client.get(WORKSPACES)

    assert response.status_code == 200
    body = response.json()
    assert [(w["id"], w["name"], w["my_role"]) for w in body] == [
        (str(alpha.id), "alpha", "admin"),
        (str(bravo.id), "Bravo", "viewer"),
        (str(charlie.id), "charlie", "owner"),
    ]
    assert all(set(w) == WORKSPACE_FIELDS for w in body)


# --- get --------------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_get_returns_workspace_with_callers_role(
    client: TestClient, db_session: Session, role: Role
) -> None:
    team = create_team(db_session)
    log_in(client, team.users[role])

    response = client.get(f"{WORKSPACES}/{team.workspace.id}")

    assert response.status_code == 200
    assert response.json() == {
        "id": str(team.workspace.id),
        "name": team.workspace.name,
        "slug": team.workspace.slug,
        "created_by": str(team.owner.id),
        "created_at": response.json()["created_at"],
        "my_role": role.value,
    }


# --- update -----------------------------------------------------------------------------


def test_update_renames_and_keeps_slug(client: TestClient, user: User) -> None:
    created = create(client, name="Acme", slug="acme")

    response = client.patch(
        f"{WORKSPACES}/{created['id']}", json={"name": "  Acme Inc  ", "slug": "other"}
    )

    assert response.status_code == 200
    assert response.json() == created | {"name": "Acme Inc"}
    assert client.get(f"{WORKSPACES}/{created['id']}").json()["name"] == "Acme Inc"


def test_update_with_empty_body_returns_workspace_unchanged(client: TestClient, user: User) -> None:
    created = create(client, name="Acme")

    response = client.patch(f"{WORKSPACES}/{created['id']}", json={})

    assert response.status_code == 200
    assert response.json() == created


@pytest.mark.parametrize("name", [None, "", "   ", "n" * 101])
def test_update_rejects_invalid_name(client: TestClient, user: User, name: str | None) -> None:
    created = create(client, name="Acme")

    response = client.patch(f"{WORKSPACES}/{created['id']}", json={"name": name})

    assert validation_fields(response) == {("name", "body")}
    assert client.get(f"{WORKSPACES}/{created['id']}").json()["name"] == "Acme"


# --- delete -----------------------------------------------------------------------------


def test_delete_removes_workspace_and_cascades_to_members(
    client: TestClient, db_session: Session
) -> None:
    team = create_team(db_session)
    other = create_workspace(db_session, owner=team.owner)
    log_in(client, team.owner)

    response = client.delete(f"{WORKSPACES}/{team.workspace.id}")

    assert response.status_code == 204
    assert response.content == b""
    assert db_session.get(Workspace, team.workspace.id) is None
    remaining = db_session.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == team.workspace.id)
    )
    assert remaining == 0
    assert_error(client.get(f"{WORKSPACES}/{team.workspace.id}"), 404, "not_found")
    assert [w["id"] for w in client.get(WORKSPACES).json()] == [str(other.id)]
    # Users are not touched.
    assert db_session.get(User, team.users[Role.MEMBER].id) is not None
