"""The project aggregate: a named, keyed container for tasks inside one workspace."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

KEY_UNIQUE_CONSTRAINT = "uq_projects_workspace_id_key"


class Project(Base):
    __tablename__ = "projects"
    # Keys are unique per workspace, archived projects included (task keys like "WEB-12" stay
    # unambiguous). The constraint's index leads with workspace_id, so it also serves the
    # per-workspace list and the cascade from workspaces.
    __table_args__ = (UniqueConstraint("workspace_id", "key", name=KEY_UNIQUE_CONSTRAINT),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Deleting a workspace deletes its projects in the database.
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    key: Mapped[str] = mapped_column(String(10))
    description: Mapped[str | None] = mapped_column(String(2000))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
