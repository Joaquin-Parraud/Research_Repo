"""The migration chain applies to an empty database, matches the models and fully reverses."""

import asyncio

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection, text
from sqlalchemy.ext.asyncio import create_async_engine

from research_repo.models import Base
from tests.conftest import alembic_config

EXPECTED_TABLES = {
    "activity_log",
    "api_token",
    "file",
    "folder",
    "membership",
    "project",
    "session",
    "source",
    "source_page",
    "source_tag",
    "tag",
    "users",
}
EXPECTED_ENUMS = {"metadata_status", "project_role", "text_status", "token_mode"}


def _diff(connection: Connection) -> list[object]:
    return list(compare_metadata(MigrationContext.configure(connection), Base.metadata))


async def _inspect(database_url: str) -> tuple[set[str], set[str], list[object]]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            tables = set(
                (
                    await conn.execute(
                        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                    )
                ).scalars()
            )
            enums = set(
                (
                    await conn.execute(
                        text(
                            "SELECT t.typname FROM pg_type t "
                            "JOIN pg_namespace n ON n.oid = t.typnamespace "
                            "WHERE n.nspname = 'public' AND t.typtype = 'e'"
                        )
                    )
                ).scalars()
            )
            diff = await conn.run_sync(_diff)
            return tables, enums, diff
    finally:
        await engine.dispose()


def test_downgrade_then_upgrade_roundtrip(database_url: str) -> None:
    config = alembic_config(database_url)

    command.downgrade(config, "base")
    tables, enums, _ = asyncio.run(_inspect(database_url))
    assert tables == {"alembic_version"}
    assert enums == set()

    command.upgrade(config, "head")
    tables, enums, diff = asyncio.run(_inspect(database_url))
    assert tables == EXPECTED_TABLES | {"alembic_version"}
    assert enums == EXPECTED_ENUMS
    assert diff == [], f"models and migrations disagree: {diff}"


async def _sql(database_url: str, *statements: str) -> list[object]:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as conn:
            result: list[object] = []
            for statement in statements:
                rows = await conn.execute(text(statement))
                result = list(rows.all()) if rows.returns_rows else []
            return result
    finally:
        await engine.dispose()


def test_0002_data_steps(database_url: str) -> None:
    """Existing sources get a minimal CSL item; unused tags are removed; downgrade works."""
    config = alembic_config(database_url)
    command.downgrade(config, "0001")
    asyncio.run(
        _sql(
            database_url,
            "INSERT INTO project (id, name, slug) VALUES "
            "('00000000-0000-0000-0000-000000000001', 'P', 'p')",
            "INSERT INTO source (id, project_id, citation_key, title) VALUES "
            "('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', "
            "'old-key', 'Old title')",
            "INSERT INTO tag (id, project_id, name) VALUES "
            "('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', "
            "'used'), "
            "('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', "
            "'orphan')",
            "INSERT INTO source_tag (source_id, tag_id) VALUES "
            "('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1')",
        )
    )
    command.upgrade(config, "head")
    rows = asyncio.run(
        _sql(database_url, "SELECT csl, citation_key, citation_key_auto FROM source")
    )
    assert rows == [({"type": "document", "title": "Old title"}, "old-key", True)]
    tags = asyncio.run(_sql(database_url, "SELECT name FROM tag"))
    assert tags == [("used",)]
    command.downgrade(config, "0001")
    command.upgrade(config, "head")
