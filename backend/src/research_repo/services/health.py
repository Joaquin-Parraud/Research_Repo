"""Readiness check."""

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import ServiceUnavailable

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5


async def check_database(db: AsyncSession) -> None:
    try:
        async with asyncio.timeout(_TIMEOUT_SECONDS):
            await db.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError) as exc:  # TimeoutError is an OSError
        logger.warning("Database health check failed: %s", exc)
        raise ServiceUnavailable("The database is unreachable.") from exc
