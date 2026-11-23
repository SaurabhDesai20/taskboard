"""GET /workspaces/{wid}/activity: shape, order, pagination, filters, access and isolation, and
entries outliving their task, project or workspace (contract sections 1.6 and 3.8)."""

import base64
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.activity import ActivityLog
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.schemas.pagination import Cursor
from app.services.permissions import Role
from tests.api.activity_helpers import (
    activity_url,
    all_pages,
    entry_ids,
    feed,
    feed_order,
    get_page,
    stored_count,
)
from tests.api.comment_helpers import post_comment
from tests.api.helpers import assert_error, validation_fields
from tests.api.task_helpers import patch_task, task_url
from tests.factories import (
    Team,
    create_activity,
    create_project,
    create_task,
    create_team,
    log_in,
)

# Long before the database clock, so API-written entries always sort before (newer than) these.
T0 = datetime(2020, 1, 1, 9, 0, tzinfo=UTC)


def at(minutes: float) -> datetime:
    return T0 + timedelta(minutes=minutes)


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


@pytest.fixture
def project(db_session: Session, team: Team) -> Project:
    return create_project(db_session, team.workspace, name="Website", key="WEB")


@pytest.fixture
def task(db_session: Session, project: Project) -> Task:
    return create_task(db_session, project, title="Fix login redirect")


@pytest.fixture
def viewer(client: TestClient, team: Team) -> User:
    """Logged in: the lowest role, which may read the feed."""
    user = team.users[Role.VIEWER]
    log_in(client, user)
    return user


# --- shape and order ----------------------------------------------------------------------


def test_a_workspace_without_activity_is_an_empty_last_page(
    client: TestClient, team: Team, viewer: User
) -> None:
    assert get_page(client, team.workspace.id) == {"items": [], "next_cursor": None}


def test_entry_shape(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task, viewer: User
) -> None:
    metadata = {"task": {"id": str(task.id), "key": "WEB-1", "title": "Fix login redirect"}}
    entry = create_activity(
        db_session,
        team.workspace,
        team.owner,
        project=project,
        task=task,
        metadata=metadata,
        created_at=at(0),
    )

    page = get_page(client, team.workspace.id)

    assert page["items"] == [
        {
            "id": str(entry.id),
            "workspace_id": str(team.workspace.id),
            "project_id": str(project.id),
            "task_id": str(task.id),
            "actor": {"id": str(team.owner.id), "name": "Olivia Owner"},
            "action": "task.updated",
            "entity_type": "task",
            "entity_id": str(task.id),
            "metadata": metadata,
            "created_at": "2020-01-01T09:00:00Z",
        }
    ]


@pytest.mark.parametrize("role", list(Role))
def test_every_role_can_read_the_feed(
    client: TestClient, db_session: Session, team: Team, role: Role
) -> None:
    entry = create_activity(db_session, team.workspace, team.owner)
    log_in(client, team.users[role])

    assert entry_ids(get_page(client, team.workspace.id)["items"]) == [str(entry.id)]


def test_newest_first_with_ties_in_descending_id_order(
    client: TestClient, db_session: Session, team: Team, viewer: User
) -> None:
    # Inserted out of order; two pairs share a timestamp.
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(m))
        for m in (5, 0, 1, 1, 5)
    ]

    page = get_page(client, team.workspace.id)

    assert entry_ids(page["items"]) == feed_order(entries)
    assert [item["created_at"] for item in page["items"]][::2] == [
        "2020-01-01T09:05:00Z",
        "2020-01-01T09:01:00Z",
        "2020-01-01T09:00:00Z",
    ]


def test_entries_written_through_the_api_list_newest_first(
    client: TestClient, team: Team, project: Project, task: Task
) -> None:
    """Each entry gets the real time it was written, even inside one transaction."""
    log_in(client, team.owner)
    patch_task(client, task.id, {"title": "One"})
    post_comment(client, task.id, "Two")
    patch_task(client, task.id, {"priority": "high"})

    page = get_page(client, team.workspace.id)

    assert [item["action"] for item in page["items"]] == [
        "task.updated",
        "comment.created",
        "task.updated",
    ]
    timestamps = [datetime.fromisoformat(item["created_at"]) for item in page["items"]]
    assert timestamps == sorted(timestamps, reverse=True)
    assert len(set(timestamps)) == 3


# --- pagination ---------------------------------------------------------------------------


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
    team: Team,
    viewer: User,
    total: int,
    limit: int,
    sizes: list[int],
) -> None:
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(n))
        for n in range(total)
    ]

    pages = all_pages(client, team.workspace.id, limit=limit)

    assert [len(page) for page in pages] == sizes
    assert [eid for page in pages for eid in entry_ids(page)] == feed_order(entries)


def test_default_limit_is_20(
    client: TestClient, db_session: Session, team: Team, viewer: User
) -> None:
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(n)) for n in range(25)
    ]

    first = get_page(client, team.workspace.id)
    second = get_page(client, team.workspace.id, cursor=first["next_cursor"])

    assert len(first["items"]) == 20
    assert isinstance(first["next_cursor"], str)
    assert len(second["items"]) == 5
    assert second["next_cursor"] is None
    assert entry_ids(first["items"] + second["items"]) == feed_order(entries)


def test_limit_can_be_100(
    client: TestClient, db_session: Session, team: Team, viewer: User
) -> None:
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(n))
        for n in range(101)
    ]

    pages = all_pages(client, team.workspace.id, limit=100)

    assert [len(page) for page in pages] == [100, 1]
    assert [eid for page in pages for eid in entry_ids(page)] == feed_order(entries)


def test_cursor_continuity_when_a_tie_spans_page_boundaries(
    client: TestClient, db_session: Session, team: Team, viewer: User
) -> None:
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(1)),
        *[
            create_activity(db_session, team.workspace, team.owner, created_at=at(0))
            for _ in range(5)
        ],
        create_activity(db_session, team.workspace, team.owner, created_at=at(-1)),
    ]

    pages = all_pages(client, team.workspace.id, limit=3)

    assert [len(page) for page in pages] == [3, 3, 1]
    assert [eid for page in pages for eid in entry_ids(page)] == feed_order(entries)


def test_a_cursor_survives_the_deletion_of_its_entry(
    client: TestClient, db_session: Session, team: Team, viewer: User
) -> None:
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(n)) for n in range(5)
    ]
    order = feed_order(entries)
    first = get_page(client, team.workspace.id, limit=2)

    db_session.execute(delete(ActivityLog).where(ActivityLog.id == UUID(order[1])))
    second = get_page(client, team.workspace.id, limit=2, cursor=first["next_cursor"])

    assert entry_ids(second["items"]) == order[2:4]


def test_entries_written_while_paging_appear_only_on_a_new_first_page(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    entries = [
        create_activity(db_session, team.workspace, team.owner, created_at=at(n)) for n in range(3)
    ]
    log_in(client, team.owner)
    first = get_page(client, team.workspace.id, limit=2)

    patch_task(client, task.id, {"title": "Newer"})
    second = get_page(client, team.workspace.id, limit=2, cursor=first["next_cursor"])

    assert entry_ids(first["items"] + second["items"]) == feed_order(entries)
    assert second["next_cursor"] is None
    assert get_page(client, team.workspace.id, limit=1)["items"][0]["action"] == "task.updated"


def test_a_cursor_past_the_end_gives_an_empty_last_page(
    client: TestClient, db_session: Session, team: Team, viewer: User
) -> None:
    create_activity(db_session, team.workspace, team.owner, created_at=at(0))
    cursor = Cursor(created_at=at(-1), id=uuid4()).encode()

    assert get_page(client, team.workspace.id, cursor=cursor) == {"items": [], "next_cursor": None}


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).rstrip(b"=").decode()


VALID_ID = "60000000-0000-4000-8000-000000000001"


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "not-a-cursor",
        _b64("[]"),
        _b64('{"c": "2026-11-22T09:30:00Z"}'),
        _b64(f'{{"c": "yesterday", "id": "{VALID_ID}"}}'),
        # No time zone.
        _b64(f'{{"c": "2026-11-22T09:30:00", "id": "{VALID_ID}"}}'),
    ],
)
def test_an_invalid_cursor_is_a_validation_error(
    client: TestClient, team: Team, viewer: User, cursor: str
) -> None:
    response = client.get(activity_url(team.workspace.id), params={"cursor": cursor})

    assert validation_fields(response) == {("cursor", "query")}


@pytest.mark.parametrize("limit", ["0", "-1", "101", "abc", "1.5"])
def test_an_invalid_limit_is_a_validation_error(
    client: TestClient, team: Team, viewer: User, limit: str
) -> None:
    response = client.get(activity_url(team.workspace.id), params={"limit": limit})

    assert validation_fields(response) == {("limit", "query")}


# --- filters ------------------------------------------------------------------------------


def test_filters_narrow_the_feed_and_combine(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task, viewer: User
) -> None:
    member = team.users[Role.MEMBER]
    other_task = create_task(db_session, project)
    other_project = create_project(db_session, team.workspace)
    workspace_entry = create_activity(db_session, team.workspace, team.owner, created_at=at(0))
    project_entry = create_activity(
        db_session, team.workspace, member, project=project, created_at=at(1)
    )
    task_by_owner = create_activity(
        db_session, team.workspace, team.owner, project=project, task=task, created_at=at(2)
    )
    task_by_member = create_activity(
        db_session, team.workspace, member, project=project, task=task, created_at=at(3)
    )
    other_task_entry = create_activity(
        db_session, team.workspace, member, project=project, task=other_task, created_at=at(4)
    )
    other_project_entry = create_activity(
        db_session, team.workspace, team.owner, project=other_project, created_at=at(5)
    )

    def ids(**params: object) -> list[str]:
        return entry_ids(get_page(client, team.workspace.id, **params)["items"])

    assert ids() == feed_order(
        [
            workspace_entry,
            project_entry,
            task_by_owner,
            task_by_member,
            other_task_entry,
            other_project_entry,
        ]
    )
    assert ids(project_id=project.id) == feed_order(
        [project_entry, task_by_owner, task_by_member, other_task_entry]
    )
    assert ids(task_id=task.id) == feed_order([task_by_owner, task_by_member])
    assert ids(actor_id=member.id) == feed_order([project_entry, task_by_member, other_task_entry])
    assert ids(task_id=task.id, actor_id=member.id) == [str(task_by_member.id)]
    assert ids(project_id=other_project.id, task_id=task.id) == []
    assert ids(actor_id=team.users[Role.VIEWER].id) == []


def test_filters_paginate(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task, viewer: User
) -> None:
    mine = [
        create_activity(
            db_session, team.workspace, team.owner, task=task, project=project, created_at=at(2 * n)
        )
        for n in range(5)
    ]
    for n in range(5):
        create_activity(db_session, team.workspace, team.owner, created_at=at(2 * n + 1))

    pages = all_pages(client, team.workspace.id, limit=2, task_id=task.id)

    assert [len(page) for page in pages] == [2, 2, 1]
    assert [eid for page in pages for eid in entry_ids(page)] == feed_order(mine)


@pytest.mark.parametrize("field", ["project_id", "task_id", "actor_id"])
def test_a_filter_on_an_unknown_id_matches_nothing(
    client: TestClient, db_session: Session, team: Team, viewer: User, field: str
) -> None:
    create_activity(db_session, team.workspace, team.owner)

    page = get_page(client, team.workspace.id, **{field: str(uuid4())})

    assert page == {"items": [], "next_cursor": None}


@pytest.mark.parametrize("field", ["project_id", "task_id", "actor_id"])
@pytest.mark.parametrize("value", ["not-a-uuid", "", "none", "12345"])
def test_a_malformed_filter_is_a_validation_error(
    client: TestClient, team: Team, viewer: User, field: str, value: str
) -> None:
    response = client.get(activity_url(team.workspace.id), params={field: value})

    assert validation_fields(response) == {(field, "query")}


# --- access and isolation -----------------------------------------------------------------


def test_another_workspaces_entries_never_appear(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task, viewer: User
) -> None:
    other = create_team(db_session)
    other_project = create_project(db_session, other.workspace)
    other_task = create_task(db_session, other_project)
    # A user who belongs to both workspaces acts in the other one.
    both = team.users[Role.MEMBER]
    create_activity(db_session, other.workspace, both, project=other_project, task=other_task)
    create_activity(db_session, other.workspace, other.owner)
    mine = create_activity(db_session, team.workspace, both, project=project, task=task)

    assert entry_ids(get_page(client, team.workspace.id)["items"]) == [str(mine.id)]
    # Filters on the other workspace's ids narrow to nothing: no 404, nothing leaks.
    for params in (
        {"project_id": other_project.id},
        {"task_id": other_task.id},
        {"actor_id": other.owner.id},
    ):
        assert get_page(client, team.workspace.id, **params) == {"items": [], "next_cursor": None}
    assert entry_ids(get_page(client, team.workspace.id, actor_id=both.id)["items"]) == [
        str(mine.id)
    ]


def test_a_non_member_gets_404_even_with_an_invalid_query(
    client: TestClient, db_session: Session, team: Team
) -> None:
    create_activity(db_session, team.workspace, team.owner)
    log_in(client, team.outsider)

    for params in ({}, {"cursor": "bad", "limit": "0", "task_id": "x"}):
        response = client.get(activity_url(team.workspace.id), params=params)
        assert_error(response, 404, "not_found", message="Workspace not found")


def test_a_member_who_left_no_longer_sees_the_feed(
    client: TestClient, db_session: Session, team: Team
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)
    assert (
        client.delete(f"/api/workspaces/{team.workspace.id}/members/{member.id}").status_code == 204
    )

    assert_error(client.get(activity_url(team.workspace.id)), 404, "not_found")


def test_an_unknown_workspace_is_404_and_a_malformed_id_is_422(
    client: TestClient, viewer: User
) -> None:
    assert_error(client.get(activity_url(uuid4())), 404, "not_found")
    assert validation_fields(client.get(activity_url("nope"))) == {("wid", "path")}


def test_the_feed_requires_a_session(client: TestClient, team: Team) -> None:
    assert_error(client.get(activity_url(team.workspace.id)), 401, "unauthorized")


# --- entries outlive what they describe ---------------------------------------------------


def test_a_tasks_entries_survive_its_deletion_without_a_task_id(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    task_id = task.id
    log_in(client, team.owner)
    patch_task(client, task_id, {"title": "Fix login"})
    comment = post_comment(client, task_id, "Seen on Safari too.")
    before = get_page(client, team.workspace.id, task_id=task_id)["items"]
    assert len(before) == 2

    assert client.delete(task_url(task_id)).status_code == 204
    # The database nulled task_id; read it like a new request would (the app shares this
    # session in tests).
    db_session.expire_all()

    after = get_page(client, team.workspace.id)["items"]
    assert [item["action"] for item in after] == ["task.deleted", "comment.created", "task.updated"]
    for old, new in zip(before, after[1:], strict=True):
        # Unchanged except for the nulled task id.
        assert new == {**old, "task_id": None}
    assert after[1]["entity_id"] == comment["id"]
    assert {item["project_id"] for item in after} == {str(project.id)}
    assert get_page(client, team.workspace.id, task_id=task_id)["items"] == []
    assert len(get_page(client, team.workspace.id, project_id=project.id)["items"]) == 3


def test_a_projects_entries_survive_its_deletion_without_ids(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    """The API never deletes projects (only archives them), so delete the row directly."""
    project_id = project.id
    log_in(client, team.owner)
    assert (
        client.patch(f"/api/projects/{project_id}", json={"name": "Website v2"}).status_code == 200
    )
    patch_task(client, task.id, {"priority": "high"})

    # Cascades to the task; nulls both ids of the entries.
    db_session.execute(delete(Project).where(Project.id == project_id))
    db_session.expire_all()

    entries = feed(client, team.workspace.id)
    assert [(e["action"], e["project_id"], e["task_id"]) for e in entries] == [
        ("task.updated", None, None),
        ("project.updated", None, None),
    ]
    assert entries[1]["metadata"]["project"] == {
        "id": str(project_id),
        "name": "Website v2",
        "key": "WEB",
    }
    assert entries[0]["metadata"]["task"]["key"] == "WEB-1"


def test_deleting_a_workspace_deletes_its_activity(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    other = create_team(db_session)
    kept = create_activity(db_session, other.workspace, other.owner)
    log_in(client, team.owner)
    patch_task(client, task.id, {"title": "Soon gone"})
    assert stored_count(db_session, team.workspace.id) == 1

    assert client.delete(f"/api/workspaces/{team.workspace.id}").status_code == 204

    assert stored_count(db_session, team.workspace.id) == 0
    assert db_session.scalars(select(ActivityLog.id).where(ActivityLog.id == kept.id)).all() == [
        kept.id
    ]
