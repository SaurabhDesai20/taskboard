"""SQLAlchemy models, one module per aggregate.

Import every model module here so Alembic autogenerate sees all tables, e.g.:
    from app.models.user import User
"""

from app.db.base import Base

__all__ = ["Base"]
