"""ASGI application factory. Run with ``uvicorn --factory research_repo.main:create_app``."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from research_repo.api import api_router
from research_repo.core.config import Settings, get_settings
from research_repo.core.db import create_engine, create_sessionmaker
from research_repo.core.errors import install_error_handlers
from research_repo.core.rate_limit import LoginRateLimiter
from research_repo.services.users import bootstrap_owner


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings.database_url)
        app.state.sessionmaker = create_sessionmaker(engine)
        try:
            settings.storage_dir.mkdir(parents=True, exist_ok=True)
            async with app.state.sessionmaker() as db:
                await bootstrap_owner(
                    db,
                    email=settings.owner_email,
                    password=(
                        settings.owner_password.get_secret_value()
                        if settings.owner_password
                        else None
                    ),
                    display_name=settings.owner_display_name,
                )
            yield
        finally:
            await engine.dispose()

    app = FastAPI(
        title="Research Repo",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.login_limiter = LoginRateLimiter(
        max_failures=settings.login_rate_limit_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )
    install_error_handlers(app)
    app.include_router(api_router)
    return app
