"""Members and roles (contract 1.10 and 3.4). Role gates and 404s: test_workspace_access.py."""

from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.permissions import Role
from tests.api.helpers import assert_error, validation_fields
from tests.factories import Team, add_member, create_team, create_user, log_in

MEMBER_FIELDS = {"user_id", "email", "name", "role", "joined_at"}


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


def members_url(team: Team) -> str:
    return f"/api/workspaces/{team.workspace.id}/members"


def member_url(team: Team, user: User) -> str:
    return f"{members_url(team)}/{user.id}"


def roles_by_user(client: TestClient, team: Team) -> dict[UUID, str]:
    response = client.get(members_url(team))
    assert response.status_code == 200
    return {UUID(member["user_id"]): member["role"] for member in response.json()}


def act_as(client: TestClient, team: Team, role: Role) -> User:
    user = team.users[role]
    log_in(client, user)
    return user


def new_member(db: Session, team: Team, role: Role, name: str | None = None) -> User:
    user = create_user(db, name=name)
    add_member(db, team.workspace, user, role)
    return user


# --- list -------------------------------------------------------------------------------


def test_list_orders_by_role_then_name_case_insensitively(
    client: TestClient, db_session: Session, team: Team
) -> None:
    aaron = new_member(db_session, team, Role.ADMIN, name="aaron")
    zed = new_member(db_session, team, Role.VIEWER, name="Zed")
    act_as(client, team, Role.VIEWER)

    response = client.get(members_url(team))

    assert response.status_code == 200
    body = response.json()
    assert [(m["name"], m["role"]) for m in body] == [
        ("Olivia Owner", "owner"),
        ("aaron", "admin"),
        ("Admin User", "admin"),
        ("Member User", "member"),
        ("Other Member", "member"),
        ("Viewer User", "viewer"),
        ("Zed", "viewer"),
    ]
    assert all(set(m) == MEMBER_FIELDS for m in body)
    assert body[1]["user_id"] == str(aaron.id)
    assert body[1]["email"] == aaron.email
    assert body[6]["user_id"] == str(zed.id)
    assert all(m["joined_at"].endswith("Z") for m in body)


def test_list_never_includes_password_hashes(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    response = client.get(members_url(team))

    assert "password" not in response.text
    assert team.owner.password_hash not in response.text


# --- add --------------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_owner_can_add_with_any_role(
    client: TestClient, db_session: Session, team: Team, role: Role
) -> None:
    ben = create_user(db_session, email="ben@example.com", name="Ben Okafor")
    act_as(client, team, Role.OWNER)

    response = client.post(members_url(team), json={"email": "ben@example.com", "role": role})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == MEMBER_FIELDS
    assert body["user_id"] == str(ben.id)
    assert body["email"] == "ben@example.com"
    assert body["name"] == "Ben Okafor"
    assert body["role"] == role.value
    assert body["joined_at"].endswith("Z")
    assert roles_by_user(client, team)[ben.id] == role.value


@pytest.mark.parametrize("role", [Role.MEMBER, Role.VIEWER])
def test_admin_can_add_members_and_viewers(
    client: TestClient, db_session: Session, team: Team, role: Role
) -> None:
    create_user(db_session, email="ben@example.com")
    act_as(client, team, Role.ADMIN)

    response = client.post(members_url(team), json={"email": "ben@example.com", "role": role})

    assert response.status_code == 201
    assert response.json()["role"] == role.value


@pytest.mark.parametrize("role", [Role.ADMIN, Role.OWNER])
def test_admin_cannot_grant_admin_or_owner(
    client: TestClient, db_session: Session, team: Team, role: Role
) -> None:
    ben = create_user(db_session, email="ben@example.com")
    act_as(client, team, Role.ADMIN)

    response = client.post(members_url(team), json={"email": "ben@example.com", "role": role})

    assert_error(
        response,
        403,
        "forbidden",
        reason="protected_member",
        message="Only owners can grant the admin or owner role",
    )
    assert ben.id not in roles_by_user(client, team)


def test_add_matches_email_case_insensitively(
    client: TestClient, db_session: Session, team: Team
) -> None:
    ben = create_user(db_session, email="ben@example.com")
    act_as(client, team, Role.OWNER)

    response = client.post(
        members_url(team), json={"email": "  BEN@Example.COM ", "role": "member"}
    )

    assert response.status_code == 201
    assert response.json()["user_id"] == str(ben.id)


def test_add_unknown_email_is_a_field_error(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    response = client.post(
        members_url(team), json={"email": "nobody@example.com", "role": "member"}
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "validation_error",
            "message": "Request validation failed",
            "details": {
                "errors": [
                    {"field": "email", "location": "body", "message": "No user with this email"}
                ]
            },
        }
    }


@pytest.mark.parametrize("existing", [Role.OWNER, Role.VIEWER])
def test_add_existing_member_conflicts(client: TestClient, team: Team, existing: Role) -> None:
    act_as(client, team, Role.OWNER)

    response = client.post(
        members_url(team), json={"email": team.users[existing].email, "role": "member"}
    )

    assert_error(response, 409, "conflict", reason="already_member")
    assert roles_by_user(client, team)[team.users[existing].id] == existing.value


def test_added_user_can_see_the_workspace(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)
    response = client.post(members_url(team), json={"email": team.outsider.email, "role": "viewer"})
    assert response.status_code == 201

    log_in(client, team.outsider)

    workspace = client.get(f"/api/workspaces/{team.workspace.id}")
    assert workspace.status_code == 200
    assert workspace.json()["my_role"] == "viewer"
    assert str(team.workspace.id) in {w["id"] for w in client.get("/api/workspaces").json()}


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({"email": "not-an-email", "role": "member"}, {("email", "body")}),
        ({"email": "ben@example.com", "role": "superuser"}, {("role", "body")}),
        ({"email": "ben@example.com", "role": None}, {("role", "body")}),
        ({"email": "ben@example.com"}, {("role", "body")}),
        ({}, {("email", "body"), ("role", "body")}),
    ],
)
def test_add_rejects_invalid_body(
    client: TestClient, team: Team, body: dict[str, Any], fields: set[tuple[str, str]]
) -> None:
    act_as(client, team, Role.OWNER)

    assert validation_fields(client.post(members_url(team), json=body)) == fields


def test_role_check_comes_before_email_lookup(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.VIEWER)

    response = client.post(
        members_url(team), json={"email": "nobody@example.com", "role": "member"}
    )

    assert_error(response, 403, "forbidden", reason="insufficient_role")


# --- change role ------------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.OWNER, Role.ADMIN])
def test_cannot_change_own_role(client: TestClient, team: Team, role: Role) -> None:
    user = act_as(client, team, role)

    response = client.patch(member_url(team, user), json={"role": "viewer"})

    assert_error(
        response, 403, "forbidden", reason="own_role", message="You cannot change your own role"
    )
    assert roles_by_user(client, team)[user.id] == role.value


@pytest.mark.parametrize("role", [Role.MEMBER, Role.VIEWER])
def test_members_and_viewers_cannot_change_even_their_own_role(
    client: TestClient, team: Team, role: Role
) -> None:
    user = act_as(client, team, role)

    response = client.patch(member_url(team, user), json={"role": "admin"})

    assert_error(response, 403, "forbidden", reason="insufficient_role")


@pytest.mark.parametrize(
    ("before", "after"),
    [(Role.MEMBER, Role.VIEWER), (Role.VIEWER, Role.MEMBER)],
)
def test_admin_can_switch_members_and_viewers(
    client: TestClient, db_session: Session, team: Team, before: Role, after: Role
) -> None:
    target = new_member(db_session, team, before, name="Ben Okafor")
    act_as(client, team, Role.ADMIN)

    response = client.patch(member_url(team, target), json={"role": after})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == MEMBER_FIELDS
    assert (body["user_id"], body["name"], body["role"]) == (str(target.id), "Ben Okafor", after)
    assert roles_by_user(client, team)[target.id] == after.value


@pytest.mark.parametrize("target_role", [Role.OWNER, Role.ADMIN])
def test_admin_cannot_change_owners_or_admins(
    client: TestClient, db_session: Session, team: Team, target_role: Role
) -> None:
    target = new_member(db_session, team, target_role)
    act_as(client, team, Role.ADMIN)

    response = client.patch(member_url(team, target), json={"role": "viewer"})

    assert_error(
        response,
        403,
        "forbidden",
        reason="protected_member",
        message="Only owners can change or remove owners and admins",
    )
    assert roles_by_user(client, team)[target.id] == target_role.value


@pytest.mark.parametrize("new_role", [Role.ADMIN, Role.OWNER])
def test_admin_cannot_promote_to_admin_or_owner(
    client: TestClient, team: Team, new_role: Role
) -> None:
    act_as(client, team, Role.ADMIN)

    response = client.patch(member_url(team, team.other_member), json={"role": new_role})

    assert_error(response, 403, "forbidden", reason="protected_member")
    assert roles_by_user(client, team)[team.other_member.id] == "member"


@pytest.mark.parametrize(
    ("before", "after"),
    [
        (Role.MEMBER, Role.ADMIN),
        (Role.MEMBER, Role.OWNER),
        (Role.VIEWER, Role.OWNER),
        (Role.ADMIN, Role.VIEWER),
        (Role.OWNER, Role.ADMIN),
        (Role.OWNER, Role.VIEWER),
    ],
)
def test_owner_can_change_anyone_else(
    client: TestClient, db_session: Session, team: Team, before: Role, after: Role
) -> None:
    target = new_member(db_session, team, before)
    act_as(client, team, Role.OWNER)

    response = client.patch(member_url(team, target), json={"role": after})

    assert response.status_code == 200
    assert response.json()["role"] == after.value
    assert roles_by_user(client, team)[target.id] == after.value


def test_ownership_transfer(client: TestClient, team: Team) -> None:
    """Promote someone to owner; they can then demote the original owner, who can leave."""
    new_owner = team.users[Role.ADMIN]
    act_as(client, team, Role.OWNER)
    assert client.patch(member_url(team, new_owner), json={"role": "owner"}).status_code == 200

    log_in(client, new_owner)
    response = client.patch(member_url(team, team.owner), json={"role": "admin"})

    assert response.status_code == 200
    roles = roles_by_user(client, team)
    assert roles[new_owner.id] == "owner"
    assert roles[team.owner.id] == "admin"
    assert_error(client.delete(member_url(team, new_owner)), 409, "conflict", reason="last_owner")


@pytest.mark.parametrize("body", [{}, {"role": "member"}])
def test_change_without_a_new_role_returns_member_unchanged(
    client: TestClient, team: Team, body: dict[str, Any]
) -> None:
    act_as(client, team, Role.ADMIN)

    response = client.patch(member_url(team, team.other_member), json=body)

    assert response.status_code == 200
    assert response.json()["role"] == "member"


def test_noop_change_on_a_protected_member_is_still_forbidden_for_admins(
    client: TestClient, team: Team
) -> None:
    act_as(client, team, Role.ADMIN)

    response = client.patch(member_url(team, team.owner), json={})

    assert_error(response, 403, "forbidden", reason="protected_member")


@pytest.mark.parametrize("role", [None, "superuser", ""])
def test_change_rejects_invalid_role(client: TestClient, team: Team, role: str | None) -> None:
    act_as(client, team, Role.OWNER)

    response = client.patch(member_url(team, team.other_member), json={"role": role})

    assert validation_fields(response) == {("role", "body")}


# --- remove and leave -------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_any_member_can_leave(
    client: TestClient, db_session: Session, team: Team, role: Role
) -> None:
    new_member(db_session, team, Role.OWNER)  # so the owner is not the last one
    user = act_as(client, team, role)

    response = client.delete(member_url(team, user))

    assert response.status_code == 204
    assert response.content == b""
    assert_error(client.get(f"/api/workspaces/{team.workspace.id}"), 404, "not_found")
    assert client.get("/api/workspaces").json() == []


def test_last_owner_cannot_leave(client: TestClient, team: Team) -> None:
    act_as(client, team, Role.OWNER)

    response = client.delete(member_url(team, team.owner))

    assert_error(
        response,
        409,
        "conflict",
        reason="last_owner",
        message="You are the only owner. Make another member an owner before leaving the workspace",
    )
    assert roles_by_user(client, team)[team.owner.id] == "owner"


@pytest.mark.parametrize("actor", [Role.OWNER, Role.ADMIN])
@pytest.mark.parametrize("target_role", [Role.MEMBER, Role.VIEWER])
def test_owners_and_admins_can_remove_members_and_viewers(
    client: TestClient, db_session: Session, team: Team, actor: Role, target_role: Role
) -> None:
    target = new_member(db_session, team, target_role)
    act_as(client, team, actor)

    response = client.delete(member_url(team, target))

    assert response.status_code == 204
    assert target.id not in roles_by_user(client, team)


@pytest.mark.parametrize("target_role", [Role.OWNER, Role.ADMIN])
def test_owner_can_remove_owners_and_admins(
    client: TestClient, db_session: Session, team: Team, target_role: Role
) -> None:
    target = new_member(db_session, team, target_role)
    act_as(client, team, Role.OWNER)

    response = client.delete(member_url(team, target))

    assert response.status_code == 204
    assert target.id not in roles_by_user(client, team)


@pytest.mark.parametrize("target_role", [Role.OWNER, Role.ADMIN])
def test_admin_cannot_remove_owners_or_admins(
    client: TestClient, db_session: Session, team: Team, target_role: Role
) -> None:
    target = new_member(db_session, team, target_role)
    act_as(client, team, Role.ADMIN)

    response = client.delete(member_url(team, target))

    assert_error(response, 403, "forbidden", reason="protected_member")
    assert roles_by_user(client, team)[target.id] == target_role.value


@pytest.mark.parametrize("role", [Role.MEMBER, Role.VIEWER])
def test_members_and_viewers_cannot_remove_others(
    client: TestClient, team: Team, role: Role
) -> None:
    act_as(client, team, role)

    for target in (team.other_member, team.owner):
        response = client.delete(member_url(team, target))

        assert_error(
            response,
            403,
            "forbidden",
            reason="insufficient_role",
            message="Only owners and admins can add, remove or change members",
        )
