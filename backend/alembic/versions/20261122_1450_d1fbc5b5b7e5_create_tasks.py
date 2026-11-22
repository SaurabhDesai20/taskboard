"""create tasks

Revision ID: d1fbc5b5b7e5
Revises: 9a191a95d452
Create Date: 2026-11-22 14:50:39.571645

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1fbc5b5b7e5"
down_revision: str | Sequence[str] | None = "9a191a95d452"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Per-project task number sequence. Existing projects have no tasks yet, so they start at 1.
    op.add_column(
        "projects",
        sa.Column("next_task_number", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        # Denormalized from projects.workspace_id for workspace-scoped queries.
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=10000), nullable=True),
        # The model maps these to the TaskStatus / TaskPriority enums (non-native: VARCHAR
        # plus CHECK), so adding a value later is a plain migration.
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column("position", sa.Double(), nullable=False),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('todo', 'in_progress', 'in_review', 'done')",
            name=op.f("ck_tasks_status"),
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'medium', 'high', 'urgent')",
            name=op.f("ck_tasks_priority"),
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["users.id"], name=op.f("fk_tasks_assignee_id_users")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_tasks_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_tasks_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_tasks_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
        # Backstop for the per-project sequence. The index leads with project_id, so it also
        # serves the cascade from projects.
        sa.UniqueConstraint("project_id", "number", name="uq_tasks_project_id_number"),
    )
    # The board: one project's tasks by column, in order.
    op.create_index(
        "ix_tasks_project_id_status_position",
        "tasks",
        ["project_id", "status", "position"],
        unique=False,
    )
    # "My tasks" and the due-date filters.
    op.create_index(op.f("ix_tasks_assignee_id"), "tasks", ["assignee_id"], unique=False)
    op.create_index(op.f("ix_tasks_due_date"), "tasks", ["due_date"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tasks_due_date"), table_name="tasks")
    op.drop_index(op.f("ix_tasks_assignee_id"), table_name="tasks")
    op.drop_index("ix_tasks_project_id_status_position", table_name="tasks")
    op.drop_table("tasks")
    op.drop_column("projects", "next_task_number")
