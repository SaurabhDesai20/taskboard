"""Workspace member request and response models (docs/api-contract.md section 3.4)."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel

from app.schemas.auth import Email
from app.schemas.common import NotNull, UtcDatetime
from app.services.permissions import Role


class MemberRead(BaseModel):
    """The contract's `Member`: a user and their role in one workspace."""

    user_id: UUID
    email: str
    name: str
    role: Role
    joined_at: UtcDatetime


class MemberCreate(BaseModel):
    """Adds an existing registered user, found by email (case-insensitive)."""

    email: Email
    role: Role


class MemberUpdate(BaseModel):
    role: Annotated[Role | None, NotNull] = None
