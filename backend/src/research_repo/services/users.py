"""User accounts: owner bootstrap and profile updates."""

import logging

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import AppError
from research_repo.core.security import hash_password
from research_repo.models import User

logger = logging.getLogger(__name__)

MIN_PASSWORD_LENGTH = 8


class OwnerAlreadyExists(AppError):
    status_code = 409
    code = "auth.owner_exists"
    message = "An owner account already exists."


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_new_credentials(email: str, password: str) -> None:
    local, _, domain = email.partition("@")
    if not local or not domain:
        raise AppError("Email address is invalid.", code="validation.invalid")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AppError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
            code="validation.invalid",
        )


async def any_user_exists(db: AsyncSession) -> bool:
    return bool(await db.scalar(select(exists().select_from(User))))


async def create_owner(
    db: AsyncSession, *, email: str, password: str, display_name: str = ""
) -> User:
    """Create the instance owner. Refuses if any user already exists."""
    email = normalize_email(email)
    validate_new_credentials(email, password)
    if await any_user_exists(db):
        raise OwnerAlreadyExists
    user = User(
        email=email,
        display_name=display_name.strip(),
        password_hash=hash_password(password),
    )
    db.add(user)
    await db.commit()
    logger.info("Created owner account %s", email)
    return user


async def bootstrap_owner(
    db: AsyncSession, *, email: str | None, password: str | None, display_name: str = ""
) -> User | None:
    """Create the owner from configuration on first start; a no-op once any user exists."""
    if not email or not password or await any_user_exists(db):
        return None
    return await create_owner(db, email=email, password=password, display_name=display_name)


async def update_profile(
    db: AsyncSession,
    user: User,
    *,
    language: str | None = None,
    display_name: str | None = None,
) -> User:
    if language is not None:
        user.language = language
    if display_name is not None:
        user.display_name = display_name
    await db.commit()
    await db.refresh(user)
    return user
