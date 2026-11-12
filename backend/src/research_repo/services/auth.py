"""Password login and server-side browser sessions."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import InvalidCredentials, NotAuthenticated, RateLimited
from research_repo.core.rate_limit import LoginRateLimiter
from research_repo.core.security import (
    hash_password,
    hash_token,
    new_token,
    password_needs_rehash,
    verify_dummy_password,
    verify_password,
)
from research_repo.models import Session, User
from research_repo.services.users import normalize_email


def _limiter_keys(email: str, client_ip: str | None) -> list[str]:
    keys = [f"email:{email}"]
    if client_ip:
        keys.append(f"ip:{client_ip}")
    return keys


async def authenticate(
    db: AsyncSession,
    limiter: LoginRateLimiter,
    *,
    email: str,
    password: str,
    client_ip: str | None,
) -> User:
    """Check credentials. Unknown emails cost the same argon2 work as wrong passwords."""
    email = normalize_email(email)
    keys = _limiter_keys(email, client_ip)
    if (wait := limiter.retry_after(keys)) is not None:
        raise RateLimited(wait)

    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        verify_dummy_password(password)
        valid = False
    else:
        valid = verify_password(user.password_hash, password)

    if user is None or not valid:
        limiter.record_failure(keys)
        raise InvalidCredentials

    limiter.reset(keys)
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        await db.commit()
    return user


async def create_session(db: AsyncSession, user: User, *, ttl: timedelta) -> str:
    """Open a session and return the raw token for the cookie. Only its hash is stored."""
    now = datetime.now(UTC)
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.expires_at <= now))
    token = new_token()
    db.add(Session(user_id=user.id, token_hash=hash_token(token), expires_at=now + ttl))
    await db.commit()
    return token


async def user_for_session_token(db: AsyncSession, token: str | None) -> User:
    if not token:
        raise NotAuthenticated
    session = await db.scalar(
        select(Session).where(
            Session.token_hash == hash_token(token),
            Session.expires_at > datetime.now(UTC),
        )
    )
    if session is None:
        raise NotAuthenticated
    return session.user


async def end_session(db: AsyncSession, token: str | None) -> None:
    if not token:
        return
    await db.execute(delete(Session).where(Session.token_hash == hash_token(token)))
    await db.commit()
