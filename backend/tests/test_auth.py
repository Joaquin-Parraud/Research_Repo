from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.config import Settings
from research_repo.core.security import hash_token
from research_repo.main import create_app
from research_repo.models import Session, User
from research_repo.services import auth as auth_service
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD


def _user_json(user: User) -> dict[str, str]:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "language": user.language,
    }


async def test_login_success_sets_session_cookie(
    client: httpx.AsyncClient, owner: User, db: AsyncSession
) -> None:
    response = await client.post(
        "/api/auth/login", json={"email": "  Owner@Example.ORG ", "password": OWNER_PASSWORD}
    )

    assert response.status_code == 200
    assert response.json() == _user_json(owner)

    set_cookie = response.headers["set-cookie"]
    assert set_cookie.startswith("rr_session=")
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Secure" not in set_cookie
    assert f"Max-Age={30 * 24 * 3600}" in set_cookie

    token = response.cookies["rr_session"]
    stored = await db.scalar(select(Session).where(Session.user_id == owner.id))
    assert stored is not None
    assert stored.token_hash == hash_token(token)
    assert stored.token_hash != token


async def test_cookie_secure_flag_follows_setting(settings: Settings, owner: User) -> None:
    app = create_app(settings.model_copy(update={"cookie_secure": True}))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            response = await c.post(
                "/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
            )
    assert response.status_code == 200
    assert "Secure" in response.headers["set-cookie"]


@pytest.mark.parametrize(
    ("email", "password"),
    [(OWNER_EMAIL, "wrong password"), ("nobody@example.org", OWNER_PASSWORD)],
    ids=["wrong-password", "unknown-email"],
)
async def test_login_failure(
    client: httpx.AsyncClient, owner: User, email: str, password: str
) -> None:
    response = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "auth.invalid_credentials", "message": "Invalid email or password."}
    }
    assert "set-cookie" not in response.headers


async def test_unknown_email_still_runs_a_password_verification(
    client: httpx.AsyncClient, owner: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(auth_service, "verify_dummy_password", calls.append)
    response = await client.post(
        "/api/auth/login", json={"email": "nobody@example.org", "password": "guess"}
    )
    assert response.status_code == 401
    assert calls == ["guess"]


async def test_login_rate_limited_after_repeated_failures(settings: Settings, owner: User) -> None:
    app = create_app(settings.model_copy(update={"login_rate_limit_attempts": 3}))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            for _ in range(3):
                bad = await c.post(
                    "/api/auth/login", json={"email": OWNER_EMAIL, "password": "nope"}
                )
                assert bad.status_code == 401
            blocked = await c.post(
                "/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
            )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "auth.rate_limited"
    assert int(blocked.headers["retry-after"]) > 0


async def test_me_requires_login(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "auth.not_authenticated", "message": "Authentication required."}
    }


async def test_me_rejects_unknown_token(client: httpx.AsyncClient, owner: User) -> None:
    client.cookies.set("rr_session", "forged-token")
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


async def test_me_returns_current_user(client: httpx.AsyncClient, logged_in: User) -> None:
    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == _user_json(logged_in)


async def test_expired_session_is_rejected(
    client: httpx.AsyncClient, logged_in: User, db: AsyncSession
) -> None:
    await db.execute(
        update(Session)
        .where(Session.user_id == logged_in.id)
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await db.commit()
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


async def test_logout_ends_session_and_clears_cookie(
    client: httpx.AsyncClient, logged_in: User, db: AsyncSession
) -> None:
    token = client.cookies["rr_session"]
    response = await client.post("/api/auth/logout")

    assert response.status_code == 204
    assert response.content == b""
    set_cookie = response.headers["set-cookie"]
    assert set_cookie.startswith('rr_session=""') or set_cookie.startswith("rr_session=;")
    assert "Max-Age=0" in set_cookie
    remaining = await db.scalar(
        select(func.count()).select_from(Session).where(Session.token_hash == hash_token(token))
    )
    assert remaining == 0

    client.cookies.set("rr_session", token)  # replaying the old token must not work
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_logout_without_session_is_noop(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/auth/logout")
    assert response.status_code == 204


async def test_update_language_and_display_name(client: httpx.AsyncClient, logged_in: User) -> None:
    response = await client.patch("/api/auth/me", json={"language": "es"})
    assert response.status_code == 200
    assert response.json()["language"] == "es"
    assert response.json()["display_name"] == "Owner"

    response = await client.patch("/api/auth/me", json={"display_name": "  Joaquín  "})
    assert response.status_code == 200
    assert response.json()["display_name"] == "Joaquín"
    assert response.json()["language"] == "es"

    assert (await client.get("/api/auth/me")).json()["language"] == "es"


@pytest.mark.parametrize(
    "body",
    [{"language": "fr"}, {"language": None}, {"display_name": "   "}, {"email": "x@y.z"}],
    ids=["unsupported-language", "null", "blank-name", "unknown-field"],
)
async def test_update_me_rejects_invalid_input(
    client: httpx.AsyncClient, logged_in: User, body: dict[str, object]
) -> None:
    response = await client.patch("/api/auth/me", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.invalid"


async def test_update_me_requires_login(client: httpx.AsyncClient) -> None:
    response = await client.patch("/api/auth/me", json={"language": "es"})
    assert response.status_code == 401
