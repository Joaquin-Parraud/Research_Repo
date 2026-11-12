import httpx

from research_repo.core.config import Settings
from research_repo.main import create_app

UNREACHABLE_DB = "postgresql+asyncpg://nobody@127.0.0.1:1/nothing"


async def test_health_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_reports_unreachable_database(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"database_url": UNREACHABLE_DB}))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            response = await c.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "server.unavailable", "message": "The database is unreachable."}
    }
