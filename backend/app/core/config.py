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
