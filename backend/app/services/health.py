import logging

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import ServiceUnavailable
from app.repositories import health as health_repo
from app.schemas.health import HealthRead

logger = logging.getLogger(__name__)


def check_health(db: Session) -> HealthRead:
    try:
        health_repo.ping(db)
    except SQLAlchemyError as exc:
        logger.warning("Database health check failed: %s", exc.__class__.__name__)
        raise ServiceUnavailable("Database is unavailable") from exc
    return HealthRead(status="ok", database="ok")
