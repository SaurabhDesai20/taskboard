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
