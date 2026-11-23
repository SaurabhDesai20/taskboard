from fastapi import APIRouter

from app.api.deps import DbSession
from app.schemas.errors import ErrorEnvelope
from app.schemas.health import HealthRead
from app.services import health as health_service

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthRead,
    responses={503: {"model": ErrorEnvelope, "description": "Database unavailable"}},
)
def get_health(db: DbSession) -> HealthRead:
    return health_service.check_health(db)
