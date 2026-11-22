"""Workspace CRUD (docs/api-contract.md section 3.3).

Functions that take a WorkspaceAccess expect the route's `require_role(...)` gate to have run.
Creating and renaming record `workspace.created` / `workspace.renamed` in the same transaction
(section 3.8). Deleting removes the workspace's activity with everything else.
"""

import itertools
import re
from collections.abc import Iterator
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.db.errors import is_unique_violation
from app.models.activity import ActivityAction
from app.models.workspace import Workspace
from app.repositories import members as members_repo
from app.repositories import workspaces as workspaces_repo
from app.schemas.workspace import SLUG_MAX_LENGTH, WorkspaceCreate, WorkspaceRead, WorkspaceUpdate
from app.services import activity
from app.services.access import WorkspaceAccess
from app.services.permissions import Role

SLUG_UNIQUE_CONSTRAINT = "uq_workspaces_slug"
SLUG_TAKEN_MESSAGE = "This workspace URL is already taken"
DEFAULT_SLUG = "workspace"
# Derived slugs are checked against the database this many at a time.
_SLUG_BATCH_SIZE = 20
# How often to re-derive a slug when concurrent creates keep taking the free one first.
_DERIVED_SLUG_ATTEMPTS = 3

_NON_ALPHANUMERIC_RUN = re.compile(r"[^a-z0-9]+")


def list_for_user(db: Session, user_id: UUID) -> list[WorkspaceRead]:
    return [
        _read(workspace, role) for workspace, role in workspaces_repo.list_for_user(db, user_id)
    ]


def create(db: Session, user_id: UUID, data: WorkspaceCreate) -> WorkspaceRead:
    """Create a workspace whose creator is its owner."""
    if data.slug is not None:
        workspace = _try_insert(db, name=data.name, slug=data.slug, created_by=user_id)
        if workspace is None:
            raise _slug_taken()
    else:
        workspace = _insert_with_derived_slug(db, name=data.name, created_by=user_id)
    members_repo.add(db, workspace_id=workspace.id, user_id=user_id, role=Role.OWNER)
    activity.record_workspace(
        db, user_id, ActivityAction.WORKSPACE_CREATED, workspace, {"name": workspace.name}
    )
    db.commit()
    return _read(workspace, Role.OWNER)


def get(access: WorkspaceAccess) -> WorkspaceRead:
    return _read(access.workspace, access.role)


def update(db: Session, access: WorkspaceAccess, data: WorkspaceUpdate) -> WorkspaceRead:
    """Rename. An omitted or unchanged name leaves the workspace as it is."""
    workspace = access.workspace
    if data.name is not None and data.name != workspace.name:
        before = workspace.name
        workspace.name = data.name
        activity.record_workspace(
            db,
            access.user_id,
            ActivityAction.WORKSPACE_RENAMED,
            workspace,
            {"before": {"name": before}, "after": {"name": workspace.name}},
        )
        db.commit()
    return _read(workspace, access.role)


def delete(db: Session, access: WorkspaceAccess) -> None:
    """Delete the workspace and, by database cascade, everything in it."""
    workspaces_repo.delete(db, access.workspace)
    db.commit()


def derive_slug(name: str) -> str:
    """Contract 3.3: lowercase, runs of non-alphanumerics become "-", trimmed, max 48 chars."""
    slug = _NON_ALPHANUMERIC_RUN.sub("-", name.lower()).strip("-")
    return slug[:SLUG_MAX_LENGTH].rstrip("-") or DEFAULT_SLUG


def slug_candidates(base: str) -> Iterator[str]:
    """`base`, then `base-2`, `base-3`, ..., each shortened to fit 48 chars."""
    yield base
    for n in itertools.count(2):
        suffix = f"-{n}"
        yield base[: SLUG_MAX_LENGTH - len(suffix)].rstrip("-") + suffix


def _first_free_slug(db: Session, base: str) -> str:
    candidates = slug_candidates(base)
    while True:
        batch = list(itertools.islice(candidates, _SLUG_BATCH_SIZE))
        taken = workspaces_repo.existing_slugs(db, batch)
        for slug in batch:
            if slug not in taken:
                return slug


def _insert_with_derived_slug(db: Session, *, name: str, created_by: UUID) -> Workspace:
    base = derive_slug(name)
    for _ in range(_DERIVED_SLUG_ATTEMPTS):
        slug = _first_free_slug(db, base)
        workspace = _try_insert(db, name=name, slug=slug, created_by=created_by)
        if workspace is not None:
            return workspace
    raise _slug_taken()


def _try_insert(db: Session, *, name: str, slug: str, created_by: UUID) -> Workspace | None:
    """Insert in a savepoint. None when the slug is taken.

    The unique constraint is the authority, so two concurrent creates can't share a slug.
    """
    try:
        with db.begin_nested():
            return workspaces_repo.create(db, name=name, slug=slug, created_by=created_by)
    except IntegrityError as exc:
        if is_unique_violation(exc, SLUG_UNIQUE_CONSTRAINT):
            return None
        raise


def _slug_taken() -> Conflict:
    return Conflict(SLUG_TAKEN_MESSAGE, {"reason": "slug_taken"})


def _read(workspace: Workspace, role: Role) -> WorkspaceRead:
    return WorkspaceRead(
        id=workspace.id,
        name=workspace.name,
        slug=workspace.slug,
        created_by=workspace.created_by,
        created_at=workspace.created_at,
        my_role=role,
    )
