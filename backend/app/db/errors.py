"""Helpers for interpreting database errors."""

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError


def is_unique_violation(exc: IntegrityError, constraint: str) -> bool:
    """Whether `exc` is a unique (or primary key) violation of the named constraint."""
    orig = exc.orig
    return isinstance(orig, UniqueViolation) and orig.diag.constraint_name == constraint
