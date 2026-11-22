"""Field types shared by several schemas."""

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import AfterValidator, GetCoreSchemaHandler, GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, PydanticCustomError, core_schema


def _to_utc(value: datetime) -> datetime:
    # Postgres returns timestamptz in the session time zone; the contract wants UTC ("Z").
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


UtcDatetime = Annotated[datetime, AfterValidator(_to_utc)]
"""A timestamp serialized as ISO 8601 UTC with a `Z` suffix (docs/api-contract.md 1.2)."""


def _reject_null(value: Any) -> Any:
    if value is None:
        raise PydanticCustomError("not_null", "Input should not be null")
    return value


class _NotNull:
    """See `NotNull`."""

    def __get_pydantic_core_schema__(
        self, source: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        return core_schema.no_info_before_validator_function(_reject_null, handler(source))

    def __get_pydantic_json_schema__(
        self, schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(schema)
        variants = [v for v in json_schema.pop("anyOf", []) if v.get("type") != "null"]
        if len(variants) == 1:
            json_schema.update(variants[0])
        elif variants:
            json_schema["anyOf"] = variants
        return json_schema


NotNull = _NotNull()
"""For PATCH fields that may be omitted but not sent as `null` (docs/api-contract.md 1.7).

Use as `name: Annotated[Name | None, NotNull] = None`. An omitted field keeps its default
(defaults are not validated), an explicit `null` is a 422 on that field, and the OpenAPI schema
shows the field as optional but not nullable.
"""
