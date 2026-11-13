"""Stored ``file`` rows: PDF inspection and reference-counted removal (FR-S8)."""

import logging
import uuid
from collections.abc import Collection
from pathlib import Path

from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.pdf import PdfUnreadable, header_offset, open_pdf
from research_repo.models import File, Source

logger = logging.getLogger(__name__)


def looks_like_pdf(head: bytes) -> bool:
    """``head``: the file's first 1024 bytes."""
    return header_offset(head) is not None


def pdf_page_count(path: Path) -> int | None:
    """Page count via pypdf, or None for password-protected or unparseable files. Blocking."""
    try:
        with open_pdf(path) as reader:
            count = len(reader.pages)
    except PdfUnreadable as exc:
        logger.info("Storing PDF %s without a page count: %s", path.name, exc)
        return None
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
