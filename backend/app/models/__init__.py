"""SQLAlchemy models, one module per aggregate.

Import every model module here so Alembic autogenerate sees all tables.
"""

from app.db.base import Base
from app.models.activity import ActivityLog
from app.models.comment import Comment
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember

__all__ = [
    "ActivityLog",
    "Base",
    "Comment",
    "Project",
    "Task",
    "User",
    "Workspace",
    "WorkspaceMember",
]
