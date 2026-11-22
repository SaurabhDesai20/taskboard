"""Application settings, read from environment variables and the repo-root .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> parents[3] is the repository root.
REPO_ROOT = Path(__file__).resolve().parents[3]

# RFC 7518 3.2: an HS256 key must be at least as long as the hash output (256 bits).
MIN_PRODUCTION_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    database_url: str
    test_database_url: str | None = None

    # Auth (docs/api-contract.md section 1.3).
    jwt_secret: SecretStr = Field(min_length=1)
    jwt_expire_minutes: int = Field(default=10080, gt=0)
    cookie_secure: bool = False

    # Auth rate limits (docs/api-contract.md section 1.5, 429 `rate_limited`), per minute over a
    # sliding window, in this process. 0 turns a limit off (the test suite does that).
    # Requests per client IP to each of POST /auth/login and POST /auth/register:
    auth_rate_limit_per_minute: int = Field(default=20, ge=0)
    # Login attempts per client IP and email together:
    auth_rate_limit_per_email_per_minute: int = Field(default=10, ge=0)

    # The built React app (scripts\build.ps1). A relative path is relative to the repo root.
    frontend_dist_dir: Path = REPO_ROOT / "frontend" / "dist"

    @property
    def hsts_enabled(self) -> bool:
        """Send Strict-Transport-Security only where the app is served over HTTPS."""
        return self.cookie_secure or self.app_env == "production"

    @model_validator(mode="after")
    def _resolve_frontend_dist_dir(self) -> Self:
        if not self.frontend_dist_dir.is_absolute():
            self.frontend_dist_dir = REPO_ROOT / self.frontend_dist_dir
        return self

    @model_validator(mode="after")
    def _require_strong_secret_in_production(self) -> Self:
        if (
            self.app_env == "production"
            and len(self.jwt_secret.get_secret_value()) < MIN_PRODUCTION_JWT_SECRET_LENGTH
        ):
            raise ValueError(
                f"JWT_SECRET must be at least {MIN_PRODUCTION_JWT_SECRET_LENGTH} characters "
                "in production"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
