"""The single write path for activity entries: app.services.activity.record()."""

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.activity import ActivityAction, ActivityEntityType, ActivityLog
from app.models.task import TaskStatus
from app.services import activity
from tests.factories import create_project, create_task, create_team


@pytest.mark.parametrize("action", list(ActivityAction))
def test_every_action_belongs_to_the_entity_type_before_its_dot(action: ActivityAction) -> None:
    assert action.entity_type == ActivityEntityType(action.value.split(".")[0])


def test_record_stores_metadata_as_json_in_the_current_transaction(db_session: Session) -> None:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace, key="WEB")
    task = create_task(db_session, project, title="Fix login redirect")

    activity.record_task(
        db_session,
        team.owner.id,
        ActivityAction.TASK_DUE_DATE_CHANGED,
        task,
        project,
        {
            "before": {"due_date": None, "status": TaskStatus.TODO},
            "after": {"due_date": date(2026, 12, 1), "assignee": activity.user_ref(team.owner)},
        },
    )

    # Flushed, not committed: visible to this transaction only.
    entry = db_session.scalars(
        select(ActivityLog).where(ActivityLog.workspace_id == team.workspace.id)
    ).one()
    db_session.refresh(entry)
    assert (entry.action, entry.entity_type, entry.entity_id) == (
        ActivityAction.TASK_DUE_DATE_CHANGED,
        ActivityEntityType.TASK,
        task.id,
    )
    assert (entry.project_id, entry.task_id, entry.actor_id) == (project.id, task.id, team.owner.id)
    assert entry.metadata_ == {
        "task": {"id": str(task.id), "key": "WEB-1", "title": "Fix login redirect"},
        "before": {"due_date": None, "status": "todo"},
        "after": {
            "due_date": "2026-12-01",
            "assignee": {"id": str(team.owner.id), "name": "Olivia Owner"},
        },
    }


def test_excerpt_is_the_first_140_characters() -> None:
    assert activity.excerpt("short") == "short"
    assert activity.excerpt("a" * 139 + "bc") == "a" * 139 + "b"
