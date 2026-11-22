"""Workspace endpoints (docs/api-contract.md section 3.3)."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, DbSession, WorkspaceAccess, require_role
from app.schemas.errors import error_responses
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead, WorkspaceUpdate
from app.services import workspaces as workspaces_service

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

CanView = Annotated[WorkspaceAccess, Depends(require_role("workspace.view"))]
CanManage = Annotated[WorkspaceAccess, Depends(require_role("workspace.manage"))]


@router.get("", response_model=list[WorkspaceRead], responses=error_responses(401))
def list_workspaces(db: DbSession, user: CurrentUser) -> list[WorkspaceRead]:
    return workspaces_service.list_for_user(db, user.id)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=WorkspaceRead,
    responses=error_responses(401, 403, 409, 422),
)
def create_workspace(body: WorkspaceCreate, db: DbSession, user: CurrentUser) -> WorkspaceRead:
    return workspaces_service.create(db, user.id, body)


@router.get("/{wid}", response_model=WorkspaceRead, responses=error_responses(401, 404, 422))
def get_workspace(access: CanView) -> WorkspaceRead:
    return workspaces_service.get(access)


@router.patch("/{wid}", response_model=WorkspaceRead, responses=error_responses(401, 403, 404, 422))
def update_workspace(body: WorkspaceUpdate, db: DbSession, access: CanManage) -> WorkspaceRead:
    return workspaces_service.update(db, access, body)


@router.delete(
    "/{wid}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404, 422),
)
def delete_workspace(db: DbSession, access: CanManage) -> None:
    workspaces_service.delete(db, access)
