"""REST API routers, mounted under /api."""

from fastapi import APIRouter

from research_repo.api import auth, folders, health, metadata, projects, sources

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(folders.router)
api_router.include_router(sources.router)
api_router.include_router(metadata.router)
