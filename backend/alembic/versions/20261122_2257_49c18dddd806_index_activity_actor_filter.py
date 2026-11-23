"""index activity actor filter

Revision ID: 49c18dddd806
Revises: b7e1f048a087
Create Date: 2026-11-22 22:57:07.622731

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "49c18dddd806"
down_revision: str | Sequence[str] | None = "b7e1f048a087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # GET /workspaces/{wid}/activity?actor_id=: without it the feed index walks every entry of
    # the workspace to find an actor with few entries (backend/README.md, "Index review").
    op.create_index(
        "ix_activity_logs_workspace_id_actor_id_created_at_id",
        "activity_logs",
        [
            "workspace_id",
            "actor_id",
            sa.literal_column("created_at DESC"),
            sa.literal_column("id DESC"),
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_activity_logs_workspace_id_actor_id_created_at_id", table_name="activity_logs"
    )
