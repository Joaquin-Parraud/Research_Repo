"""Shared FastAPI dependencies."""

from typing import Annotated

from fastapi import Cookie, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.citations.processor import CiteprocClient
from research_repo.core.config import Settings
from research_repo.core.db import get_db
from research_repo.core.storage import FileStorage
from research_repo.models import User
from research_repo.services import auth as auth_service
from research_repo.services.metadata import MetadataLookup

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


def get_metadata_lookup(request: Request) -> MetadataLookup:
    lookup: MetadataLookup = request.app.state.metadata_lookup
    return lookup


Lookup = Annotated[MetadataLookup, Depends(get_metadata_lookup)]


def get_citeproc(request: Request) -> CiteprocClient:
    client: CiteprocClient = request.app.state.citeproc
    return client


Processor = Annotated[CiteprocClient, Depends(get_citeproc)]
