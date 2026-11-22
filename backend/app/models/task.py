"""The task aggregate: a numbered, ordered card in one column (status) of a project."""

import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    Date,
    DateTime,
    Double,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import string_enum


class TaskStatus(StrEnum):
    """A task's column on the board. Declared in board (display) order."""

    TODO = "todo"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    DONE = "done"


class TaskPriority(StrEnum):
    """Declared from lowest to highest."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


NUMBER_UNIQUE_CONSTRAINT = "uq_tasks_project_id_number"


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        # Numbers come from projects.next_task_number; the constraint is the backstop. Its index
        # leads with project_id, so it also serves the cascade from projects.
        UniqueConstraint("project_id", "number", name=NUMBER_UNIQUE_CONSTRAINT),
        # The board: one project's tasks by column, in order.
        Index("ix_tasks_project_id_status_position", "project_id", "status", "position"),
    )
    # Fetch server-generated values (created_at, updated_at) with RETURNING after each flush.
    # (SQLAlchemy reads it as a plain dict; mypy rejects a ClassVar annotation here.)
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # Denormalized from the project, so workspace-scoped queries (e.g. "my tasks") filter tasks
    # directly. Always equal to the project's workspace_id.
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # Per-project sequence starting at 1, never reused (the task key is "<project key>-<number>").
    number: Mapped[int]
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(10000))
    # VARCHAR plus CHECK constraints named ck_tasks_status / ck_tasks_priority.
    status: Mapped[TaskStatus] = mapped_column(string_enum(TaskStatus, "status"))
    priority: Mapped[TaskPriority] = mapped_column(string_enum(TaskPriority, "priority"))
    # Ascending order within the status column (docs/api-contract.md, POST /tasks/{tid}/move).
    position: Mapped[float] = mapped_column(Double())
    # Users are never deleted, so the assignee needs no ON DELETE rule.
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    due_date: Mapped[date | None] = mapped_column(Date(), index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
