"""Accounts, login sessions and API tokens."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from research_repo.models.base import Base, CreatedAt, UpdatedAt, UUIDPk
from research_repo.models.enums import INTERFACE_LANGUAGES, TokenMode, pg_enum

_languages = ", ".join(f"'{code}'" for code in INTERFACE_LANGUAGES)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(f"language IN ({_languages})", name="language"),
        CheckConstraint("email = lower(email)", name="email_lowercase"),
    )

    id: Mapped[UUIDPk]
    email: Mapped[str] = mapped_column(Text, unique=True)
    display_name: Mapped[str] = mapped_column(Text, server_default="")
    password_hash: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(Text, server_default="en")
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


class Session(Base):
    """A browser login. Only the sha256 of the cookie token is stored."""

    __tablename__ = "session"

    id: Mapped[UUIDPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[CreatedAt]
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(lazy="joined")


class ApiToken(Base):
    """Token for MCP/API clients. Effective rights = min(mode, user's role in the project)."""

    __tablename__ = "api_token"

    id: Mapped[UUIDPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(Text)
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    mode: Mapped[TokenMode] = mapped_column(
        pg_enum(TokenMode, "token_mode"),
        server_default=TokenMode.read.value,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[CreatedAt]
