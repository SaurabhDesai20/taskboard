"""Shared FastAPI dependencies.

Phase 1 adds get_current_user; Phase 2 adds require_role(min_role).
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import get_db

DbSession = Annotated[Session, Depends(get_db)]

__all__ = ["DbSession", "get_db"]
