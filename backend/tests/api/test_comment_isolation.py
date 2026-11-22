"""Tenant isolation for comments (contract section 1.10, PLAN.md rule 4).

A member of workspace A, whatever their role there, can neither see nor touch the comments of
workspace B: B's tasks are 404 for listing and posting comments, and B's comment ids are 404 on
every comment route, exactly like ids that do not exist. Roles always come from the comment's
(task's) own workspace.
"""

import uuid
from dataclasses import dataclass
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.comment import Comment
from app.models.task import Task
from app.services.permissions import Role
from tests.api.comment_helpers import comment_ids, comment_url, comments_url, get_page
from tests.api.helpers import assert_error
from tests.api.task_helpers import Json
from tests.factories import (
    Team,
    add_member,
    create_comment,
    create_project,
    create_task,
    create_team,
    log_in,
)

TASK_NOT_FOUND = {"error": {"code": "not_found", "message": "Task not found", "details": {}}}
COMMENT_NOT_FOUND = {"error": {"code": "not_found", "message": "Comment not found", "details": {}}}
# Comment routes with a valid body, so only isolation can make them fail.
COMMENT_ROUTES = {
    "update_comment": ("PATCH", {"body": "Hijacked"}),
    "delete_comment": ("DELETE", None),
}


@dataclass(frozen=True)
class Side:
    team: Team
    task: Task
    # One by a member, one by the owner.
    comments: list[Comment]


@dataclass(frozen=True)
class TwoWorkspaces:
    a: Side
    b: Side


def make_side(db: Session) -> Side:
    team = create_team(db)
    task = create_task(db, create_project(db, team.workspace, key="WEB"))
    comments = [
        create_comment(db, task, team.users[Role.MEMBER], body="By the member"),
        create_comment(db, task, team.owner, body="By the owner"),
    ]
    return Side(team=team, task=task, comments=comments)


@pytest.fixture
def world(db_session: Session) -> TwoWorkspaces:
    return TwoWorkspaces(a=make_side(db_session), b=make_side(db_session))


def call(client: TestClient, route: str, comment_id: UUID) -> httpx2.Response:
    method, body = COMMENT_ROUTES[route]
    return client.request(method, comment_url(comment_id), json=body)


def snapshot(client: TestClient, side: Side) -> list[Json]:
    log_in(client, side.team.owner)
    items: list[Json] = get_page(client, side.task.id, limit=100)["items"]
    return items


@pytest.mark.parametrize("role", list(Role))
def test_member_of_a_cannot_list_or_post_comments_on_bs_task(
    client: TestClient, world: TwoWorkspaces, role: Role
) -> None:
    before = snapshot(client, world.b)
    log_in(client, world.a.team.users[role])

    for response in (
        client.get(comments_url(world.b.task.id)),
        client.post(comments_url(world.b.task.id), json={"body": "Planted"}),
    ):
        assert response.status_code == 404
        assert response.json() == TASK_NOT_FOUND
    assert snapshot(client, world.b) == before


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("route", COMMENT_ROUTES)
def test_comment_of_b_is_not_found_for_a_member_of_a(
    client: TestClient, world: TwoWorkspaces, route: str, role: Role
) -> None:
    before = snapshot(client, world.b)
    log_in(client, world.a.team.users[role])

    for comment in world.b.comments:
        response = call(client, route, comment.id)

        assert response.status_code == 404
        assert response.json() == COMMENT_NOT_FOUND
        # Indistinguishable from an id that does not exist.
        unknown = call(client, route, uuid.uuid4())
        assert (unknown.status_code, unknown.json()) == (404, response.json())
    assert snapshot(client, world.b) == before


def test_each_task_lists_only_its_own_comments(client: TestClient, world: TwoWorkspaces) -> None:
    log_in(client, world.a.team.users[Role.VIEWER])

    items = get_page(client, world.a.task.id)["items"]

    assert sorted(comment_ids(items)) == sorted(str(c.id) for c in world.a.comments)
    assert {item["task_id"] for item in items} == {str(world.a.task.id)}


def test_role_comes_from_the_comments_own_workspace(
    client: TestClient, db_session: Session, world: TwoWorkspaces
) -> None:
    """Owner of A but only a viewer of B: B's comments are read-only for them."""
    owner_of_a = world.a.team.owner
    add_member(db_session, world.b.team.workspace, owner_of_a, Role.VIEWER)
    log_in(client, owner_of_a)

    assert client.get(comments_url(world.b.task.id)).status_code == 200
    post_in_b = client.post(comments_url(world.b.task.id), json={"body": "Hi"})
    assert_error(post_in_b, 403, "forbidden", reason="insufficient_role")
    for route in COMMENT_ROUTES:
        assert_error(
            call(client, route, world.b.comments[0].id),
            403,
            "forbidden",
            reason="insufficient_role",
        )
    # In their own workspace they are still an owner, who may delete anyone's comment.
    assert call(client, "delete_comment", world.a.comments[0].id).status_code == 204


def test_admin_of_b_and_viewer_of_a_can_only_moderate_bs_comments(
    client: TestClient, db_session: Session, world: TwoWorkspaces
) -> None:
    user = world.a.team.users[Role.VIEWER]
    add_member(db_session, world.b.team.workspace, user, Role.ADMIN)
    log_in(client, user)

    assert call(client, "delete_comment", world.b.comments[0].id).status_code == 204
    assert client.post(comments_url(world.b.task.id), json={"body": "Hi"}).status_code == 201
    assert_error(
        call(client, "delete_comment", world.a.comments[0].id),
        403,
        "forbidden",
        reason="insufficient_role",
    )
    post_in_a = client.post(comments_url(world.a.task.id), json={"body": "Hi"})
    assert_error(post_in_a, 403, "forbidden", reason="insufficient_role")
