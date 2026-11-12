"""/api/health: liveness plus database connectivity."""

from fastapi import APIRouter

from research_repo.api.deps import DbSession
from research_repo.services.health import check_database

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: DbSession) -> dict[str, str]:
    await check_database(db)
    return {"status": "ok"}
