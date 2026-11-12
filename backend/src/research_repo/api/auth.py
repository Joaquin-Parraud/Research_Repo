"""/api/auth: login, logout and the current user."""

from datetime import timedelta

from fastapi import APIRouter, Request, Response, status

from research_repo.api.deps import (
    SESSION_COOKIE,
    AppSettings,
    CurrentUser,
    DbSession,
    SessionToken,
)
from research_repo.core.config import Settings
from research_repo.core.rate_limit import LoginRateLimiter
from research_repo.schemas.auth import LoginRequest, UserOut, UserUpdate
from research_repo.services import auth as auth_service
from research_repo.services import users as users_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(timedelta(days=settings.session_ttl_days).total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
) -> UserOut:
    limiter: LoginRateLimiter = request.app.state.login_limiter
    user = await auth_service.authenticate(
        db,
        limiter,
        email=body.email,
        password=body.password,
        client_ip=request.client.host if request.client else None,
    )
    token = await auth_service.create_session(
        db, user, ttl=timedelta(days=settings.session_ttl_days)
    )
    _set_session_cookie(response, token, settings)
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(db: DbSession, settings: AppSettings, token: SessionToken = None) -> Response:
    await auth_service.end_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure
    )
    return response


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me")
async def update_me(body: UserUpdate, user: CurrentUser, db: DbSession) -> UserOut:
    updated = await users_service.update_profile(
        db, user, language=body.language, display_name=body.display_name
    )
    return UserOut.model_validate(updated)
