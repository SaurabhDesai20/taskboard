"""Every mutation records its activity entries, exactly as contract section 3.8 lists them.

One test per action (the entry's action, entity, project/task ids, actor and metadata), a PATCH
that writes several entries, and the no-op requests that write none. The factories write no
activity, so every feed starts empty.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.services.permissions import Role
from tests.api.activity_helpers import expected, feed, project_ref, task_ref, user_ref
from tests.api.comment_helpers import comment_url, comments_url, post_comment
from tests.api.task_helpers import Json, move_task, move_url, patch_task, task_url, tasks_url
from tests.factories import (
    Team,
    create_comment,
    create_project,
    create_task,
    create_team,
    create_user,
    log_in,
)


@pytest.fixture
def team(db_session: Session) -> Team:
    return create_team(db_session)


@pytest.fixture
def project(db_session: Session, team: Team) -> Project:
    return create_project(
        db_session, team.workspace, name="Website", key="WEB", description="Marketing site"
    )


@pytest.fixture
def task(db_session: Session, project: Project) -> Task:
    # WEB-1, todo, medium priority, no description, assignee or due date.
    return create_task(db_session, project, title="Fix login redirect")


def members_url(team: Team) -> str:
    return f"/api/workspaces/{team.workspace.id}/members"


def task_entry(team: Team, task: Task | Json, project: Project, **kwargs: Any) -> Json:
    task_id = task.id if isinstance(task, Task) else task["id"]
    return expected(
        workspace_id=team.workspace.id,
        project_id=project.id,
        task_id=task_id,
        entity_id=task_id,
        **kwargs,
    )


# --- workspaces ---------------------------------------------------------------------------


def test_workspace_created(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, name="Asha Rao")
    log_in(client, user)

    response = client.post("/api/workspaces", json={"name": "  Acme  "})

    assert response.status_code == 201, response.text
    workspace_id = response.json()["id"]
    assert feed(client, workspace_id) == [
        expected(
            workspace_id=workspace_id,
            actor=user,
            action="workspace.created",
            entity_id=workspace_id,
            metadata={"name": "Acme"},
        )
    ]


def test_workspace_renamed(client: TestClient, team: Team) -> None:
    old_name = team.workspace.name
    log_in(client, team.owner)

    response = client.patch(f"/api/workspaces/{team.workspace.id}", json={"name": "Acme Inc"})

    assert response.status_code == 200, response.text
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            actor=team.owner,
            action="workspace.renamed",
            entity_id=team.workspace.id,
            metadata={"before": {"name": old_name}, "after": {"name": "Acme Inc"}},
        )
    ]


# --- members ------------------------------------------------------------------------------


def test_member_added(client: TestClient, db_session: Session, team: Team) -> None:
    ben = create_user(db_session, name="Ben Okafor", email="ben@example.com")
    admin = team.users[Role.ADMIN]
    log_in(client, admin)

    response = client.post(members_url(team), json={"email": "BEN@example.com", "role": "viewer"})

    assert response.status_code == 201, response.text
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            actor=admin,
            action="member.added",
            entity_id=ben.id,
            metadata={"user": user_ref(ben), "role": "viewer"},
        )
    ]


@pytest.mark.parametrize("leaving", [False, True], ids=["removed", "left"])
def test_member_removed(client: TestClient, team: Team, leaving: bool) -> None:
    target = team.users[Role.MEMBER]
    actor = target if leaving else team.users[Role.ADMIN]
    log_in(client, actor)

    response = client.delete(f"{members_url(team)}/{target.id}")

    assert response.status_code == 204, response.text
    # Someone who left can no longer read the feed.
    log_in(client, team.owner)
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            actor=actor,
            action="member.removed",
            entity_id=target.id,
            metadata={"user": user_ref(target), "role": "member", "self_removal": leaving},
        )
    ]


def test_member_role_changed(client: TestClient, team: Team) -> None:
    target = team.users[Role.MEMBER]
    log_in(client, team.owner)

    response = client.patch(f"{members_url(team)}/{target.id}", json={"role": "admin"})

    assert response.status_code == 200, response.text
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            actor=team.owner,
            action="member.role_changed",
            entity_id=target.id,
            metadata={
                "user": user_ref(target),
                "before": {"role": "member"},
                "after": {"role": "admin"},
            },
        )
    ]


# --- projects -----------------------------------------------------------------------------


def test_project_created(client: TestClient, team: Team) -> None:
    admin = team.users[Role.ADMIN]
    log_in(client, admin)

    response = client.post(
        f"/api/workspaces/{team.workspace.id}/projects",
        json={"name": " Mobile app ", "key": "APP", "description": "iOS and Android"},
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=created["id"],
            actor=admin,
            action="project.created",
            entity_id=created["id"],
            metadata={"project": {"id": created["id"], "name": "Mobile app", "key": "APP"}},
        )
    ]


@pytest.mark.parametrize(
    ("body", "changed_fields", "before", "after"),
    [
        (
            {"name": "Website v2", "description": "New copy"},
            ["name", "description"],
            {"name": "Website"},
            {"name": "Website v2"},
        ),
        ({"name": "Website v2"}, ["name"], {"name": "Website"}, {"name": "Website v2"}),
        # The description is named but never copied into before/after.
        ({"description": None}, ["description"], {}, {}),
        ({"name": "Website", "description": "New copy"}, ["description"], {}, {}),
    ],
)
def test_project_updated(
    client: TestClient,
    team: Team,
    project: Project,
    body: Json,
    changed_fields: list[str],
    before: Json,
    after: Json,
) -> None:
    log_in(client, team.owner)

    response = client.patch(f"/api/projects/{project.id}", json=body)

    assert response.status_code == 200, response.text
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=project.id,
            actor=team.owner,
            action="project.updated",
            entity_id=project.id,
            # The project as it is after the update.
            metadata={
                "project": project_ref(response.json()),
                "changed_fields": changed_fields,
                "before": before,
                "after": after,
            },
        )
    ]


def test_project_archived(client: TestClient, team: Team, project: Project) -> None:
    admin = team.users[Role.ADMIN]
    log_in(client, admin)

    response = client.post(f"/api/projects/{project.id}/archive")

    assert response.status_code == 200, response.text
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=project.id,
            actor=admin,
            action="project.archived",
            entity_id=project.id,
            metadata={"project": {"id": str(project.id), "name": "Website", "key": "WEB"}},
        )
    ]


# --- tasks --------------------------------------------------------------------------------


def test_task_created(client: TestClient, team: Team, project: Project, task: Task) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)

    response = client.post(
        tasks_url(project.id),
        # The assignee and due date are part of the creation, not separate entries.
        json={
            "title": "Write onboarding copy",
            "status": "in_review",
            "assignee_id": str(member.id),
            "due_date": "2026-12-01",
        },
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert feed(client, team.workspace.id) == [
        task_entry(
            team,
            created,
            project,
            actor=member,
            action="task.created",
            metadata={
                "task": {"id": created["id"], "key": "WEB-2", "title": "Write onboarding copy"},
                "status": "in_review",
            },
        )
    ]


@pytest.mark.parametrize(
    ("body", "changed_fields", "before", "after"),
    [
        (
            {"title": "Fix login", "priority": "high"},
            ["title", "priority"],
            {"title": "Fix login redirect", "priority": "medium"},
            {"title": "Fix login", "priority": "high"},
        ),
        ({"description": "Users land on /404."}, ["description"], {}, {}),
        # Fields sent with their current value are not changes.
        (
            {"title": "Fix login redirect", "priority": "urgent"},
            ["priority"],
            {"priority": "medium"},
            {"priority": "urgent"},
        ),
    ],
)
def test_task_updated(
    client: TestClient,
    team: Team,
    project: Project,
    task: Task,
    body: Json,
    changed_fields: list[str],
    before: Json,
    after: Json,
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)

    updated = patch_task(client, task.id, body)

    assert feed(client, team.workspace.id) == [
        task_entry(
            team,
            task,
            project,
            actor=member,
            action="task.updated",
            # The task as it is after the update.
            metadata={
                "task": task_ref(updated, project),
                "changed_fields": changed_fields,
                "before": before,
                "after": after,
            },
        )
    ]


def test_task_moved_to_another_column(
    client: TestClient, team: Team, project: Project, task: Task
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)

    move_task(client, task.id, "in_review")

    assert feed(client, team.workspace.id) == [
        task_entry(
            team,
            task,
            project,
            actor=member,
            action="task.moved",
            metadata={
                "task": task_ref(task, project),
                "before": {"status": "todo"},
                "after": {"status": "in_review"},
            },
        )
    ]


def test_task_reordered_within_its_column(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    below = create_task(db_session, project, title="Below")
    member = team.users[Role.MEMBER]
    log_in(client, member)

    move_task(client, task.id, "todo", after=below.id)

    assert feed(client, team.workspace.id) == [
        task_entry(
            team,
            task,
            project,
            actor=member,
            action="task.moved",
            metadata={
                "task": task_ref(task, project),
                "before": {"status": "todo"},
                "after": {"status": "todo"},
            },
        )
    ]


def test_task_status_change_through_patch_is_a_move(
    client: TestClient, team: Team, project: Project, task: Task
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)

    patch_task(client, task.id, {"status": "done"})

    assert feed(client, team.workspace.id) == [
        task_entry(
            team,
            task,
            project,
            actor=member,
            action="task.moved",
            metadata={
                "task": task_ref(task, project),
                "before": {"status": "todo"},
                "after": {"status": "done"},
            },
        )
    ]


def test_task_assigned_and_unassigned(
    client: TestClient, team: Team, project: Project, task: Task
) -> None:
    member, ben = team.users[Role.MEMBER], team.other_member
    log_in(client, member)

    patch_task(client, task.id, {"assignee_id": str(ben.id)})
    patch_task(client, task.id, {"assignee_id": None})

    ref = task_ref(task, project)
    assert feed(client, team.workspace.id) == [
        task_entry(
            team,
            task,
            project,
            actor=member,
            action="task.assigned",
            metadata={
                "task": ref,
                "before": {"assignee": user_ref(ben)},
                "after": {"assignee": None},
            },
        ),
        task_entry(
            team,
            task,
            project,
            actor=member,
            action="task.assigned",
            metadata={
                "task": ref,
                "before": {"assignee": None},
                "after": {"assignee": user_ref(ben)},
            },
        ),
    ]


def test_task_reassigned_from_someone_who_left(
    client: TestClient, team: Team, project: Project, db_session: Session
) -> None:
    """The previous assignee is still named after leaving the workspace."""
    gone = team.other_member
    task = create_task(db_session, project, assignee=gone)
    log_in(client, team.owner)
    assert client.delete(f"{members_url(team)}/{gone.id}").status_code == 204
    viewer = team.users[Role.VIEWER]

    patch_task(client, task.id, {"assignee_id": str(viewer.id)})

    newest = feed(client, team.workspace.id)[0]
    assert newest["action"] == "task.assigned"
    assert newest["metadata"]["before"] == {"assignee": user_ref(gone)}
    assert newest["metadata"]["after"] == {"assignee": user_ref(viewer)}


@pytest.mark.parametrize(
    ("initial", "body", "before", "after"),
    [
        (None, {"due_date": "2026-12-01"}, None, "2026-12-01"),
        ("2026-12-01", {"due_date": "2026-12-24"}, "2026-12-01", "2026-12-24"),
        ("2026-12-01", {"due_date": None}, "2026-12-01", None),
    ],
)
def test_task_due_date_changed(
    client: TestClient,
    team: Team,
    project: Project,
    task: Task,
    initial: str | None,
    body: Json,
    before: str | None,
    after: str | None,
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)
    if initial is not None:
        patch_task(client, task.id, {"due_date": initial})

    patch_task(client, task.id, body)

    assert feed(client, team.workspace.id)[0] == task_entry(
        team,
        task,
        project,
        actor=member,
        action="task.due_date_changed",
        metadata={
            "task": task_ref(task, project),
            "before": {"due_date": before},
            "after": {"due_date": after},
        },
    )


def test_task_deleted(client: TestClient, team: Team, project: Project, task: Task) -> None:
    admin = team.users[Role.ADMIN]
    ref = task_ref(task, project)
    log_in(client, admin)

    assert client.delete(task_url(task.id)).status_code == 204

    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=project.id,
            # The task is gone, so the entry no longer points at it; the snapshot names it.
            task_id=None,
            actor=admin,
            action="task.deleted",
            entity_id=task.id,
            metadata={"task": ref},
        )
    ]


# --- comments -----------------------------------------------------------------------------

LONG_BODY = ("Reproduced on Chrome and Firefox. " * 6).strip()


@pytest.mark.parametrize(
    ("body", "excerpt"),
    [
        ("  Reproduced on Chrome.  ", "Reproduced on Chrome."),
        (LONG_BODY, LONG_BODY[:140]),
        ("x" * 140, "x" * 140),
    ],
)
def test_comment_created(
    client: TestClient, team: Team, project: Project, task: Task, body: str, excerpt: str
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)

    created = post_comment(client, task.id, body)

    assert len(excerpt) <= 140
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=project.id,
            task_id=task.id,
            actor=member,
            action="comment.created",
            entity_id=created["id"],
            metadata={"task": task_ref(task, project), "excerpt": excerpt},
        )
    ]


def test_comment_edited(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    member = team.users[Role.MEMBER]
    comment = create_comment(db_session, task, member, body="First draft")
    log_in(client, member)

    response = client.patch(comment_url(comment.id), json={"body": LONG_BODY})

    assert response.status_code == 200, response.text
    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=project.id,
            task_id=task.id,
            actor=member,
            action="comment.edited",
            entity_id=comment.id,
            metadata={"task": task_ref(task, project), "excerpt": LONG_BODY[:140]},
        )
    ]


def test_comment_deleted(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    comment = create_comment(db_session, task, team.users[Role.MEMBER])
    admin = team.users[Role.ADMIN]
    log_in(client, admin)

    assert client.delete(comment_url(comment.id)).status_code == 204

    assert feed(client, team.workspace.id) == [
        expected(
            workspace_id=team.workspace.id,
            project_id=project.id,
            task_id=task.id,
            actor=admin,
            action="comment.deleted",
            entity_id=comment.id,
            metadata={"task": task_ref(task, project)},
        )
    ]


# --- one request, several entries ---------------------------------------------------------


def test_one_patch_records_one_entry_per_kind_of_change(
    client: TestClient, team: Team, project: Project, task: Task
) -> None:
    member, ben = team.users[Role.MEMBER], team.other_member
    log_in(client, member)

    patch_task(
        client,
        task.id,
        {
            "title": "Fix login",
            "description": "Users land on /404.",
            "priority": "urgent",
            "assignee_id": str(ben.id),
            "due_date": "2026-12-03",
            "status": "in_review",
        },
    )

    # Every entry names the task as it is after the request. Newest first: the entries were
    # written in the order task.updated, task.assigned, task.due_date_changed, task.moved.
    ref = task_ref(task, project, title="Fix login")

    def entry(action: str, metadata: Json) -> Json:
        return task_entry(
            team, task, project, actor=member, action=action, metadata={"task": ref, **metadata}
        )

    assert feed(client, team.workspace.id) == [
        entry("task.moved", {"before": {"status": "todo"}, "after": {"status": "in_review"}}),
        entry(
            "task.due_date_changed",
            {"before": {"due_date": None}, "after": {"due_date": "2026-12-03"}},
        ),
        entry(
            "task.assigned", {"before": {"assignee": None}, "after": {"assignee": user_ref(ben)}}
        ),
        entry(
            "task.updated",
            {
                "changed_fields": ["title", "description", "priority"],
                "before": {"title": "Fix login redirect", "priority": "medium"},
                "after": {"title": "Fix login", "priority": "urgent"},
            },
        ),
    ]


def test_each_request_writes_its_own_entries(
    client: TestClient, team: Team, project: Project, task: Task
) -> None:
    member = team.users[Role.MEMBER]
    log_in(client, member)

    patch_task(client, task.id, {"title": "One"})
    patch_task(client, task.id, {"title": "Two", "priority": "low"})

    entries = feed(client, team.workspace.id)
    assert [(e["action"], e["metadata"]["changed_fields"]) for e in entries] == [
        ("task.updated", ["title", "priority"]),
        ("task.updated", ["title"]),
    ]
    # Each snapshot is the title at the time of its request.
    assert [e["metadata"]["task"]["title"] for e in entries] == ["Two", "One"]


# --- no-ops record nothing ----------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {
            "title": "  Fix login redirect ",
            "description": None,
            "status": "todo",
            "priority": "medium",
            "assignee_id": None,
            "due_date": None,
        },
    ],
)
def test_a_no_op_task_patch_records_nothing(
    client: TestClient, team: Team, task: Task, body: Json
) -> None:
    log_in(client, team.users[Role.MEMBER])

    patch_task(client, task.id, body)

    assert feed(client, team.workspace.id) == []


@pytest.mark.parametrize("body", [{}, {"name": "Website", "description": "Marketing site"}])
def test_a_no_op_project_patch_records_nothing(
    client: TestClient, team: Team, project: Project, body: Json
) -> None:
    log_in(client, team.owner)

    assert client.patch(f"/api/projects/{project.id}", json=body).status_code == 200

    assert feed(client, team.workspace.id) == []


def test_a_no_op_workspace_patch_records_nothing(client: TestClient, team: Team) -> None:
    log_in(client, team.owner)
    url = f"/api/workspaces/{team.workspace.id}"

    for body in ({}, {"name": team.workspace.name}):
        assert client.patch(url, json=body).status_code == 200

    assert feed(client, team.workspace.id) == []


def test_a_no_op_role_change_records_nothing(client: TestClient, team: Team) -> None:
    log_in(client, team.owner)
    url = f"{members_url(team)}/{team.users[Role.MEMBER].id}"

    for body in ({}, {"role": "member"}):
        assert client.patch(url, json=body).status_code == 200

    assert feed(client, team.workspace.id) == []


def test_a_no_op_comment_edit_records_nothing(
    client: TestClient, db_session: Session, team: Team, task: Task
) -> None:
    member = team.users[Role.MEMBER]
    comment = create_comment(db_session, task, member, body="Same")
    log_in(client, member)

    for body in ({}, {"body": "  Same  "}):
        assert client.patch(comment_url(comment.id), json=body).status_code == 200

    assert feed(client, team.workspace.id) == []


def test_a_move_to_the_same_place_records_nothing(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    below = create_task(db_session, project, title="Below")
    log_in(client, team.users[Role.MEMBER])

    # Already directly above `below`, and `below` is already last.
    move_task(client, task.id, "todo", before=below.id)
    move_task(client, below.id, "todo", after=task.id)
    move_task(client, below.id, "todo")

    assert feed(client, team.workspace.id) == []


def test_a_move_after_its_own_upper_neighbour_records_nothing(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    """Same column, same neighbours: the order does not change, so it is not a move."""
    middle = create_task(db_session, project, title="Middle")
    create_task(db_session, project, title="Last")
    log_in(client, team.users[Role.MEMBER])

    response = client.post(
        move_url(middle.id), json={"status": TaskStatus.TODO.value, "after_task_id": str(task.id)}
    )

    assert response.status_code == 200, response.text
    assert feed(client, team.workspace.id) == []


def test_reading_records_nothing(
    client: TestClient, db_session: Session, team: Team, project: Project, task: Task
) -> None:
    create_comment(db_session, task, team.owner)
    log_in(client, team.owner)

    for url in (
        "/api/workspaces",
        f"/api/workspaces/{team.workspace.id}",
        members_url(team),
        f"/api/workspaces/{team.workspace.id}/projects",
        f"/api/projects/{project.id}",
        tasks_url(project.id),
        task_url(task.id),
        comments_url(task.id),
        "/api/me/tasks",
    ):
        assert client.get(url).status_code == 200, url

    assert feed(client, team.workspace.id) == []


def test_another_team_is_unaffected(client: TestClient, db_session: Session, team: Team) -> None:
    other = create_team(db_session)
    log_in(client, team.owner)

    client.patch(f"/api/workspaces/{team.workspace.id}", json={"name": "Renamed"})

    log_in(client, other.owner)
    assert feed(client, other.workspace.id) == []
