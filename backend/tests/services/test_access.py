"""Membership resolution shared by every workspace-scoped request (contract section 1.10)."""

import uuid

import pytest
from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound
from app.services.access import denied_message, project_access, workspace_access
from app.services.permissions import ACTIONS, Action, Role, can
from tests.factories import create_project, create_team


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("action", ACTIONS)
def test_workspace_access_applies_can(db_session: Session, role: Role, action: Action) -> None:
    team = create_team(db_session)
    user = team.users[role]

    if can(role, action):
        access = workspace_access(db_session, team.workspace.id, user.id, action)
        assert access.workspace is team.workspace
        assert access.user_id == user.id
        assert access.role is role
    else:
        with pytest.raises(Forbidden) as exc_info:
            workspace_access(db_session, team.workspace.id, user.id, action)
        assert exc_info.value.details == {"reason": "insufficient_role"}
        assert exc_info.value.message == denied_message(action)


def test_non_member_and_unknown_workspace_are_both_not_found(db_session: Session) -> None:
    team = create_team(db_session)

    for workspace_id, user_id in [
        (team.workspace.id, team.outsider.id),
        (uuid.uuid4(), team.owner.id),
    ]:
        with pytest.raises(NotFound) as exc_info:
            workspace_access(db_session, workspace_id, user_id, "workspace.view")
        assert exc_info.value.message == "Workspace not found"
        assert exc_info.value.details == {}


def test_not_found_message_can_name_the_resolved_resource(db_session: Session) -> None:
    """Phase 3+ resolves project -> workspace and reports the project as not found."""
    team = create_team(db_session)

    with pytest.raises(NotFound) as exc_info:
        workspace_access(
            db_session,
            team.workspace.id,
            team.outsider.id,
            "workspace.view",
            not_found_message="Project not found",
        )

    assert exc_info.value.message == "Project not found"


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("action", ACTIONS)
def test_project_access_applies_the_role_in_the_projects_workspace(
    db_session: Session, role: Role, action: Action
) -> None:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace)
    user = team.users[role]

    if can(role, action):
        access = project_access(db_session, project.id, user.id, action)
        assert access.project is project
        assert access.user_id == user.id
        assert access.role is role
    else:
        with pytest.raises(Forbidden) as exc_info:
            project_access(db_session, project.id, user.id, action)
        assert exc_info.value.details == {"reason": "insufficient_role"}


def test_project_access_hides_missing_and_foreign_projects(db_session: Session) -> None:
    team = create_team(db_session)
    other = create_team(db_session)
    foreign = create_project(db_session, other.workspace)
    own = create_project(db_session, team.workspace)

    for project_id, user_id in [
        (uuid.uuid4(), team.owner.id),
        (foreign.id, team.owner.id),
        (own.id, team.outsider.id),
    ]:
        with pytest.raises(NotFound) as exc_info:
            project_access(db_session, project_id, user_id, "workspace.view")
        assert exc_info.value.message == "Project not found"
        assert exc_info.value.details == {}


@pytest.mark.parametrize(
    ("action", "message"),
    [
        ("task.write", "Only owners, admins and members can create or edit tasks"),
        ("member.manage", "Only owners and admins can add, remove or change members"),
        ("workspace.manage", "Only owners can rename or delete the workspace"),
    ],
)
def test_denied_message_names_the_allowed_roles(action: Action, message: str) -> None:
    assert denied_message(action) == message


@pytest.mark.parametrize("action", ACTIONS)
def test_every_action_has_a_denied_message(action: Action) -> None:
    assert denied_message(action).startswith("Only owners")
