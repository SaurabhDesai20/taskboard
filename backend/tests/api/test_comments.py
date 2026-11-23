"""Comment CRUD, validation, pagination, archived projects and cascades (contract sections 1.6,
1.8 and 3.7).

Role gates, the author-or-admin rule and 404s: test_comment_access.py. Cross-workspace isolation:
test_comment_isolation.py. Comment counts on tasks: test_comment_counts.py.
"""

import base64
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.schemas.pagination import Cursor
from app.services.permissions import Role
from tests.api.comment_helpers import (
    COMMENT_FIELDS,
    all_pages,
    comment_ids,
    comment_url,
    comments_url,
    get_page,
    post_comment,
    thread_order,
)
from tests.api.helpers import assert_error, validation_fields
from tests.api.task_helpers import Json, task_url
from tests.factories import Team, create_comment, create_project, create_task, create_team, log_in

# Long before the database clock, so API-created comments always sort after factory ones.
T0 = datetime(2020, 1, 1, 9, 0, tzinfo=UTC)
ARCHIVED_AT = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
ARCHIVED_MESSAGE = "This project is archived, so its comments are read-only"
WRITERS = [Role.OWNER, Role.ADMIN, Role.MEMBER]


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


@pytest.fixture
def member(team: Team) -> User:
    return team.users[Role.MEMBER]


@pytest.fixture
def project(db_session: Session, team: Team) -> Project:
    return create_project(db_session, team.workspace, name="Website", key="WEB")


@pytest.fixture
def task(db_session: Session, project: Project) -> Task:
    return create_task(db_session, project, title="Fix login redirect")


def at(minutes: float) -> datetime:
    return T0 + timedelta(minutes=minutes)


def stored_bodies(db: Session, task: Task) -> list[str]:
    stmt = select(Comment.body).where(Comment.task_id == task.id).order_by(Comment.body)
    return list(db.scalars(stmt))


# --- create -----------------------------------------------------------------------------


@pytest.mark.parametrize("role", WRITERS)
def test_create_returns_the_new_comment(
    client: TestClient, team: Team, task: Task, role: Role
) -> None:
    author = team.users[role]
    log_in(client, author)

    response = client.post(comments_url(task.id), json={"body": "Reproduced on Chrome."})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == COMMENT_FIELDS
    assert UUID(body["id"]).version == 4
    assert body == {
        "id": body["id"],
        "task_id": str(task.id),
        "author": {"id": str(author.id), "name": author.name},
        "body": "Reproduced on Chrome.",
        "created_at": body["created_at"],
        "edited_at": None,
    }
    assert body["created_at"].endswith("Z")
    assert get_page(client, task.id) == {"items": [body], "next_cursor": None}


def test_create_trims_the_body_and_keeps_inner_whitespace(
    client: TestClient, member: User, task: Task
) -> None:
    log_in(client, member)

    created = post_comment(client, task.id, "  \n Line one\n\n  Line two \t\n")

    assert created["body"] == "Line one\n\n  Line two"


@pytest.mark.parametrize("text", ["x", "é" * 5000, "  " + "y" * 5000 + "\n"])
def test_create_accepts_1_to_5000_characters_after_trimming(
    client: TestClient, member: User, task: Task, text: str
) -> None:
    log_in(client, member)

    created = post_comment(client, task.id, text)

    assert created["body"] == text.strip()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"body": None},
        {"body": ""},
        {"body": " \n\t "},
        {"body": "x" * 5001},
        {"body": 42},
        {"body": ["Hi"]},
    ],
)
def test_create_rejects_an_invalid_body(
    client: TestClient, db_session: Session, member: User, task: Task, payload: Json
) -> None:
    log_in(client, member)

    response = client.post(comments_url(task.id), json=payload)

    assert validation_fields(response) == {("body", "body")}
    assert stored_bodies(db_session, task) == []


def test_create_ignores_server_controlled_fields(
    client: TestClient, db_session: Session, team: Team, member: User, project: Project, task: Task
) -> None:
    other_task = create_task(db_session, project)
    sent_id = str(uuid4())
    log_in(client, member)

    response = client.post(
        comments_url(task.id),
        json={
            "body": "Hi",
            "id": sent_id,
            "task_id": str(other_task.id),
            "author_id": str(team.owner.id),
            "author": {"id": str(team.owner.id), "name": "Someone else"},
            "created_at": "2020-01-01T00:00:00Z",
            "edited_at": "2020-01-02T00:00:00Z",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["id"] != sent_id
    assert created["task_id"] == str(task.id)
    assert created["author"] == {"id": str(member.id), "name": member.name}
    assert created["created_at"] != "2020-01-01T00:00:00Z"
    assert created["edited_at"] is None


# --- edit -------------------------------------------------------------------------------


def test_edit_replaces_the_body_and_sets_edited_at(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    comment = create_comment(db_session, task, member, body="Reproduced on Chrome.", created_at=T0)
    log_in(client, member)

    response = client.patch(
        comment_url(comment.id), json={"body": "  Reproduced on Chrome, Firefox and Safari. "}
    )

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "id": str(comment.id),
        "task_id": str(task.id),
        "author": {"id": str(member.id), "name": member.name},
        "body": "Reproduced on Chrome, Firefox and Safari.",
        "created_at": "2020-01-01T09:00:00Z",
        "edited_at": body["edited_at"],
    }
    assert body["edited_at"].endswith("Z")
    assert datetime.fromisoformat(body["edited_at"]) > T0
    assert get_page(client, task.id)["items"] == [body]


@pytest.mark.parametrize("payload", [{}, {"body": "Same"}, {"body": "  Same \n"}])
def test_edit_without_a_change_leaves_the_comment_alone(
    client: TestClient, db_session: Session, member: User, task: Task, payload: Json
) -> None:
    comment = create_comment(db_session, task, member, body="Same", created_at=T0)
    log_in(client, member)
    before = get_page(client, task.id)["items"]

    response = client.patch(comment_url(comment.id), json=payload)

    assert response.status_code == 200
    assert [response.json()] == before
    assert before[0]["edited_at"] is None
    assert get_page(client, task.id)["items"] == before


def test_edit_keeps_edited_at_on_a_later_no_op(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    edited_at = datetime(2021, 5, 1, 8, 30, tzinfo=UTC)
    comment = create_comment(
        db_session, task, member, body="Edited once", created_at=T0, edited_at=edited_at
    )
    log_in(client, member)

    response = client.patch(comment_url(comment.id), json={"body": "Edited once"})

    assert response.json()["edited_at"] == "2021-05-01T08:30:00Z"


@pytest.mark.parametrize(
    "payload",
    [{"body": None}, {"body": ""}, {"body": "   "}, {"body": "x" * 5001}, {"body": 1}],
)
def test_edit_rejects_an_invalid_body(
    client: TestClient, db_session: Session, member: User, task: Task, payload: Json
) -> None:
    comment = create_comment(db_session, task, member, body="Original")
    log_in(client, member)

    response = client.patch(comment_url(comment.id), json=payload)

    assert validation_fields(response) == {("body", "body")}
    assert stored_bodies(db_session, task) == ["Original"]


def test_edit_ignores_server_controlled_fields(
    client: TestClient, db_session: Session, team: Team, member: User, project: Project, task: Task
) -> None:
    other_task = create_task(db_session, project)
    comment = create_comment(db_session, task, member, body="Original", created_at=T0)
    log_in(client, member)

    response = client.patch(
        comment_url(comment.id),
        json={
            "body": "Edited",
            "task_id": str(other_task.id),
            "author_id": str(team.owner.id),
            "created_at": "2025-01-01T00:00:00Z",
            "edited_at": None,
        },
    )

    body = response.json()
    assert body["body"] == "Edited"
    assert body["task_id"] == str(task.id)
    assert body["author"]["id"] == str(member.id)
    assert body["created_at"] == "2020-01-01T09:00:00Z"
    assert body["edited_at"] is not None


# --- delete -----------------------------------------------------------------------------


def test_delete_removes_only_that_comment(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    kept = create_comment(db_session, task, member, created_at=at(0))
    gone = create_comment(db_session, task, member, created_at=at(1))
    log_in(client, member)

    response = client.delete(comment_url(gone.id))

    assert response.status_code == 204
    assert response.content == b""
    assert comment_ids(get_page(client, task.id)["items"]) == [str(kept.id)]
    for again in (client.delete(comment_url(gone.id)), client.patch(comment_url(gone.id), json={})):
        assert_error(again, 404, "not_found", message="Comment not found")


# --- list and pagination -----------------------------------------------------------------


def test_list_of_a_task_without_comments_is_an_empty_last_page(
    client: TestClient, team: Team, task: Task
) -> None:
    log_in(client, team.users[Role.VIEWER])

    assert get_page(client, task.id) == {"items": [], "next_cursor": None}


def test_list_is_oldest_first_with_ties_in_id_order(
    client: TestClient, db_session: Session, team: Team, member: User, task: Task
) -> None:
    # Inserted out of order; two pairs share a timestamp.
    comments = [
        create_comment(db_session, task, team.owner, created_at=at(5)),
        create_comment(db_session, task, member, created_at=at(0)),
        create_comment(db_session, task, team.owner, created_at=at(1)),
        create_comment(db_session, task, member, created_at=at(1)),
        create_comment(db_session, task, member, created_at=at(5)),
    ]
    log_in(client, team.users[Role.VIEWER])

    page = get_page(client, task.id)

    assert comment_ids(page["items"]) == thread_order(comments)
    assert page["next_cursor"] is None
    first = min(comments, key=lambda c: c.created_at)
    assert page["items"][0] == {
        "id": str(first.id),
        "task_id": str(task.id),
        "author": {"id": str(member.id), "name": member.name},
        "body": first.body,
        "created_at": "2020-01-01T09:00:00Z",
        "edited_at": None,
    }


def test_list_returns_only_the_tasks_own_comments(
    client: TestClient, db_session: Session, team: Team, member: User, project: Project, task: Task
) -> None:
    other_task = create_task(db_session, project)
    other_project_task = create_task(db_session, create_project(db_session, team.workspace))
    mine = create_comment(db_session, task, member)
    create_comment(db_session, other_task, member)
    create_comment(db_session, other_project_task, member)
    log_in(client, member)

    assert comment_ids(get_page(client, task.id)["items"]) == [str(mine.id)]


@pytest.mark.parametrize(
    ("total", "limit", "sizes"),
    [
        (7, 3, [3, 3, 1]),
        # A full last page still ends the walk: its next_cursor is null.
        (6, 3, [3, 3]),
        (1, 1, [1]),
        (3, 1, [1, 1, 1]),
        (0, 5, [0]),
        (5, 100, [5]),
    ],
)
def test_pages_hold_limit_items_and_the_last_has_no_cursor(
    client: TestClient,
    db_session: Session,
    member: User,
    task: Task,
    total: int,
    limit: int,
    sizes: list[int],
) -> None:
    comments = [create_comment(db_session, task, member, created_at=at(n)) for n in range(total)]
    log_in(client, member)

    pages = all_pages(client, task.id, limit=limit)

    assert [len(page) for page in pages] == sizes
    assert [cid for page in pages for cid in comment_ids(page)] == thread_order(comments)


def test_default_limit_is_20(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    comments = [create_comment(db_session, task, member, created_at=at(n)) for n in range(25)]
    log_in(client, member)

    first = get_page(client, task.id)
    second = get_page(client, task.id, cursor=first["next_cursor"])

    assert len(first["items"]) == 20
    assert isinstance(first["next_cursor"], str)
    assert len(second["items"]) == 5
    assert second["next_cursor"] is None
    assert comment_ids(first["items"] + second["items"]) == thread_order(comments)


def test_limit_can_be_100(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    comments = [create_comment(db_session, task, member, created_at=at(n)) for n in range(101)]
    log_in(client, member)

    pages = all_pages(client, task.id, limit=100)

    assert [len(page) for page in pages] == [100, 1]
    assert [cid for page in pages for cid in comment_ids(page)] == thread_order(comments)


def test_cursor_continuity_when_all_timestamps_are_equal(
    client: TestClient, member: User, task: Task
) -> None:
    """The database clock is frozen for the test's transaction, so comments posted through the
    API share `created_at` and only the id orders them."""
    log_in(client, member)
    created = [post_comment(client, task.id, f"Comment {n}") for n in range(7)]
    assert len({comment["created_at"] for comment in created}) == 1

    pages = all_pages(client, task.id, limit=2)

    assert [len(page) for page in pages] == [2, 2, 2, 1]
    expected = sorted((comment["id"] for comment in created), key=UUID)
    assert [cid for page in pages for cid in comment_ids(page)] == expected


def test_cursor_continuity_when_a_tie_spans_page_boundaries(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    comments = [
        create_comment(db_session, task, member, created_at=at(-1)),
        *[create_comment(db_session, task, member, created_at=at(0)) for _ in range(5)],
        create_comment(db_session, task, member, created_at=at(1)),
    ]
    log_in(client, member)

    pages = all_pages(client, task.id, limit=3)

    assert [len(page) for page in pages] == [3, 3, 1]
    assert [cid for page in pages for cid in comment_ids(page)] == thread_order(comments)


def test_a_cursor_survives_the_deletion_of_its_comment(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    comments = [create_comment(db_session, task, member, created_at=at(n)) for n in range(5)]
    order = thread_order(comments)
    log_in(client, member)
    first = get_page(client, task.id, limit=2)

    assert client.delete(comment_url(order[1])).status_code == 204
    second = get_page(client, task.id, limit=2, cursor=first["next_cursor"])

    assert comment_ids(second["items"]) == order[2:4]


def test_comments_posted_while_paging_appear_on_a_later_page(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    comments = [create_comment(db_session, task, member, created_at=at(n)) for n in range(3)]
    log_in(client, member)
    first = get_page(client, task.id, limit=2)

    new = post_comment(client, task.id, "Latest")
    second = get_page(client, task.id, limit=2, cursor=first["next_cursor"])

    assert comment_ids(first["items"]) == thread_order(comments)[:2]
    assert comment_ids(second["items"]) == [thread_order(comments)[2], new["id"]]
    assert second["next_cursor"] is None


def test_a_cursor_past_the_end_gives_an_empty_last_page(
    client: TestClient, db_session: Session, member: User, task: Task
) -> None:
    create_comment(db_session, task, member, created_at=at(0))
    log_in(client, member)
    cursor = Cursor(created_at=at(1), id=uuid4()).encode()

    assert get_page(client, task.id, cursor=cursor) == {"items": [], "next_cursor": None}


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).rstrip(b"=").decode()


VALID_ID = "50000000-0000-4000-8000-000000000001"


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "not-a-cursor",
        "!!!!",
        "é",
        _b64("not json"),
        _b64("[]"),
        _b64('"2026-11-22T09:30:00Z"'),
        _b64('{"c": "2026-11-22T09:30:00Z"}'),
        _b64(f'{{"id": "{VALID_ID}"}}'),
        _b64(f'{{"c": "yesterday", "id": "{VALID_ID}"}}'),
        # No time zone.
        _b64(f'{{"c": "2026-11-22T09:30:00", "id": "{VALID_ID}"}}'),
        _b64('{"c": "2026-11-22T09:30:00Z", "id": "50000000"}'),
        _b64('{"c": 1, "id": 2}'),
    ],
)
def test_an_invalid_cursor_is_a_validation_error(
    client: TestClient, member: User, task: Task, cursor: str
) -> None:
    log_in(client, member)

    response = client.get(comments_url(task.id), params={"cursor": cursor})

    assert validation_fields(response) == {("cursor", "query")}


@pytest.mark.parametrize("limit", ["0", "-1", "101", "abc", "1.5"])
def test_an_invalid_limit_is_a_validation_error(
    client: TestClient, member: User, task: Task, limit: str
) -> None:
    log_in(client, member)

    response = client.get(comments_url(task.id), params={"limit": limit})

    assert validation_fields(response) == {("limit", "query")}


def test_limit_above_100_names_the_maximum(client: TestClient, member: User, task: Task) -> None:
    log_in(client, member)

    response = client.get(comments_url(task.id), params={"limit": 101})

    error = response.json()["error"]["details"]["errors"][0]
    assert error["message"] == "Input should be less than or equal to 100"


# --- archived projects --------------------------------------------------------------------


@pytest.fixture
def archived_task(db_session: Session, team: Team) -> Task:
    project = create_project(db_session, team.workspace, key="OLD", archived_at=ARCHIVED_AT)
    return create_task(db_session, project, title="Old task")


@pytest.mark.parametrize("role", WRITERS)
def test_comments_of_an_archived_project_cannot_be_created_or_edited(
    client: TestClient, db_session: Session, team: Team, archived_task: Task, role: Role
) -> None:
    author = team.users[role]
    own = create_comment(db_session, archived_task, author, body="Before the archive")
    log_in(client, author)
    before = get_page(client, archived_task.id)

    attempts = [
        client.post(comments_url(archived_task.id), json={"body": "Too late"}),
        client.patch(comment_url(own.id), json={"body": "Edited"}),
        # Any body, even an empty one.
        client.patch(comment_url(own.id), json={}),
    ]

    for response in attempts:
        assert_error(response, 409, "conflict", reason="project_archived", message=ARCHIVED_MESSAGE)
    assert get_page(client, archived_task.id) == before


def test_comments_of_an_archived_project_can_still_be_read_and_deleted(
    client: TestClient, db_session: Session, team: Team, member: User, archived_task: Task
) -> None:
    own = create_comment(db_session, archived_task, member, created_at=at(0))
    someone_elses = create_comment(db_session, archived_task, team.other_member, created_at=at(1))
    log_in(client, team.users[Role.VIEWER])
    assert comment_ids(get_page(client, archived_task.id)["items"]) == thread_order(
        [own, someone_elses]
    )

    log_in(client, member)
    assert client.delete(comment_url(own.id)).status_code == 204
    log_in(client, team.users[Role.ADMIN])
    assert client.delete(comment_url(someone_elses.id)).status_code == 204
    assert get_page(client, archived_task.id)["items"] == []


def test_in_an_archived_project_403_and_422_come_before_409(
    client: TestClient, db_session: Session, team: Team, member: User, archived_task: Task
) -> None:
    own = create_comment(db_session, archived_task, member)
    someone_elses = create_comment(db_session, archived_task, team.other_member)

    log_in(client, team.users[Role.VIEWER])
    viewer_create = client.post(comments_url(archived_task.id), json={"body": "Hi"})
    assert_error(viewer_create, 403, "forbidden", reason="insufficient_role")

    log_in(client, member)
    invalid_create = client.post(comments_url(archived_task.id), json={"body": ""})
    assert validation_fields(invalid_create) == {("body", "body")}
    invalid_edit = client.patch(comment_url(own.id), json={"body": None})
    assert validation_fields(invalid_edit) == {("body", "body")}
    not_author = client.patch(comment_url(someone_elses.id), json={"body": "Mine now"})
    assert_error(not_author, 403, "forbidden", reason="not_author")


# --- cascades ---------------------------------------------------------------------------


def test_deleting_a_task_deletes_its_comments(
    client: TestClient,
    db_session: Session,
    team: Team,
    member: User,
    project: Project,
    task: Task,
) -> None:
    other_task = create_task(db_session, project)
    gone = [create_comment(db_session, task, member) for _ in range(3)]
    kept = create_comment(db_session, other_task, member)
    log_in(client, team.owner)

    assert client.delete(task_url(task.id)).status_code == 204

    remaining = db_session.scalars(
        select(Comment.id).where(Comment.task_id.in_([task.id, other_task.id]))
    ).all()
    assert remaining == [kept.id]
    for comment in gone:
        response = client.delete(comment_url(comment.id))
        assert_error(response, 404, "not_found", message="Comment not found")
    assert_error(client.get(comments_url(task.id)), 404, "not_found", message="Task not found")


def test_deleting_a_workspace_deletes_its_comments(
    client: TestClient, db_session: Session, team: Team, member: User, task: Task
) -> None:
    other = create_team(db_session)
    other_task = create_task(db_session, create_project(db_session, other.workspace))
    create_comment(db_session, task, member)
    kept = create_comment(db_session, other_task, other.owner)
    log_in(client, team.owner)

    assert client.delete(f"/api/workspaces/{team.workspace.id}").status_code == 204

    workspace_ids = [team.workspace.id, other.workspace.id]
    remaining = db_session.scalars(
        select(Comment.id).where(Comment.workspace_id.in_(workspace_ids))
    ).all()
    assert remaining == [kept.id]
