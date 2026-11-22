"""Field types shared by several schemas."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator


def _to_utc(value: datetime) -> datetime:
    # Postgres returns timestamptz in the session time zone; the contract wants UTC ("Z").
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


UtcDatetime = Annotated[datetime, AfterValidator(_to_utc)]
"""A timestamp serialized as ISO 8601 UTC with a `Z` suffix (docs/api-contract.md 1.2)."""
