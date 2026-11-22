"""Column types shared by several models."""

from enum import StrEnum

from sqlalchemy import Enum


def string_enum(enum: type[StrEnum], name: str, *, length: int = 16) -> Enum:
    """VARCHAR plus a CHECK constraint named `ck_<table>_<name>` that lists the enum's values.

    Stores the lowercase values (`"in_progress"`), not the member names (`"IN_PROGRESS"`), and
    is not a native Postgres enum, so adding a value later is a plain migration.
    """
    return Enum(
        enum,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=length,
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
    )
