"""The activity log: one entry per change, written in the same transaction as the change.

docs/api-contract.md section 3.8 lists the actions and the `metadata` shape of each one.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import string_enum


class ActivityEntityType(StrEnum):
    """The kind of thing an entry is about (its `entity_id` names which one)."""

    WORKSPACE = "workspace"
    MEMBER = "member"
    PROJECT = "project"
    TASK = "task"
    COMMENT = "comment"


class ActivityAction(StrEnum):
    """What happened. The part before the dot is the entity type."""

    WORKSPACE_CREATED = "workspace.created"
    WORKSPACE_RENAMED = "workspace.renamed"
    MEMBER_ADDED = "member.added"
    MEMBER_REMOVED = "member.removed"
    MEMBER_ROLE_CHANGED = "member.role_changed"
    PROJECT_CREATED = "project.created"
    PROJECT_UPDATED = "project.updated"
    PROJECT_ARCHIVED = "project.archived"
    TASK_CREATED = "task.created"
    TASK_UPDATED = "task.updated"
    TASK_MOVED = "task.moved"
    TASK_ASSIGNED = "task.assigned"
    TASK_DUE_DATE_CHANGED = "task.due_date_changed"
    TASK_DELETED = "task.deleted"
    COMMENT_CREATED = "comment.created"
    COMMENT_EDITED = "comment.edited"
    COMMENT_DELETED = "comment.deleted"

    @property
    def entity_type(self) -> ActivityEntityType:
        return ActivityEntityType(self.value.partition(".")[0])


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    # Fetch server-generated values (created_at) with RETURNING after each flush.
    # (SQLAlchemy reads it as a plain dict; mypy rejects a ClassVar annotation here.)
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Deleting a workspace deletes its activity in the database.
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # Entries outlive their project and task: deleting either nulls these, and `metadata` keeps
    # the snapshot (key, title, name) the UI renders.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    # Users are never deleted, so the actor needs no ON DELETE rule.
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[ActivityAction] = mapped_column(string_enum(ActivityAction, "action", length=32))
    entity_type: Mapped[ActivityEntityType] = mapped_column(
        string_enum(ActivityEntityType, "entity_type")
    )
    # No foreign key: the entity (a task, a comment, a membership) may be gone.
    entity_id: Mapped[uuid.UUID]
    # `metadata` is reserved on declarative models, so the attribute has another name.
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB)
    # clock_timestamp(), not now(): now() is the transaction's start time, so the entries one
    # request writes would share a timestamp and list in random (id) order. With the real time
    # they list in the order they were written.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )


# The feed, newest first (keyset pagination with the id as tiebreak), and the cascade from
# workspaces.
Index(
    "ix_activity_logs_workspace_id_created_at_id",
    ActivityLog.workspace_id,
    ActivityLog.created_at.desc(),
    ActivityLog.id.desc(),
)
# The project and task filters (the per-task activity tab), and the ON DELETE SET NULL from
# projects and tasks.
Index(
    "ix_activity_logs_project_id_created_at_id",
    ActivityLog.project_id,
    ActivityLog.created_at.desc(),
    ActivityLog.id.desc(),
)
Index(
    "ix_activity_logs_task_id_created_at_id",
    ActivityLog.task_id,
    ActivityLog.created_at.desc(),
    ActivityLog.id.desc(),
)
# The actor filter (backend/README.md, "Index review"). Without it the feed index walks the
# whole workspace for an actor with few entries. Leads with workspace_id because an actor's
# entries span workspaces and the feed is always scoped to one.
Index(
    "ix_activity_logs_workspace_id_actor_id_created_at_id",
    ActivityLog.workspace_id,
    ActivityLog.actor_id,
    ActivityLog.created_at.desc(),
    ActivityLog.id.desc(),
)
