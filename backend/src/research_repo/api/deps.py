"""Shared FastAPI dependencies."""

from typing import Annotated

from fastapi import Cookie, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.config import Settings
from research_repo.core.db import get_db
from research_repo.core.storage import FileStorage
from research_repo.models import User
from research_repo.services import auth as auth_service

SESSION_COOKIE = "rr_session"

DbSession = Annotated[AsyncSession, Depends(get_db)]
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


AppSettings = Annotated[Settings, Depends(get_app_settings)]


async def get_current_user(db: DbSession, token: SessionToken = None) -> User:
    return await auth_service.user_for_session_token(db, token)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_storage(request: Request) -> FileStorage:
    storage: FileStorage = request.app.state.storage
    return storage


Storage = Annotated[FileStorage, Depends(get_storage)]
