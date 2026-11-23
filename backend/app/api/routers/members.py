"""Workspace member endpoints (docs/api-contract.md section 3.4)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, status

from app.api.deps import DbSession, WorkspaceAccess, require_role
from app.schemas.errors import error_responses
from app.schemas.member import MemberCreate, MemberRead, MemberUpdate
from app.services import members as members_service

router = APIRouter(prefix="/workspaces/{wid}/members", tags=["members"])

CanView = Annotated[WorkspaceAccess, Depends(require_role("workspace.view"))]
CanManageMembers = Annotated[WorkspaceAccess, Depends(require_role("member.manage"))]
MemberUserId = Annotated[UUID, Path(description="The member's user id")]


@router.get("", response_model=list[MemberRead], responses=error_responses(401, 404, 422))
def list_members(db: DbSession, access: CanView) -> list[MemberRead]:
    return members_service.list_members(db, access)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=MemberRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def add_member(body: MemberCreate, db: DbSession, access: CanManageMembers) -> MemberRead:
    return members_service.add(db, access, body)


@router.patch(
    "/{uid}", response_model=MemberRead, responses=error_responses(401, 403, 404, 409, 422)
)
def change_member_role(
    uid: MemberUserId, body: MemberUpdate, db: DbSession, access: CanManageMembers
) -> MemberRead:
    return members_service.change_role(db, access, uid, body)


@router.delete(
    "/{uid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 409, 422),
)
def remove_member(uid: MemberUserId, db: DbSession, access: CanView) -> None:
    # Any member may leave (uid = themselves); removing others needs member.manage (service).
    members_service.remove(db, access, uid)
