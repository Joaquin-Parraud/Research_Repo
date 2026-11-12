"""Initial schema: accounts, projects, folders, sources, tokens, activity log.

Revision ID: 0001
Revises:
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

project_role = postgresql.ENUM("owner", "editor", "viewer", name="project_role", create_type=False)
token_mode = postgresql.ENUM("read", "read_write", name="token_mode", create_type=False)
metadata_status = postgresql.ENUM(
    "pending", "suggested", "confirmed", name="metadata_status", create_type=False
)
text_status = postgresql.ENUM(
    "none", "queued", "done", "no_text_layer", "failed", name="text_status", create_type=False
)
ENUMS = (project_role, token_mode, metadata_status, text_status)


def _id() -> sa.Column:
    return sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    bind = op.get_bind()
    for enum in ENUMS:
        enum.create(bind)

    op.create_table(
        "users",
        _id(),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), server_default="", nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), server_default="en", nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("language IN ('en', 'es')", name=op.f("ck_users_language")),
        sa.CheckConstraint("email = lower(email)", name=op.f("ck_users_email_lowercase")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )

    op.create_table(
        "session",
        _id(),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name=op.f("fk_session_user_id_users")),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name=op.f("uq_session_token_hash")),
    )
    op.create_index(op.f("ix_session_user_id"), "session", ["user_id"])

    op.create_table(
        "project",
        _id(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("readme_md", sa.Text(), server_default="", nullable=False),
        sa.Column("citation_locale", sa.Text(), server_default="en-US", nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "citation_locale IN ('en-US', 'es')", name=op.f("ck_project_citation_locale")
        ),
        sa.UniqueConstraint("slug", name=op.f("uq_project_slug")),
    )

    op.create_table(
        "membership",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name=op.f("fk_membership_user_id_users")),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey(
                "project.id", ondelete="CASCADE", name=op.f("fk_membership_project_id_project")
            ),
            primary_key=True,
        ),
        sa.Column("role", project_role, nullable=False),
        _created_at(),
    )
    op.create_index(op.f("ix_membership_project_id"), "membership", ["project_id"])

    op.create_table(
        "folder",
        _id(),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey(
                "project.id", ondelete="CASCADE", name=op.f("fk_folder_project_id_project")
            ),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.Uuid(),
            sa.ForeignKey("folder.id", name=op.f("fk_folder_parent_id_folder")),
            nullable=True,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("parent_id IS DISTINCT FROM id", name=op.f("ck_folder_not_own_parent")),
        sa.UniqueConstraint(
            "project_id",
            "parent_id",
            "name",
            name=op.f("uq_folder_project_id_parent_id_name"),
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index(op.f("ix_folder_project_id"), "folder", ["project_id"])
    op.create_index(op.f("ix_folder_parent_id"), "folder", ["parent_id"])

    op.create_table(
        "file",
        _id(),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("original_filename", sa.Text(), nullable=False),
        _created_at(),
        sa.CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_file_sha256_hex")),
        sa.CheckConstraint("size_bytes >= 0", name=op.f("ck_file_size_non_negative")),
        sa.UniqueConstraint("sha256", name=op.f("uq_file_sha256")),
    )

    op.create_table(
        "source",
        _id(),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey(
                "project.id", ondelete="CASCADE", name=op.f("fk_source_project_id_project")
            ),
            nullable=False,
        ),
        sa.Column(
            "folder_id",
            sa.Uuid(),
            sa.ForeignKey("folder.id", name=op.f("fk_source_folder_id_folder")),
            nullable=True,
        ),
        sa.Column("citation_key", sa.Text(), nullable=False),
        sa.Column(
            "csl",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), server_default="", nullable=False),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("authors_text", sa.Text(), server_default="", nullable=False),
        sa.Column("doi", sa.Text(), nullable=True),
        sa.Column(
            "file_id",
            sa.Uuid(),
            sa.ForeignKey("file.id", name=op.f("fk_source_file_id_file")),
            nullable=True,
        ),
        sa.Column("metadata_status", metadata_status, server_default="pending", nullable=False),
        sa.Column("text_status", text_status, server_default="none", nullable=False),
        sa.Column("last_page_read", sa.Integer(), nullable=True),
        _created_at(),
        _updated_at(),
        sa.UniqueConstraint(
            "project_id", "citation_key", name=op.f("uq_source_project_id_citation_key")
        ),
    )
    op.create_index(op.f("ix_source_folder_id"), "source", ["folder_id"])
    op.create_index(op.f("ix_source_file_id"), "source", ["file_id"])
    op.create_index(op.f("ix_source_project_id_doi"), "source", ["project_id", "doi"])

    op.create_table(
        "source_page",
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey(
                "source.id", ondelete="CASCADE", name=op.f("fk_source_page_source_id_source")
            ),
            primary_key=True,
        ),
        sa.Column("page_number", sa.Integer(), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("tsv", postgresql.TSVECTOR(), nullable=False),
        sa.CheckConstraint("page_number >= 1", name=op.f("ck_source_page_page_number_positive")),
    )
    op.create_index(op.f("ix_source_page_tsv"), "source_page", ["tsv"], postgresql_using="gin")

    op.create_table(
        "tag",
        _id(),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("project.id", ondelete="CASCADE", name=op.f("fk_tag_project_id_project")),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        _created_at(),
        sa.UniqueConstraint("project_id", "name", name=op.f("uq_tag_project_id_name")),
    )

    op.create_table(
        "source_tag",
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey(
                "source.id", ondelete="CASCADE", name=op.f("fk_source_tag_source_id_source")
            ),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Uuid(),
            sa.ForeignKey("tag.id", ondelete="CASCADE", name=op.f("fk_source_tag_tag_id_tag")),
            primary_key=True,
        ),
    )
    op.create_index(op.f("ix_source_tag_tag_id"), "source_tag", ["tag_id"])

    op.create_table(
        "api_token",
        _id(),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name=op.f("fk_api_token_user_id_users")),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey(
                "project.id", ondelete="CASCADE", name=op.f("fk_api_token_project_id_project")
            ),
            nullable=True,
        ),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("mode", token_mode, server_default="read", nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.UniqueConstraint("token_hash", name=op.f("uq_api_token_token_hash")),
    )
    op.create_index(op.f("ix_api_token_user_id"), "api_token", ["user_id"])
    op.create_index(op.f("ix_api_token_project_id"), "api_token", ["project_id"])

    op.create_table(
        "activity_log",
        _id(),
        _created_at(),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey(
                "users.id", ondelete="SET NULL", name=op.f("fk_activity_log_user_id_users")
            ),
            nullable=True,
        ),
        sa.Column(
            "api_token_id",
            sa.Uuid(),
            sa.ForeignKey(
                "api_token.id",
                ondelete="SET NULL",
                name=op.f("fk_activity_log_api_token_id_api_token"),
            ),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey(
                "project.id", ondelete="CASCADE", name=op.f("fk_activity_log_project_id_project")
            ),
            nullable=True,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("summary", postgresql.JSONB(), server_default="{}", nullable=False),
    )
    op.create_index(op.f("ix_activity_log_user_id"), "activity_log", ["user_id"])
    op.create_index(op.f("ix_activity_log_api_token_id"), "activity_log", ["api_token_id"])
    op.create_index(
        op.f("ix_activity_log_project_id_created_at"), "activity_log", ["project_id", "created_at"]
    )


def downgrade() -> None:
    for table in (
        "activity_log",
        "api_token",
        "source_tag",
        "tag",
        "source_page",
        "source",
        "file",
        "folder",
        "membership",
        "project",
        "session",
        "users",
    ):
        op.drop_table(table)

    bind = op.get_bind()
    for enum in reversed(ENUMS):
        enum.drop(bind)
