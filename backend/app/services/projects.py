"""Projects (docs/api-contract.md section 3.5).

Functions that take a WorkspaceAccess expect the route's `require_role(...)` gate to have run;
functions that take a ProjectAccess expect `require_project_role(...)`. Those gates resolve the
project to its workspace and apply the 404/403 rules, so a project of a workspace the caller
does not belong to never reaches this module.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.db.errors import is_unique_violation
from app.models.project import KEY_UNIQUE_CONSTRAINT, Project
from app.repositories import projects as projects_repo
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from app.services.access import ProjectAccess, WorkspaceAccess

KEY_TAKEN_MESSAGE = "This project key is already used in this workspace"
ALREADY_ARCHIVED_MESSAGE = "This project is already archived"


def list_projects(
    db: Session, access: WorkspaceAccess, *, include_archived: bool = False
) -> list[ProjectRead]:
    """The workspace's projects by name; archived ones only when asked. Gate: `workspace.view`."""
    projects = projects_repo.list_for_workspace(
        db, access.workspace.id, include_archived=include_archived
    )
    return [_read(project) for project in projects]


def create(db: Session, access: WorkspaceAccess, data: ProjectCreate) -> ProjectRead:
    """Create a project in the caller's workspace. Gate: `project.manage`.

    409 `project_key_taken` when the workspace already has a project (archived or not) with
    this key. The unique constraint is the authority, so concurrent creates can't share a key.
    """
    try:
        with db.begin_nested():
            project = projects_repo.create(
                db,
                workspace_id=access.workspace.id,
                name=data.name,
                key=data.key,
                description=data.description,
                created_by=access.user_id,
            )
    except IntegrityError as exc:
        if is_unique_violation(exc, KEY_UNIQUE_CONSTRAINT):
            raise Conflict(KEY_TAKEN_MESSAGE, {"reason": "project_key_taken"}) from exc
        raise
    db.commit()
    return _read(project)


def get(access: ProjectAccess) -> ProjectRead:
    """Gate: `workspace.view`."""
    return _read(access.project)


def update(db: Session, access: ProjectAccess, data: ProjectUpdate) -> ProjectRead:
    """Change the name and/or description. Gate: `project.manage`.

    Omitted fields stay as they are, `description: null` clears it, and an empty or no-op body
    returns the project unchanged without writing. Archived projects can still be edited.
    """
    project = access.project
    changed = False
    if data.name is not None and data.name != project.name:
        project.name = data.name
        changed = True
    if "description" in data.model_fields_set and data.description != project.description:
        project.description = data.description
        changed = True
    if changed:
        db.commit()
    return _read(project)


def archive(db: Session, access: ProjectAccess) -> ProjectRead:
    """Set `archived_at`. Gate: `project.manage`. 409 `already_archived` if it already is."""
    project = access.project
    if not projects_repo.archive(db, project):
        raise Conflict(ALREADY_ARCHIVED_MESSAGE, {"reason": "already_archived"})
    db.commit()
    return _read(project)


def _read(project: Project) -> ProjectRead:
    return ProjectRead.model_validate(project)
