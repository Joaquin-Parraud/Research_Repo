"""Citations (M2): automatic citation keys flag, CSL for existing sources, orphan tags.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12

Data steps (upgrade only; downgrade keeps the data, it only drops the new column):

* sources whose ``csl`` is still empty get a minimal item ``{"type": "document", "title": …}``
  so that ``csl`` is always a valid CSL-JSON item;
* tags that no source uses any more are deleted (from now on the service layer deletes them as
  they become unused).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "source",
        sa.Column("citation_key_auto", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.execute(
        "UPDATE source SET csl = jsonb_build_object('type', 'document', 'title', title) "
        "WHERE csl = '{}'::jsonb"
    )
    op.execute(
        "DELETE FROM tag WHERE NOT EXISTS "
        "(SELECT 1 FROM source_tag WHERE source_tag.tag_id = tag.id)"
    )


def downgrade() -> None:
    op.drop_column("source", "citation_key_auto")
