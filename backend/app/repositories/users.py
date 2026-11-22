from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


def get_by_id(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)


def get_by_email(db: Session, email: str) -> User | None:
    """Case-insensitive match (the column is citext)."""
    return db.scalar(select(User).where(User.email == email))


def create(db: Session, *, email: str, name: str, password_hash: str) -> User:
    """Insert and flush, so the id and created_at are set. The caller commits."""
    user = User(email=email, name=name, password_hash=password_hash)
    db.add(user)
    db.flush()
    return user
