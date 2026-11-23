"""Assertions shared by the API tests."""

import httpx2


def assert_error(
    response: httpx2.Response,
    status: int,
    code: str,
    *,
    reason: str | None = None,
    message: str | None = None,
) -> None:
    """The response is the contract's error envelope with this status, code and details.reason."""
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert set(error) == {"code", "message", "details"}
    assert error["code"] == code
    assert error["message"]
    if message is not None:
        assert error["message"] == message
    if reason is not None:
        assert error["details"] == {"reason": reason}


def validation_fields(response: httpx2.Response) -> set[tuple[str, str]]:
    """The (field, location) pairs of a 422 validation error."""
    assert_error(response, 422, "validation_error")
    errors = response.json()["error"]["details"]["errors"]
    for item in errors:
        assert set(item) == {"field", "location", "message"}
        assert item["message"]
    return {(item["field"], item["location"]) for item in errors}
