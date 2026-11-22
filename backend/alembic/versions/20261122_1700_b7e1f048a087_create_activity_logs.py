"""create activity logs

Revision ID: b7e1f048a087
Revises: 95b15f853f80
Create Date: 2026-11-22 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b7e1f048a087"
down_revision: str | Sequence[str] | None = "95b15f853f80"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS = (
    "workspace.created",
    "workspace.renamed",
    "member.added",
    "member.removed",
    "member.role_changed",
    "project.created",
    "project.updated",
    "project.archived",
    "task.created",
    "task.updated",
    "task.moved",
    "task.assigned",
    "task.due_date_changed",
    "task.deleted",
    "comment.created",
    "comment.edited",
    "comment.deleted",
)
ENTITY_TYPES = ("workspace", "member", "project", "task", "comment")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        # The model maps these to the ActivityAction / ActivityEntityType enums (non-native:
        # VARCHAR plus CHECK), so adding an action later is a plain migration.
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("entity_type", sa.String(length=16), nullable=False),
        # No foreign key: the entity may have been deleted since.
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        # The real time of the insert, so the entries of one transaction keep their order.
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(_in("action", ACTIONS), name=op.f("ck_activity_logs_action")),
        sa.CheckConstraint(
            _in("entity_type", ENTITY_TYPES), name=op.f("ck_activity_logs_entity_type")
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"], ["users.id"], name=op.f("fk_activity_logs_actor_id_users")
        ),
        # Entries outlive their project and task.
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_activity_logs_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["tasks.id"],
            name=op.f("fk_activity_logs_task_id_tasks"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_activity_logs_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_logs")),
    )
    # The feed, newest first (keyset pagination), and the cascade from workspaces.
    op.create_index(
        "ix_activity_logs_workspace_id_created_at_id",
        "activity_logs",
        ["workspace_id", sa.literal_column("created_at DESC"), sa.literal_column("id DESC")],
        unique=False,
    )
    # The project and task filters, and the ON DELETE SET NULL from projects and tasks.
    op.create_index(
        "ix_activity_logs_project_id_created_at_id",
        "activity_logs",
        ["project_id", sa.literal_column("created_at DESC"), sa.literal_column("id DESC")],
        unique=False,
    )
    op.create_index(
        "ix_activity_logs_task_id_created_at_id",
        "activity_logs",
        ["task_id", sa.literal_column("created_at DESC"), sa.literal_column("id DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_activity_logs_task_id_created_at_id", table_name="activity_logs")
    op.drop_index("ix_activity_logs_project_id_created_at_id", table_name="activity_logs")
    op.drop_index("ix_activity_logs_workspace_id_created_at_id", table_name="activity_logs")
    op.drop_table("activity_logs")
