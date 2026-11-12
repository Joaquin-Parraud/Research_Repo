"""Stored ``file`` rows: PDF inspection and reference-counted removal (FR-S8)."""

import logging
import uuid
from collections.abc import Collection
from pathlib import Path

from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.models import File, Source

logger = logging.getLogger(__name__)

PDF_MAGIC = b"%PDF-"
PDF_EOF = b"%%EOF"
_EOF_SEARCH_BYTES = 1024


def looks_like_pdf(head: bytes) -> bool:
    return head.startswith(PDF_MAGIC)


def pdf_page_count(path: Path) -> int | None:
    """Page count via pypdf, or None for encrypted or unparseable files. Blocking."""
    from pypdf import PdfReader  # heavy import, only needed for uploads

    try:
        # An open file, not a path: given a path, pypdf reads the whole file into memory.
        with path.open("rb") as fh:
            # Without an end marker pypdf's recovery reads the whole file (memory ~2x its
            # size); such files are stored without a page count instead.
            fh.seek(max(0, path.stat().st_size - _EOF_SEARCH_BYTES))
            if PDF_EOF not in fh.read():
                return None
            fh.seek(0)
            reader = PdfReader(fh, strict=False)
            if reader.is_encrypted:
                return None
            count = len(reader.pages)
    except Exception:  # pypdf raises many types for damaged files
        logger.info("Could not parse PDF %s; storing it without a page count", path.name)
        return None
    return count if count > 0 else None


async def delete_unreferenced_files(db: AsyncSession, file_ids: Collection[uuid.UUID]) -> list[str]:
    """Delete the given file rows that no source references. Returns their sha256 values.

    Call under ``FileStorage.lock`` and remove the blobs only after the commit.
    """
    if not file_ids:
        return []
    result = await db.execute(
        delete(File)
        .where(
            File.id.in_(list(file_ids)),
            ~exists(select(Source.id).where(Source.file_id == File.id)),
        )
        .returning(File.sha256)
    )
    return list(result.scalars().all())
