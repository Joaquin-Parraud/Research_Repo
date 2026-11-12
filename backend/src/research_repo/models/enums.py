"""Enumerations stored as PostgreSQL enum types."""

import enum

from sqlalchemy import Enum


class ProjectRole(enum.StrEnum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


class TokenMode(enum.StrEnum):
    read = "read"
    read_write = "read_write"


class MetadataStatus(enum.StrEnum):
    pending = "pending"
    suggested = "suggested"
    confirmed = "confirmed"


class TextStatus(enum.StrEnum):
    none = "none"
    queued = "queued"
    done = "done"
    no_text_layer = "no_text_layer"
    failed = "failed"


# Interface languages and citation locales accepted by the schema's CHECK constraints.
INTERFACE_LANGUAGES = ("en", "es")
CITATION_LOCALES = ("en-US", "es")


def pg_enum(enum_cls: type[enum.StrEnum], name: str) -> Enum:
    """A PostgreSQL enum type storing the members' values."""
    return Enum(enum_cls, name=name, values_callable=lambda members: [m.value for m in members])
