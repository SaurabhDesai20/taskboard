"""Workspace request and response models (docs/api-contract.md sections 1.8 and 3.3)."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints

from app.schemas.common import NotNull, UtcDatetime
from app.services.permissions import Role

SLUG_MAX_LENGTH = 48
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Slug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=SLUG_MAX_LENGTH, pattern=SLUG_PATTERN
    ),
]


class WorkspaceRead(BaseModel):
    """The contract's `Workspace`, including the caller's role in it."""

    id: UUID
    name: str
    slug: str
    created_by: UUID
    created_at: UtcDatetime
    my_role: Role


class WorkspaceCreate(BaseModel):
    name: WorkspaceName
    # Omitted or null: derived from the name, with -2, -3, ... appended if taken.
    slug: Slug | None = None


class WorkspaceUpdate(BaseModel):
    # Only the name can change; the slug is immutable (unknown fields are ignored).
    name: Annotated[WorkspaceName | None, NotNull] = None
