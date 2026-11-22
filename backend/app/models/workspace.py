"""The workspace aggregate: a workspace and its memberships."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.services.permissions import Role

ROLE_TYPE = Enum(
    Role,
    name="role",
    native_enum=False,
    create_constraint=True,
    length=16,
    # Store the lowercase values ("owner"), not the member names ("OWNER").
    values_callable=lambda roles: [role.value for role in roles],
    validate_strings=True,
)
"""VARCHAR plus a CHECK constraint, so adding a role later is a plain migration."""


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(48), unique=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    # Deleting a workspace deletes its memberships (and, from Phase 3, everything else in it)
    # in the database, so no ORM cascade is needed.
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    # Indexed on its own for "workspaces I belong to"; the primary key leads with workspace_id.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[Role] = mapped_column(ROLE_TYPE)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
