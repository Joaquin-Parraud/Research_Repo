"""Projects, membership and the folder tree."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from research_repo.models.base import Base, CreatedAt, UpdatedAt, UUIDPk
from research_repo.models.enums import CITATION_LOCALES, ProjectRole, pg_enum

_locales = ", ".join(f"'{code}'" for code in CITATION_LOCALES)


class Project(Base):
    __tablename__ = "project"
    __table_args__ = (CheckConstraint(f"citation_locale IN ({_locales})", name="citation_locale"),)

    id: Mapped[UUIDPk]
    name: Mapped[str] = mapped_column(Text)
    slug: Mapped[str] = mapped_column(Text, unique=True)
    description: Mapped[str] = mapped_column(Text, server_default="")
    readme_md: Mapped[str] = mapped_column(Text, server_default="")
    citation_locale: Mapped[str] = mapped_column(Text, server_default="en-US")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


class Membership(Base):
    __tablename__ = "membership"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[ProjectRole] = mapped_column(pg_enum(ProjectRole, "project_role"))
    created_at: Mapped[CreatedAt]


class Folder(Base):
    """Adjacency-list tree node. parent_id NULL means the project root."""

    __tablename__ = "folder"
    __table_args__ = (
        UniqueConstraint("project_id", "parent_id", "name", postgresql_nulls_not_distinct=True),
        CheckConstraint("parent_id IS DISTINCT FROM id", name="not_own_parent"),
    )

    id: Mapped[UUIDPk]
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), index=True
    )
    # No ON DELETE action: the service layer decides what happens to children (FR-F2).
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("folder.id"), index=True)
    name: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]
