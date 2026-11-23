from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.common import UtcDatetime


class UserRead(BaseModel):
    """The contract's `User`. Never carries the password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: str
    created_at: UtcDatetime


class UserRef(BaseModel):
    """A user's id and display name, nested in other objects (a task's assignee, a comment's
    author)."""

    id: UUID
    name: str
