"""Sources, their stored files, extracted pages and tags."""

import uuid
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from research_repo.models.base import Base, CreatedAt, UpdatedAt, UUIDPk
from research_repo.models.enums import MetadataStatus, TextStatus, pg_enum


class File(Base):
    """A stored PDF, content-addressed by sha256 and shared by every source that uses it."""

    __tablename__ = "file"
    __table_args__ = (
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_hex"),
        CheckConstraint("size_bytes >= 0", name="size_non_negative"),
    )

    id: Mapped[UUIDPk]
    sha256: Mapped[str] = mapped_column(Text, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    page_count: Mapped[int | None] = mapped_column(Integer)
    original_filename: Mapped[str] = mapped_column(Text)
    created_at: Mapped[CreatedAt]


class Source(Base):
    __tablename__ = "source"
    __table_args__ = (
        UniqueConstraint("project_id", "citation_key"),
        Index("ix_source_project_id_doi", "project_id", "doi"),
    )

    id: Mapped[UUIDPk]
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    # No ON DELETE action: deleting a folder re-homes its sources in the service layer.
    folder_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("folder.id"), index=True)
    citation_key: Mapped[str] = mapped_column(Text)
    # True while the key follows the metadata (FR-S7); false once a user has set it by hand.
    citation_key_auto: Mapped[bool] = mapped_column(Boolean, server_default=true())
    csl: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    title: Mapped[str] = mapped_column(Text, server_default="")
    year: Mapped[int | None] = mapped_column(Integer)
    authors_text: Mapped[str] = mapped_column(Text, server_default="")
    doi: Mapped[str | None] = mapped_column(Text)
    # A file is shared between projects; it cannot be deleted while a source uses it.
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("file.id"), index=True)
    metadata_status: Mapped[MetadataStatus] = mapped_column(
        pg_enum(MetadataStatus, "metadata_status"),
        server_default=MetadataStatus.pending.value,
    )
    text_status: Mapped[TextStatus] = mapped_column(
        pg_enum(TextStatus, "text_status"),
        server_default=TextStatus.none.value,
    )
    last_page_read: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


class SourcePage(Base):
    """Extracted text of one page. ``tsv`` is built with the source's language configuration."""

    __tablename__ = "source_page"
    __table_args__ = (
        Index("ix_source_page_tsv", "tsv", postgresql_using="gin"),
        CheckConstraint("page_number >= 1", name="page_number_positive"),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source.id", ondelete="CASCADE"), primary_key=True
    )
    page_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    tsv: Mapped[str] = mapped_column(TSVECTOR)


class Tag(Base):
    __tablename__ = "tag"
    __table_args__ = (UniqueConstraint("project_id", "name"),)

    id: Mapped[UUIDPk]
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[CreatedAt]


class SourceTag(Base):
    __tablename__ = "source_tag"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tag.id", ondelete="CASCADE"), primary_key=True, index=True
    )
