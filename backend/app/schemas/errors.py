"""Error envelope models, used to document error responses in OpenAPI."""

from http import HTTPStatus
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ErrorBody(BaseModel):
    # `details` is always present in responses, so mark it required in the OpenAPI schema.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    error: ErrorBody


def error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses` documenting the error envelope for each status code.

    Listing 422 here also replaces FastAPI's default `HTTPValidationError` schema, which
    does not match the envelope the API actually returns.
    """
    return {
        code: {"model": ErrorEnvelope, "description": HTTPStatus(code).phrase}
        for code in status_codes
    }
