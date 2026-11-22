"""Project rules that only concurrent requests can reach through the API."""

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.models.project import Project
from app.services import projects as projects_service
from app.services.access import project_access
from tests.factories import create_project, create_team


def test_archive_loses_to_a_concurrent_archive(db_session: Session) -> None:
    """Two admins archive at once. The second request resolved its access before the first
    committed, so its in-memory project still looks active; the conditional UPDATE decides."""
    team = create_team(db_session)
    project = create_project(db_session, team.workspace)
    stale = project_access(db_session, project.id, team.owner.id, "project.manage")
    # The first request's archive, behind the second request's back.
    db_session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(archived_at=func.now())
        .execution_options(synchronize_session=False)
    )
    first_archived_at = db_session.scalar(
        select(Project.archived_at).where(Project.id == project.id)
    )
    assert first_archived_at is not None
    assert stale.project.archived_at is None

    with pytest.raises(Conflict) as exc_info:
        projects_service.archive(db_session, stale)

    assert exc_info.value.details == {"reason": "already_archived"}
    assert exc_info.value.message == "This project is already archived"
    assert stale.project.archived_at == first_archived_at
