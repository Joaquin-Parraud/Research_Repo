"""Test fixtures.

Requires a real PostgreSQL database in TEST_DATABASE_URL (it is wiped).

Tests marked ``citeproc`` render citations with the real citation service (citeproc-js, see
``citeproc/`` at the repository root), never a mock: the session starts ``node citeproc/server.js``
on a free port, or uses ``CITEPROC_TEST_URL`` if set. Without Node.js (or ``npm ci`` in
``citeproc/``) those tests fail; they are not skipped. Other tests get an address where nothing
listens, so an unexpected rendering shows up as 503 ``citation.unavailable``.
"""

import asyncio
import os
import shutil
import socket
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator, Iterator
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
from research_repo.services.metadata import MetadataLookup
from research_repo.services.users import create_owner

REPO_ROOT = Path(__file__).resolve().parents[2]
CITEPROC_SERVER = REPO_ROOT / "citeproc" / "server.js"
# Port 9 (discard): nothing listens there, so connecting fails at once.
UNREACHABLE_CITEPROC = "http://127.0.0.1:9"
CITEPROC_START_SECONDS = 60

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


def _citeproc_healthy(url: str) -> bool:
    try:
        return httpx.get(f"{url}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="session")
def citeproc_url() -> Iterator[str]:
    """Base URL of a running citation service (started for the session if needed)."""
    configured = os.environ.get("CITEPROC_TEST_URL", "").rstrip("/")
    if configured:
        if not _citeproc_healthy(configured):
            pytest.fail(f"CITEPROC_TEST_URL={configured} does not answer GET /health")
        yield configured
        return

    node = shutil.which("node")
    if node is None:
        pytest.fail(
            "Node.js is required for the citation tests: install Node 22 and run `npm ci` in "
            "citeproc/, or point CITEPROC_TEST_URL at a running citation service."
        )
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(  # noqa: S603 - fixed arguments
            [node, str(CITEPROC_SERVER)],
            cwd=CITEPROC_SERVER.parent,
            env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1"},
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + CITEPROC_START_SECONDS
            while not _citeproc_healthy(url):
                if process.poll() is not None or time.monotonic() > deadline:
                    output.seek(0)
                    log = output.read().decode(errors="replace")[-4000:]
                    pytest.fail(f"The citation service did not start ({CITEPROC_SERVER}):\n{log}")
                time.sleep(0.2)
            yield url
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


@pytest.fixture
def settings(database_url: str, tmp_path: Path, request: pytest.FixtureRequest) -> Settings:
    citeproc = (
        request.getfixturevalue("citeproc_url")
        if request.node.get_closest_marker("citeproc")
        else UNREACHABLE_CITEPROC
    )
    return Settings(
        database_url=database_url, storage_dir=tmp_path / "storage", citeproc_url=citeproc
    )


def _no_network(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"unexpected outbound request in a test: {request.url}")


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    # Tests never reach Crossref: any request a test did not mock fails loudly.
    application.state.metadata_lookup = MetadataLookup(
        settings, transport=httpx.MockTransport(_no_network)
    )
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
