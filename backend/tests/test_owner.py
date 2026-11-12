"""Owner bootstrap from settings and from the CLI."""

import asyncio
import io
from collections.abc import Iterator

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from research_repo import cli
from research_repo.core.config import Settings, get_settings
from research_repo.main import create_app
from research_repo.models import User


async def _users(database_url: str) -> list[tuple[str, str]]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            rows = await conn.execute(select(User.email, User.display_name).order_by(User.email))
            return [(r.email, r.display_name) for r in rows]
    finally:
        await engine.dispose()


def _owner_settings(settings: Settings, email: str, password: str) -> Settings:
    return settings.model_copy(
        update={
            "owner_email": email,
            "owner_password": SecretStr(password),
            "owner_display_name": "Boot Owner",
        }
    )


async def test_startup_creates_owner_when_no_users(settings: Settings) -> None:
    app = create_app(_owner_settings(settings, "Boot@Example.org", "bootstrap-pass"))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            response = await c.post(
                "/api/auth/login",
                json={"email": "boot@example.org", "password": "bootstrap-pass"},
            )
    assert response.status_code == 200
    assert response.json()["display_name"] == "Boot Owner"
    assert response.json()["language"] == "en"


async def test_startup_bootstrap_is_noop_once_a_user_exists(
    settings: Settings, database_url: str
) -> None:
    first = create_app(_owner_settings(settings, "first@example.org", "first-password"))
    async with first.router.lifespan_context(first):
        pass
    second = create_app(_owner_settings(settings, "second@example.org", "second-password"))
    async with second.router.lifespan_context(second):
        pass
    assert await _users(database_url) == [("first@example.org", "Boot Owner")]


async def test_startup_without_owner_settings_creates_nothing(
    settings: Settings, database_url: str
) -> None:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        pass
    assert await _users(database_url) == []


@pytest.fixture
def cli_env(database_url: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.usefixtures("cli_env")
def test_cli_create_owner(
    database_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO("a-long-password\n"))
    code = cli.main(
        ["create-owner", "--email", "CLI@example.org", "--display-name", "Cli", "--password-stdin"]
    )
    assert code == 0
    assert "cli@example.org" in capsys.readouterr().out
    assert asyncio.run(_users(database_url)) == [("cli@example.org", "Cli")]

    monkeypatch.setattr("sys.stdin", io.StringIO("another-password\n"))
    code = cli.main(["create-owner", "--email", "other@example.org", "--password-stdin"])
    assert code == 1
    assert "already exists" in capsys.readouterr().err


@pytest.mark.usefixtures("cli_env")
def test_cli_rejects_short_password(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO("short\n"))
    code = cli.main(["create-owner", "--email", "a@example.org", "--password-stdin"])
    assert code == 1
    assert "at least" in capsys.readouterr().err
