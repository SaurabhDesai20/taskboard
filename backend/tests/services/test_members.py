"""Member rules that only concurrent requests can reach through the API."""

from uuid import UUID

import pytest
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.models.workspace import Workspace
from app.repositories import members as members_repo
from app.schemas.member import MemberCreate, MemberUpdate
from app.services import members as members_service
from app.services.access import WorkspaceAccess, workspace_access
from app.services.permissions import Role
from tests.factories import add_member, create_team, create_user


def _set_role(db: Session, workspace: Workspace, user_id: UUID, role: Role) -> None:
    found = members_repo.get(db, workspace.id, user_id)
    assert found is not None
    found[0].role = role
    db.flush()


def _stale_owner_access(db: Session) -> tuple[WorkspaceAccess, UUID]:
    """Owners A and B act on each other at the same time.

    A's request resolves A's access while A is an owner; then B's request demotes A.
    Returns A's (now stale) access and B's user id.
    """
    team = create_team(db)
    second_owner = create_user(db)
    add_member(db, team.workspace, second_owner, Role.OWNER)
    stale = workspace_access(db, team.workspace.id, team.owner.id, "member.manage")
    _set_role(db, team.workspace, team.owner.id, Role.ADMIN)
    return stale, second_owner.id


def test_change_role_refuses_to_demote_the_last_owner(db_session: Session) -> None:
    stale, second_owner_id = _stale_owner_access(db_session)

    with pytest.raises(Conflict) as exc_info:
        members_service.change_role(
            db_session, stale, second_owner_id, MemberUpdate(role=Role.ADMIN)
        )

    assert exc_info.value.details == {"reason": "last_owner"}
    assert exc_info.value.message == "A workspace must always have at least one owner"


def test_remove_refuses_to_remove_the_last_owner(db_session: Session) -> None:
    stale, second_owner_id = _stale_owner_access(db_session)

    with pytest.raises(Conflict) as exc_info:
        members_service.remove(db_session, stale, second_owner_id)

    assert exc_info.value.details == {"reason": "last_owner"}
    assert members_repo.get(db_session, stale.workspace.id, second_owner_id) is not None


def test_add_maps_a_concurrent_duplicate_to_already_member(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-check can miss a member added in between; the primary key can't."""
    team = create_team(db_session)
    newcomer = create_user(db_session, email="ben@example.com")
    db_session.expunge(add_member(db_session, team.workspace, newcomer, Role.VIEWER))
    monkeypatch.setattr(members_repo, "get", lambda _db, _wid, _uid: None)
    access = workspace_access(db_session, team.workspace.id, team.owner.id, "member.manage")

    with pytest.raises(Conflict) as exc_info:
        members_service.add(
            db_session, access, MemberCreate(email="ben@example.com", role=Role.MEMBER)
        )

    assert exc_info.value.details == {"reason": "already_member"}
