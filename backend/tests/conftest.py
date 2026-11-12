"""Test fixtures. Requires a real PostgreSQL database in TEST_DATABASE_URL (it is wiped)."""

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from research_repo.core.config import Settings
from research_repo.main import create_app
from research_repo.models import Base, User
from research_repo.services.users import create_owner

OWNER_EMAIL = "owner@example.org"
OWNER_PASSWORD = "correct horse battery staple"


def _test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.exit(
            "TEST_DATABASE_URL is not set (e.g. postgresql+asyncpg://postgres@localhost/rr_test)",
            returncode=2,
        )
    return url


@pytest.fixture(scope="session")
def database_url() -> str:
    return _test_database_url()


def alembic_config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", "research_repo:migrations")
    config.attributes["database_url"] = database_url
    return config


@pytest.fixture(scope="session", autouse=True)
def _migrated(database_url: str) -> None:
    command.upgrade(alembic_config(database_url), "head")


async def _truncate_all(database_url: str) -> None:
    engine = create_async_engine(database_url)
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    finally:
        await engine.dispose()


@pytest.fixture(autouse=True)
def _clean_database(_migrated: None, database_url: str) -> None:
    asyncio.run(_truncate_all(database_url))


@pytest.fixture
def settings(database_url: str, tmp_path: Path) -> Settings:
    return Settings(database_url=database_url, storage_dir=tmp_path / "storage")


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture
async def db(app: FastAPI) -> AsyncIterator[AsyncSession]:
    async with app.state.sessionmaker() as session:
        yield session


@pytest.fixture
async def owner(db: AsyncSession) -> User:
    return await create_owner(db, email=OWNER_EMAIL, password=OWNER_PASSWORD, display_name="Owner")


@pytest.fixture
async def logged_in(client: httpx.AsyncClient, owner: User) -> User:
    response = await client.post(
        "/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
    )
    assert response.status_code == 200
    return owner
