"""Request bodies for /auth (docs/api-contract.md sections 1.8 and 3.2)."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, EmailStr, StringConstraints


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def _lowercase(value: str) -> str:
    return value.lower()


# Trimmed, validated (email-validator also enforces the 254-character limit), lowercased.
Email = Annotated[EmailStr, BeforeValidator(_strip), AfterValidator(_lowercase)]
UserName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# Passwords are secrets and are used exactly as typed: never trimmed.
NewPassword = Annotated[str, StringConstraints(min_length=8, max_length=128)]
# Login accepts any non-empty password up to the maximum, so the hash cost stays bounded.
LoginPassword = Annotated[str, StringConstraints(min_length=1, max_length=128)]


class RegisterRequest(BaseModel):
    email: Email
    name: UserName
    password: NewPassword


class LoginRequest(BaseModel):
    email: Email
    password: LoginPassword
