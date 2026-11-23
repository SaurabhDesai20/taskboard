"""Who can call each comment endpoint (contract sections 1.10 and 3.7).

Every role on every endpoint, for the caller's own comment and for someone else's:
- Everyone can read; owners, admins and members can comment; viewers cannot.
- Editing is author-only, and the author must still be a member or above. An admin editing
  someone else's comment gets 403 `not_author`, like everyone else.
- Deleting is open to the author (member or above) and to owners and admins for any comment;
  a member deleting someone else's comment gets 403 `not_author`.
- Viewers get 403 `insufficient_role` on every write, even on a comment they wrote before
  being demoted.
Non-members and unknown ids get 404 on every endpoint, before any role or body check.
"""

import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.services.permissions import Role
from tests.api.comment_helpers import comment_url, comments_url, get_page
from tests.api.helpers import assert_error, validation_fields
from tests.api.task_helpers import Json
from tests.factories import Team, create_comment, create_project, create_task, create_team, log_in

WRITERS = frozenset({Role.OWNER, Role.ADMIN, Role.MEMBER})

CREATE_DENIED = "Only owners, admins and members can comment"
CHANGE_DENIED = "Only owners, admins and members can edit or delete their comments"
NOT_AUTHOR_EDIT = "Only the author can edit this comment"
NOT_AUTHOR_DELETE = "Only owners and admins can delete other people's comments"

# Expected outcome of editing or deleting a comment: a status code, or a 403 reason.
Outcome = int | str

# (role, the caller wrote the comment, outcome)
EDIT_CASES: list[tuple[Role, bool, Outcome]] = [
    (Role.OWNER, True, 200),
    (Role.ADMIN, True, 200),
    (Role.MEMBER, True, 200),
    (Role.VIEWER, True, "insufficient_role"),
    (Role.OWNER, False, "not_author"),
    (Role.ADMIN, False, "not_author"),
    (Role.MEMBER, False, "not_author"),
    (Role.VIEWER, False, "insufficient_role"),
]
DELETE_CASES: list[tuple[Role, bool, Outcome]] = [
    (Role.OWNER, True, 204),
    (Role.ADMIN, True, 204),
    (Role.MEMBER, True, 204),
    (Role.VIEWER, True, "insufficient_role"),
    (Role.OWNER, False, 204),
    (Role.ADMIN, False, 204),
    (Role.MEMBER, False, "not_author"),
    (Role.VIEWER, False, "insufficient_role"),
]
DENIED_MESSAGES = {
    ("PATCH", "insufficient_role"): CHANGE_DENIED,
    ("DELETE", "insufficient_role"): CHANGE_DENIED,
    ("PATCH", "not_author"): NOT_AUTHOR_EDIT,
    ("DELETE", "not_author"): NOT_AUTHOR_DELETE,
}


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    body: Json | None = None
    invalid_body: Json | None = None

    @property
    def path_param(self) -> str:
        return "tid" if "{tid}" in self.path else "cid"


ENDPOINTS = {
    "list_comments": Endpoint("GET", "/api/tasks/{tid}/comments"),
    "create_comment": Endpoint(
        "POST", "/api/tasks/{tid}/comments", {"body": "Hello"}, invalid_body={"body": ""}
    ),
    "update_comment": Endpoint(
        "PATCH", "/api/comments/{cid}", {"body": "Edited"}, invalid_body={"body": None}
    ),
    "delete_comment": Endpoint("DELETE", "/api/comments/{cid}"),
}
WITH_BODY = [name for name, endpoint in ENDPOINTS.items() if endpoint.invalid_body is not None]
NOT_FOUND_MESSAGES = {"tid": "Task not found", "cid": "Comment not found"}


@dataclass(frozen=True)
class Setup:
    team: Team
    project: Project
    task: Task
    # One comment by each role's user. The viewer's stands for one written before a demotion.
    own: dict[Role, Comment]
    # A comment by `team.other_member`, for acting on someone else's comment.
    others: Comment


@pytest.fixture
def setup(db_session: Session) -> Setup:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace, key="WEB")
    task = create_task(db_session, project, title="Fix login")
    own = {role: create_comment(db_session, task, user) for role, user in team.users.items()}
    others = create_comment(db_session, task, team.other_member, body="Someone else's")
    return Setup(team=team, project=project, task=task, own=own, others=others)


def call(
    client: TestClient,
    name: str,
    setup: Setup,
    *,
    tid: UUID | str | None = None,
    cid: UUID | str | None = None,
    invalid: bool = False,
) -> httpx2.Response:
    endpoint = ENDPOINTS[name]
    path = endpoint.path.format(tid=tid or setup.task.id, cid=cid or setup.others.id)
    body = endpoint.invalid_body if invalid else endpoint.body
    return client.request(endpoint.method, path, json=body)


def not_found(name: str) -> dict[str, Any]:
    message = NOT_FOUND_MESSAGES[ENDPOINTS[name].path_param]
    return {"error": {"code": "not_found", "message": message, "details": {}}}


def snapshot(client: TestClient, setup: Setup) -> list[Json]:
    """Every comment of the task, as the owner sees them."""
    log_in(client, setup.team.owner)
    items: list[Json] = get_page(client, setup.task.id, limit=100)["items"]
    return items


def assert_outcome(response: httpx2.Response, method: str, outcome: Outcome) -> None:
    if isinstance(outcome, int):
        assert response.status_code == outcome, response.text
    else:
        message = DENIED_MESSAGES[(method, outcome)]
        assert_error(response, 403, "forbidden", reason=outcome, message=message)


@pytest.mark.parametrize("role", list(Role))
def test_everyone_can_list_comments(client: TestClient, setup: Setup, role: Role) -> None:
    log_in(client, setup.team.users[role])

    response = call(client, "list_comments", setup)

    assert response.status_code == 200
    assert len(response.json()["items"]) == len(Role) + 1


@pytest.mark.parametrize("role", list(Role))
def test_owners_admins_and_members_can_comment(
    client: TestClient, setup: Setup, role: Role
) -> None:
    before = snapshot(client, setup)
    log_in(client, setup.team.users[role])

    response = call(client, "create_comment", setup)

    if role in WRITERS:
        assert response.status_code == 201
        assert response.json()["author"]["id"] == str(setup.team.users[role].id)
    else:
        assert_error(response, 403, "forbidden", reason="insufficient_role", message=CREATE_DENIED)
        assert snapshot(client, setup) == before


@pytest.mark.parametrize(("role", "own", "outcome"), EDIT_CASES)
def test_only_the_author_can_edit(
    client: TestClient, setup: Setup, role: Role, own: bool, outcome: Outcome
) -> None:
    comment = setup.own[role] if own else setup.others
    before = snapshot(client, setup)
    log_in(client, setup.team.users[role])

    response = client.patch(comment_url(comment.id), json={"body": "Edited"})

    assert_outcome(response, "PATCH", outcome)
    if outcome == 200:
        assert response.json()["body"] == "Edited"
        assert response.json()["edited_at"] is not None
    else:
        assert snapshot(client, setup) == before


@pytest.mark.parametrize(("role", "own", "outcome"), DELETE_CASES)
def test_the_author_or_an_admin_can_delete(
    client: TestClient, setup: Setup, role: Role, own: bool, outcome: Outcome
) -> None:
    comment = setup.own[role] if own else setup.others
    before = snapshot(client, setup)
    log_in(client, setup.team.users[role])

    response = client.delete(comment_url(comment.id))

    assert_outcome(response, "DELETE", outcome)
    after = snapshot(client, setup)
    if outcome == 204:
        assert after == [item for item in before if item["id"] != str(comment.id)]
    else:
        assert after == before


def test_admin_can_delete_an_owners_comment_but_not_edit_it(
    client: TestClient, setup: Setup
) -> None:
    owners = setup.own[Role.OWNER]
    log_in(client, setup.team.users[Role.ADMIN])

    edit = client.patch(comment_url(owners.id), json={"body": "Edited by admin"})
    delete = client.delete(comment_url(owners.id))

    assert_error(edit, 403, "forbidden", reason="not_author", message=NOT_AUTHOR_EDIT)
    assert delete.status_code == 204


def test_a_member_can_edit_and_delete_their_own_comment_end_to_end(
    client: TestClient, setup: Setup
) -> None:
    log_in(client, setup.team.users[Role.MEMBER])
    created = client.post(comments_url(setup.task.id), json={"body": "Mine"}).json()

    edited = client.patch(comment_url(created["id"]), json={"body": "Still mine"})
    deleted = client.delete(comment_url(created["id"]))

    assert edited.status_code == 200
    assert edited.json()["body"] == "Still mine"
    assert deleted.status_code == 204


@pytest.mark.parametrize("name", ENDPOINTS)
def test_non_member_gets_not_found(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.outsider)

    response = call(client, name, setup)

    assert response.status_code == 404
    assert response.json() == not_found(name)


@pytest.mark.parametrize("name", ENDPOINTS)
def test_unknown_id_gets_not_found(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.owner)
    unknown = uuid.uuid4()

    response = call(client, name, setup, tid=unknown, cid=unknown)

    assert response.status_code == 404
    assert response.json() == not_found(name)


@pytest.mark.parametrize("name", WITH_BODY)
def test_not_found_comes_before_body_validation(
    client: TestClient, setup: Setup, name: str
) -> None:
    log_in(client, setup.team.outsider)

    response = call(client, name, setup, invalid=True)

    assert response.status_code == 404
    assert response.json() == not_found(name)


@pytest.mark.parametrize("name", WITH_BODY)
def test_insufficient_role_comes_before_body_validation(
    client: TestClient, setup: Setup, name: str
) -> None:
    log_in(client, setup.team.users[Role.VIEWER])

    response = call(client, name, setup, cid=setup.own[Role.VIEWER].id, invalid=True)

    assert_error(response, 403, "forbidden", reason="insufficient_role")


def test_body_validation_comes_before_not_author(client: TestClient, setup: Setup) -> None:
    """`not_author` is a business rule (contract 1.10 step 5), checked after the body."""
    log_in(client, setup.team.users[Role.ADMIN])

    response = call(client, "update_comment", setup, invalid=True)

    assert validation_fields(response) == {("body", "body")}


@pytest.mark.parametrize("name", ENDPOINTS)
def test_malformed_id_is_a_validation_error(client: TestClient, setup: Setup, name: str) -> None:
    log_in(client, setup.team.owner)

    response = call(client, name, setup, tid="not-a-uuid", cid="not-a-uuid")

    assert validation_fields(response) == {(ENDPOINTS[name].path_param, "path")}


@pytest.mark.parametrize("name", ENDPOINTS)
def test_every_endpoint_requires_a_session(client: TestClient, setup: Setup, name: str) -> None:
    response = call(client, name, setup)

    assert_error(response, 401, "unauthorized", message="Authentication required")


@pytest.mark.parametrize("name", [name for name in ENDPOINTS if ENDPOINTS[name].method != "GET"])
def test_mutations_require_the_csrf_header(client: TestClient, setup: Setup, name: str) -> None:
    before = snapshot(client, setup)
    del client.headers["X-Requested-With"]

    response = call(client, name, setup)

    assert_error(response, 403, "forbidden", reason="csrf")
    client.headers["X-Requested-With"] = "taskboard"
    assert snapshot(client, setup) == before


def test_an_author_who_left_the_workspace_cannot_reach_their_comment(
    client: TestClient, db_session: Session, setup: Setup
) -> None:
    leaver = setup.team.users[Role.MEMBER]
    comment = setup.own[Role.MEMBER]
    log_in(client, leaver)
    assert (
        client.delete(f"/api/workspaces/{setup.team.workspace.id}/members/{leaver.id}").status_code
        == 204
    )

    for response in (
        client.patch(comment_url(comment.id), json={"body": "Edited"}),
        client.delete(comment_url(comment.id)),
    ):
        assert response.status_code == 404
        assert response.json() == not_found("update_comment")
    # The comment stays, under the author's name, for the remaining members.
    authors = {item["id"]: item["author"] for item in snapshot(client, setup)}
    assert authors[str(comment.id)] == {"id": str(leaver.id), "name": leaver.name}
