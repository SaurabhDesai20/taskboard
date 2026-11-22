"""Project request and response models (docs/api-contract.md sections 1.8 and 3.5)."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.schemas.common import NotNull, UtcDatetime

KEY_PATTERN = r"^[A-Z][A-Z0-9]{1,9}$"

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# 2 to 10 uppercase letters and digits, starting with a letter. Not uppercased for the caller.
ProjectKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=10, pattern=KEY_PATTERN),
]
# May be empty after trimming: "" is kept as "", and null means "no description".
ProjectDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class ProjectRead(BaseModel):
    """The contract's `Project`."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    key: str
    description: str | None
    archived_at: UtcDatetime | None
    created_by: UUID
    created_at: UtcDatetime


class ProjectCreate(BaseModel):
    name: ProjectName
    key: ProjectKey
    description: ProjectDescription | None = None


class ProjectUpdate(BaseModel):
    # The key is immutable: a `key` in the body is ignored like any unknown field.
    name: Annotated[ProjectName | None, NotNull] = None
    # Omitted: unchanged. null: cleared (section 1.7). The service tells them apart with
    # `model_fields_set`.
    description: ProjectDescription | None = None
