"""SQLAlchemy models, one module per aggregate.

Import every model module here so Alembic autogenerate sees all tables.
"""

from app.db.base import Base
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember

__all__ = ["Base", "User", "Workspace", "WorkspaceMember"]
