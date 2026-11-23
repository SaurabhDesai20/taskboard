"""Guards for Alembic: one linear history, and models that match the migrated schema."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine

from app.models import Base
from tests.database import alembic_config


def test_migrations_have_a_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    heads = script.get_heads()

    assert len(heads) <= 1, f"Multiple Alembic heads, merge them: {heads}"


def test_models_match_migrated_schema(engine: Engine) -> None:
    """Fails when a model changed without a migration (run alembic revision --autogenerate)."""
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        diff = compare_metadata(context, Base.metadata)

    assert diff == [], f"Models and migrations are out of sync: {diff}"
