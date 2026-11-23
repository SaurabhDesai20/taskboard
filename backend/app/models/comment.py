"""The comment aggregate: a message on a task's thread."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        # A task's thread, oldest first, with the id as tiebreak: serves the keyset pagination
        # of GET /tasks/{tid}/comments, the comment counts on tasks, and the cascade from tasks.
        Index("ix_comments_task_id_created_at_id", "task_id", "created_at", "id"),
    )
    # Fetch server-generated values (created_at) with RETURNING after each flush.
    # (SQLAlchemy reads it as a plain dict; mypy rejects a ClassVar annotation here.)
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Deleting a task deletes its comments in the database.
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    # Denormalized from the task, so comment queries filter by workspace directly. Always equal
    # to the task's workspace_id.
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # Users are never deleted, so the author needs no ON DELETE rule.
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(String(5000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Set by every edit that changes the body; null until then.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
