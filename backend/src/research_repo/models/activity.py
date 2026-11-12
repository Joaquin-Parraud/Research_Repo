"""Audit trail of changes, written for every MCP write and reused for collaborator activity."""

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from research_repo.models.base import Base, CreatedAt, UUIDPk


class ActivityLog(Base):
    __tablename__ = "activity_log"
    __table_args__ = (Index("ix_activity_log_project_id_created_at", "project_id", "created_at"),)

    id: Mapped[UUIDPk]
    created_at: Mapped[CreatedAt]
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Set when the change came through an API token (MCP).
    api_token_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("api_token.id", ondelete="SET NULL"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE")
    )
    action: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(Text)
    target_id: Mapped[uuid.UUID | None]
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
