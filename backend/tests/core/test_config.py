import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings

DATABASE_URL = "postgresql+psycopg://user@localhost/db"


def test_production_rejects_short_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET must be at least 32 characters"):
        Settings(app_env="production", database_url=DATABASE_URL, jwt_secret=SecretStr("short"))


def test_production_accepts_long_jwt_secret() -> None:
    settings = Settings(
        app_env="production", database_url=DATABASE_URL, jwt_secret=SecretStr("s" * 32)
    )

    assert settings.jwt_secret.get_secret_value() == "s" * 32


def test_development_allows_short_jwt_secret() -> None:
    settings = Settings(
        app_env="development", database_url=DATABASE_URL, jwt_secret=SecretStr("short")
    )

    assert settings.jwt_secret.get_secret_value() == "short"


def test_jwt_secret_is_hidden_in_repr() -> None:
    settings = Settings(database_url=DATABASE_URL, jwt_secret=SecretStr("do-not-log-me"))

    assert "do-not-log-me" not in repr(settings)
