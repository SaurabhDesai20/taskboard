"""Test database helpers.

The test database comes from TEST_DATABASE_URL (env var or .env). Its name must end with
"_test": it is created if missing and its public schema is wiped at the start of every run.
Importing this module points the app's own DATABASE_URL at the test database as well.
"""

import os
import re
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import URL, Engine, create_engine, make_url, text

from app.core.config import Settings, get_settings

BACKEND_DIR = Path(__file__).resolve().parents[1]
SAFE_TEST_DB_NAME = re.compile(r"^[a-z0-9_]+_test$")


def _resolve_test_database_url() -> URL:
    url = os.environ.get("TEST_DATABASE_URL") or Settings().test_database_url
    if not url:
        raise pytest.UsageError("TEST_DATABASE_URL is not set (see .env.example).")
    parsed = make_url(url)
    if not parsed.database or not SAFE_TEST_DB_NAME.match(parsed.database):
        raise pytest.UsageError(
            f"Refusing to use database {parsed.database!r} for tests: "
            "the name must end with '_test' and use only [a-z0-9_]."
        )
    return parsed


TEST_DATABASE_URL = _resolve_test_database_url()
TEST_DATABASE_URL_STR = TEST_DATABASE_URL.render_as_string(hide_password=False)

# Anything that reaches the app's own engine during tests must hit the test database.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL_STR
os.environ["APP_ENV"] = "test"
get_settings.cache_clear()


def ensure_database_exists(url: URL) -> None:
    admin_engine = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
            )
            if not exists:
                # Safe: the name was validated against SAFE_TEST_DB_NAME.
                conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin_engine.dispose()


def reset_schema(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


def alembic_config(url: str = TEST_DATABASE_URL_STR) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    # ConfigParser treats % as interpolation, so escape it (e.g. in passwords).
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg
