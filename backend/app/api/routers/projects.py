"""Project endpoints (docs/api-contract.md section 3.5)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    DbSession,
    ProjectAccess,
    WorkspaceAccess,
    require_project_role,
    require_role,
)
from app.schemas.errors import error_responses
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from app.services import projects as projects_service

router = APIRouter(tags=["projects"])

CanViewWorkspace = Annotated[WorkspaceAccess, Depends(require_role("workspace.view"))]
CanCreateProjects = Annotated[WorkspaceAccess, Depends(require_role("project.manage"))]
CanViewProject = Annotated[ProjectAccess, Depends(require_project_role("workspace.view"))]
CanManageProject = Annotated[ProjectAccess, Depends(require_project_role("project.manage"))]
IncludeArchived = Annotated[bool, Query(description="Also return archived projects")]


@router.get(
    "/workspaces/{wid}/projects",
    response_model=list[ProjectRead],
    responses=error_responses(401, 404, 422),
)
def list_projects(
    db: DbSession, access: CanViewWorkspace, include_archived: IncludeArchived = False
) -> list[ProjectRead]:
    return projects_service.list_projects(db, access, include_archived=include_archived)


@router.post(
    "/workspaces/{wid}/projects",
    status_code=status.HTTP_201_CREATED,
    response_model=ProjectRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_project(body: ProjectCreate, db: DbSession, access: CanCreateProjects) -> ProjectRead:
    return projects_service.create(db, access, body)


@router.get("/projects/{pid}", response_model=ProjectRead, responses=error_responses(401, 404, 422))
def get_project(access: CanViewProject) -> ProjectRead:
    return projects_service.get(access)


@router.patch(
    "/projects/{pid}", response_model=ProjectRead, responses=error_responses(401, 403, 404, 422)
)
def update_project(body: ProjectUpdate, db: DbSession, access: CanManageProject) -> ProjectRead:
    return projects_service.update(db, access, body)


@router.post(
    "/projects/{pid}/archive",
    response_model=ProjectRead,
    responses=error_responses(401, 403, 404, 409, 422),
)
def archive_project(db: DbSession, access: CanManageProject) -> ProjectRead:
    return projects_service.archive(db, access)
