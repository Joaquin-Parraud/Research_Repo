"""APA 7 citation of one source and bibliography export (FR-C1 to FR-C4, FR-L3).

References are rendered by the citation service (``citations/processor.py``) in the project's
citation locale.

Disambiguation scope (year suffixes such as ``2020a``, added initials): for one source's citation
it is the whole project, so in-text citations agree with the project's reference list; for an
exported bibliography it is the exported sources, as a reference list requires.
"""

import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.citations.bibtex import to_bibtex
from research_repo.citations.csl import ascii_fold
from research_repo.citations.processor import (
    CiteprocClient,
    Entry,
    ProcessorFailed,
    ProcessorUnavailable,
    Reference,
)
from research_repo.core.errors import AppError, ValidationFailed
from research_repo.models import Project, ProjectRole, Source
from research_repo.services.access import require_project_role
from research_repo.services.folders import (
    UNSET,
    _Unset,
    descendant_ids,
    require_folder_in_project,
)
from research_repo.services.sources import SourceNotFound, load_source

logger = logging.getLogger(__name__)

Format = Literal["text", "html", "bibtex", "csl"]


class CitationUnavailable(AppError):
    status_code = 503
    code = "citation.unavailable"
    message = "The citation service is temporarily unavailable. Try again shortly."


class CitationRenderFailed(AppError):
    status_code = 500
    code = "citation.render_failed"
    message = "The citation processor could not format these references."


@dataclass(frozen=True)
class CitationView:
    locale: str
    entry: Entry


@dataclass(frozen=True)
class Bibliography:
    format: Format
    count: int
    content: str | list[dict[str, Any]]


async def _citation(
    processor: CiteprocClient, locale: str, scope: dict[str, dict[str, Any]], key: str
) -> Entry:
    try:
        return await processor.citation(locale, scope, key)
    except ProcessorUnavailable:
        raise CitationUnavailable from None
    except ProcessorFailed as exc:
        raise CitationRenderFailed(details={"citation_keys": exc.keys}) from None


async def _reference_list(
    processor: CiteprocClient, locale: str, items: dict[str, dict[str, Any]]
) -> list[Reference]:
    try:
        return await processor.reference_list(locale, items)
    except ProcessorUnavailable:
        raise CitationUnavailable from None
    except ProcessorFailed as exc:
        raise CitationRenderFailed(details={"citation_keys": exc.keys}) from None


async def get_citation(
    db: AsyncSession, processor: CiteprocClient, *, user_id: uuid.UUID, source_id: uuid.UUID
) -> CitationView:
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.viewer)
    project = await db.get_one(Project, source.project_id)
    rows = (
        await db.execute(
            select(Source.citation_key, Source.csl).where(Source.project_id == project.id)
        )
    ).all()
    await db.commit()
    entry = await _citation(processor, project.citation_locale, dict(rows), source.citation_key)
    return CitationView(locale=project.citation_locale, entry=entry)


async def _selected_sources(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    source_ids: list[uuid.UUID] | None,
    folder_id: uuid.UUID | _Unset | None,
    include_subfolders: bool,
) -> list[Source]:
    query = select(Source).where(Source.project_id == project_id)
    if source_ids is not None:
        if not isinstance(folder_id, _Unset):
            raise ValidationFailed("Give either source_ids or folder_id, not both.")
        ids = list(dict.fromkeys(source_ids))
        sources = list((await db.scalars(query.where(Source.id.in_(ids)))).all())
        if len(sources) != len(ids):
            raise SourceNotFound
        return sources
    if not isinstance(folder_id, _Unset):
        await require_folder_in_project(db, project_id=project_id, folder_id=folder_id)
        if folder_id is None:
            if not include_subfolders:
                query = query.where(Source.folder_id.is_(None))
        elif include_subfolders:
            query = query.where(Source.folder_id.in_(await descendant_ids(db, folder_id)))
        else:
            query = query.where(Source.folder_id == folder_id)
    return list((await db.scalars(query)).all())


def _fallback_order(source: Source) -> tuple[str, int, str, str]:
    return (
        ascii_fold(source.authors_text or source.title).casefold(),
        source.year if source.year is not None else 10_000,
        ascii_fold(source.title).casefold(),
        source.citation_key,
    )


def _export_item(source: Source) -> dict[str, Any]:
    return {**source.csl, "id": source.citation_key}


async def export_bibliography(
    db: AsyncSession,
    processor: CiteprocClient,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    format: Format,
    source_ids: list[uuid.UUID] | None = None,
    folder_id: uuid.UUID | _Unset | None = UNSET,
    include_subfolders: bool = True,
) -> Bibliography:
    """A reference list for a selection, a folder (optionally with subfolders; ``None`` is the
    project root) or the whole project, in the processor's APA order."""
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.viewer
    )
    project = await db.get_one(Project, project_id)
    sources = await _selected_sources(
        db,
        project_id,
        source_ids=source_ids,
        folder_id=folder_id,
        include_subfolders=include_subfolders,
    )
    await db.commit()
    if not sources:
        return Bibliography(format=format, count=0, content=[] if format == "csl" else "")

    by_key = {s.citation_key: s for s in sources}
    items = {s.citation_key: s.csl for s in sources}
    if format in ("text", "html"):
        entries = await _reference_list(processor, project.citation_locale, items)
        ordered = [by_key[e.key] for e in entries]
    else:
        # BibTeX and CSL-JSON do not need the processor: they are listed in its APA order when
        # it is available, and never fail because it is not.
        entries = []
        try:
            references = await processor.reference_list(project.citation_locale, items)
            ordered = [by_key[r.key] for r in references]
        except (ProcessorUnavailable, ProcessorFailed) as exc:
            logger.warning("%s export without the citation processor's order: %s", format, exc)
            ordered = sorted(sources, key=_fallback_order)

    content: str | list[dict[str, Any]]
    if format == "text":
        content = "\n".join(e.text for e in entries)
    elif format == "html":
        content = "\n".join(f"<p>{e.html}</p>" for e in entries)
    elif format == "bibtex":
        content = "\n\n".join(to_bibtex(s.csl, s.citation_key) for s in ordered) + "\n"
    else:
        content = json.loads(json.dumps([_export_item(s) for s in ordered]))
    return Bibliography(format=format, count=len(sources), content=content)
