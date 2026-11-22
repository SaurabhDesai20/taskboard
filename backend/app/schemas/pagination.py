"""Cursor pagination for comments and activity (docs/api-contract.md section 1.6).

A page is ordered by `(created_at, id)`. The cursor is the position of the last item of the
previous page: base64url (no padding) of `{"c": "<created_at, ISO 8601 UTC>", "id": "<uuid>"}`.
Clients treat it as opaque. Keyset positions stay valid when items are added or deleted.
"""

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Final, Self
from uuid import UUID

from pydantic import AfterValidator
from pydantic_core import PydanticCustomError

DEFAULT_LIMIT: Final = 20
MAX_LIMIT: Final = 100

INVALID_CURSOR_MESSAGE = "Invalid cursor"


@dataclass(frozen=True)
class Cursor:
    """A keyset position: the `(created_at, id)` of the last item already returned."""

    created_at: datetime
    id: UUID

    def encode(self) -> str:
        created_at = self.created_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
        payload = json.dumps({"c": created_at, "id": str(self.id)}, separators=(",", ":"))
        return base64.urlsafe_b64encode(payload.encode()).rstrip(b"=").decode("ascii")

    @classmethod
    def decode(cls, value: str) -> Self:
        """The position `encode` wrote. Raises ValueError for any other string."""
        try:
            raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            data = json.loads(raw)
            created_at = datetime.fromisoformat(data["c"])
            cursor_id = UUID(data["id"])
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            # Bad base64, not JSON, missing keys, wrong types, unparsable values.
            raise ValueError(INVALID_CURSOR_MESSAGE) from exc
        if created_at.tzinfo is None:
            raise ValueError(INVALID_CURSOR_MESSAGE)
        return cls(created_at=created_at, id=cursor_id)


def _check_cursor(value: str) -> str:
    try:
        Cursor.decode(value)
    except ValueError:
        raise PydanticCustomError("cursor", INVALID_CURSOR_MESSAGE) from None
    return value


PageCursor = Annotated[str, AfterValidator(_check_cursor)]
"""The `cursor` query parameter: an opaque string that `Cursor.decode` accepts, else a 422 on
`cursor` during request validation."""
