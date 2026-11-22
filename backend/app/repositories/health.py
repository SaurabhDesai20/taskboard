from sqlalchemy import literal, select
from sqlalchemy.orm import Session


def ping(db: Session) -> None:
    """Round-trip to the database. Raises SQLAlchemyError if it is unreachable."""
    db.scalar(select(literal(1)))
