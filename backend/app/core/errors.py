"""Domain exceptions and the handlers that map every error to the contract's envelope.

Services raise the exceptions below. Routers never build error responses themselves.
Envelope (docs/api-contract.md):
    {"error": {"code": "not_found", "message": "Human readable", "details": {}}}
"""

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, ClassVar, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

ErrorLocation = Literal["body", "query", "path", "header", "cookie"]


class DomainError(Exception):
    status_code: ClassVar[int] = 400
    code: ClassVar[str] = "bad_request"
    default_message: ClassVar[str] = "Bad request"

    def __init__(self, message: str | None = None, details: dict[str, Any] | None = None) -> None:
        self.message = message or self.default_message
        self.details: dict[str, Any] = details or {}
        # Extra response headers (e.g. Retry-After on a 429).
        self.headers: dict[str, str] = {}
        super().__init__(self.message)


class ValidationFailed(DomainError):
    status_code = 422
    code = "validation_error"
    default_message = "Request validation failed"

    @classmethod
    def for_field(
        cls, field: str, message: str, location: ErrorLocation = "body"
    ) -> "ValidationFailed":
        """Build a 422 with the same `details.errors` shape as request validation errors."""
        return cls(details={"errors": [{"field": field, "location": location, "message": message}]})


class Unauthorized(DomainError):
    status_code = 401
    code = "unauthorized"
    default_message = "Authentication required"


class Forbidden(DomainError):
    status_code = 403
    code = "forbidden"
    default_message = "You do not have permission to do this"


class NotFound(DomainError):
    status_code = 404
    code = "not_found"
    default_message = "Not found"


class Conflict(DomainError):
    status_code = 409
    code = "conflict"
    default_message = "Conflict"


class RateLimited(DomainError):
    """429 with a `Retry-After` header: the whole seconds until the next attempt is allowed."""

    status_code = 429
    code = "rate_limited"
    default_message = "Too many attempts. Try again later."

    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(1, retry_after)
        unit = "second" if self.retry_after == 1 else "seconds"
        super().__init__(f"Too many attempts. Try again in {self.retry_after} {unit}.")
        self.headers = {"Retry-After": str(self.retry_after)}


class ServiceUnavailable(DomainError):
    status_code = 503
    code = "service_unavailable"
    default_message = "Service unavailable"


# Codes for errors raised by the framework (unknown route, wrong method, ...).
HTTP_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
    503: "service_unavailable",
}


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "details": details or {}}},
        headers=headers,
    )


def _handle_domain_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DomainError)
    return error_response(
        exc.status_code, exc.code, exc.message, exc.details, headers=exc.headers or None
    )


def _handle_request_validation_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = []
    for err in exc.errors():
        loc = [str(part) for part in err.get("loc", ())]
        errors.append(
            {
                "field": ".".join(loc[1:]),
                "location": loc[0] if loc else "body",
                "message": str(err.get("msg", "Invalid value")),
            }
        )
    return error_response(422, "validation_error", "Request validation failed", {"errors": errors})


def _handle_http_exception(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = HTTP_STATUS_CODES.get(exc.status_code, "http_error")
    if isinstance(exc.detail, str) and exc.detail:
        message = exc.detail
    else:
        message = HTTPStatus(exc.status_code).phrase
    return error_response(exc.status_code, code, message, headers=exc.headers)


def _handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", exc_info=exc)
    return error_response(500, "internal_error", "Internal server error")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _handle_domain_error)
    app.add_exception_handler(RequestValidationError, _handle_request_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(Exception, _handle_unexpected_error)
