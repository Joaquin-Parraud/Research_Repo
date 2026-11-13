"""Sources: add (PDF upload or citation-only), attach a PDF, edit metadata, tag, move, delete.

FR-S1 to FR-S8, FR-C1, FR-R2. ``csl`` is the canonical metadata; ``title``, ``authors_text``,
``year`` and ``doi`` are derived from it on every change (see ``citations/csl.py``). Citation
keys follow the metadata while ``citation_key_auto`` is true (``citations/keys.py``); every key
allocation runs under the project row lock, so keys stay unique without retries.
"""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.citations.csl import InvalidCsl, derive, minimal_csl, validate_csl
from research_repo.citations.keys import first_free_key, is_valid_key, key_base
from research_repo.core.errors import AppError, NotFound, ValidationFailed
from research_repo.core.storage import FileStorage, StagedFile
from research_repo.core.text import name_key, strip_control
from research_repo.models import (
    File,
    MetadataStatus,
    ProjectRole,
    Source,
    SourceTag,
    Tag,
    TextStatus,
)
from research_repo.services.access import ProjectNotFound, require_project_role
from research_repo.services.files import delete_unreferenced_files, looks_like_pdf, pdf_page_count
from research_repo.services.folders import UNSET, _Unset, require_folder_in_project
from research_repo.services.metadata import MetadataLookup, Suggestion
from research_repo.services.projects import lock_project

logger = logging.getLogger(__name__)

MAX_TITLE_LENGTH = 1000
MAX_TAG_LENGTH = 100
MAX_TAGS = 100
MAX_FILENAME_LENGTH = 255
# The page count is read in a worker thread; past this, the file is stored without one (the
# thread finishes on its own).
PAGE_COUNT_TIMEOUT_SECONDS = 15.0


class SourceNotFound(NotFound):
    code = "source.not_found"
    message = "Source not found."


class InvalidPdf(AppError):
    status_code = 422
    code = "source.invalid_pdf"
    message = "The file is not a PDF."


class FileTooLarge(AppError):
    status_code = 413
    code = "source.file_too_large"
    message = "The file is larger than the upload limit."


class DuplicateFile(AppError):
    status_code = 409
    code = "source.duplicate_file"
    message = "This file is already in the project."

    def __init__(self, existing_source_id: uuid.UUID) -> None:
        super().__init__(details={"existing_source_id": str(existing_source_id)})


class AlreadyHasFile(AppError):
    status_code = 409
    code = "source.already_has_file"
    message = "This source already has a file."


class MoveInvalid(AppError):
    status_code = 422
    code = "source.move_invalid"
    message = "The sources and the target folder must all belong to one project."


class NoFile(NotFound):
    code = "source.no_file"
    message = "This source has no file."


class CitationKeyConflict(AppError):
    status_code = 409
    code = "source.citation_key_conflict"
    message = "Another source in this project already uses this citation key."


class CslInvalid(AppError):
    status_code = 422
    code = "metadata.invalid_csl"
    message = "The metadata is not a valid CSL-JSON item."

    def __init__(self, reason: str) -> None:
        super().__init__(details={"reason": reason})


@dataclass(frozen=True)
class SourceView:
    source: Source
    file: File | None
    tags: list[str]


@dataclass(frozen=True)
class SourceSummary:
    source: Source
    page_count: int | None


# --- helpers -------------------------------------------------------------------------------


def clean_title(title: str) -> str:
    title = " ".join(strip_control(title).split())
    if not title or len(title) > MAX_TITLE_LENGTH:
        raise ValidationFailed(f"Titles must be 1 to {MAX_TITLE_LENGTH} characters.")
    return title


def clean_filename(filename: str) -> str:
    """Last path component, without control characters; never empty."""
    name = PureWindowsPath(PurePosixPath(filename).name).name
    name = strip_control(name).strip()
    if len(name) > MAX_FILENAME_LENGTH:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: MAX_FILENAME_LENGTH - len(ext) - 1] + dot + ext) if dot else name
        name = name[:MAX_FILENAME_LENGTH]
    return name or "document.pdf"


def title_from_filename(filename: str) -> str:
    stem, dot, _ = filename.rpartition(".")
    title = " ".join(strip_control(stem if dot and stem else filename).split())
    return title[:MAX_TITLE_LENGTH] or "Untitled"


def clean_tags(tags: Sequence[str]) -> list[str]:
    """Trimmed, case-insensitively de-duplicated (first spelling wins), order kept."""
    result: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        tag = " ".join(strip_control(raw).split())
        if not tag or len(tag) > MAX_TAG_LENGTH:
            raise ValidationFailed(f"Tags must be 1 to {MAX_TAG_LENGTH} characters.")
        if (key := name_key(tag)) not in seen:
            seen.add(key)
            result.append(tag)
    if len(result) > MAX_TAGS:
        raise ValidationFailed(f"A source can have at most {MAX_TAGS} tags.")
    return result


def validated_csl(value: object) -> dict[str, Any]:
    try:
        return validate_csl(value)
    except InvalidCsl as exc:
        raise CslInvalid(str(exc)) from None


async def load_source(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    source_id: uuid.UUID,
    minimum: ProjectRole,
    for_update: bool = False,
    allow_archived: bool = False,
) -> Source:
    source = await db.get(Source, source_id, with_for_update=for_update)
    if source is None:
        raise SourceNotFound
    try:
        await require_project_role(
            db,
            user_id=user_id,
            project_id=source.project_id,
            minimum=minimum,
            allow_archived=allow_archived,
        )
    except ProjectNotFound:
        raise SourceNotFound from None
    return source


async def _tags_of(db: AsyncSession, source_id: uuid.UUID) -> list[str]:
    names = await db.scalars(
        select(Tag.name)
        .join(SourceTag, SourceTag.tag_id == Tag.id)
        .where(SourceTag.source_id == source_id)
        .order_by(func.lower(Tag.name), Tag.name)
    )
    return list(names.all())


async def _view(db: AsyncSession, source: Source) -> SourceView:
    file = await db.get(File, source.file_id) if source.file_id else None
    return SourceView(source=source, file=file, tags=await _tags_of(db, source.id))


async def delete_orphan_tags(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Delete the project's tags that no source uses (owner decision: no unused tags)."""
    await db.execute(
        delete(Tag)
        .where(
            Tag.project_id == project_id,
            ~exists(select(SourceTag.tag_id).where(SourceTag.tag_id == Tag.id)),
        )
        .execution_options(synchronize_session=False)
    )


async def _taken_keys(
    db: AsyncSession, project_id: uuid.UUID, base: str, *, exclude: uuid.UUID | None
) -> set[str]:
    query = select(Source.citation_key).where(
        Source.project_id == project_id, Source.citation_key.startswith(base, autoescape=True)
    )
    if exclude is not None:
        query = query.where(Source.id != exclude)
    return set((await db.scalars(query)).all())


async def _auto_key(
    db: AsyncSession, project_id: uuid.UUID, item: dict[str, Any], *, exclude: uuid.UUID | None
) -> str:
    """First free key for the item. Caller holds the project lock."""
    base = key_base(item)
    return first_free_key(base, await _taken_keys(db, project_id, base, exclude=exclude))


async def _set_csl(db: AsyncSession, source: Source, item: dict[str, Any]) -> None:
    """Store a validated item and everything derived from it; regenerate an automatic key."""
    derived = derive(item)
    source.csl = item
    source.title = derived.title
    source.authors_text = derived.authors_text
    source.year = derived.year
    source.doi = derived.doi
    if source.citation_key_auto:
        await lock_project(db, source.project_id)
        source.citation_key = await _auto_key(db, source.project_id, item, exclude=source.id)


async def _insert_source(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    item: dict[str, Any],
    file_id: uuid.UUID | None,
) -> Source:
    await lock_project(db, project_id)
    derived = derive(item)
    source = Source(
        project_id=project_id,
        folder_id=folder_id,
        csl=item,
        title=derived.title,
        authors_text=derived.authors_text,
        year=derived.year,
        doi=derived.doi,
        citation_key=await _auto_key(db, project_id, item, exclude=None),
        citation_key_auto=True,
        file_id=file_id,
        metadata_status=MetadataStatus.pending,
        text_status=TextStatus.none,
    )
    db.add(source)
    await db.flush()
    return source


async def _file_for_upload(
    db: AsyncSession,
    staged: StagedFile,
    *,
    project_id: uuid.UUID,
    page_count: int | None,
    allow_duplicate: bool,
) -> tuple[File, bool]:
    """The ``file`` row for staged content (existing or new) and whether it was created.
    Raises DuplicateFile when the content is already in the project. Call under the storage
    lock."""
    file = await db.scalar(select(File).where(File.sha256 == staged.sha256))
    if file is not None and not allow_duplicate:
        existing = await db.scalar(
            select(Source.id)
            .where(Source.project_id == project_id, Source.file_id == file.id)
            .order_by(Source.created_at, Source.id)
            .limit(1)
        )
        if existing is not None:
            raise DuplicateFile(existing)
    if file is not None:
        return file, False
    file = File(
        sha256=staged.sha256,
        size_bytes=staged.size,
        page_count=page_count,
        original_filename=clean_filename(staged.original_filename),
    )
    db.add(file)
    await db.flush()
    return file, True


async def _checked_pdf(staged: StagedFile) -> int | None:
    """Reject non-PDFs; return the page count (None if unreadable or too slow to count: a
    pathological file can keep the parser busy for minutes, and the upload must answer)."""
    if staged.size == 0 or not looks_like_pdf(staged.head):
        raise InvalidPdf
    await staged.finish()
    try:
        async with asyncio.timeout(PAGE_COUNT_TIMEOUT_SECONDS):
            return await asyncio.to_thread(pdf_page_count, staged.path)
    except TimeoutError:
        logger.info("Counting the pages of %s ran out of time", staged.original_filename)
        return None


async def _apply_suggestion(db: AsyncSession, source_id: uuid.UUID, suggestion: Suggestion) -> None:
    """Store a suggestion on a source that is still ``pending``. Never raises."""
    if suggestion.csl is None:
        return
    try:
        source = await db.get(Source, source_id, with_for_update=True, populate_existing=True)
        if source is not None and source.metadata_status == MetadataStatus.pending:
            await _set_csl(db, source, suggestion.csl)
            source.metadata_status = MetadataStatus.suggested
        await db.commit()
    except Exception:
        logger.exception("Could not store the metadata suggestion for source %s", source_id)
        await db.rollback()


async def _suggest_after_store(
    db: AsyncSession,
    storage: FileStorage,
    lookup: MetadataLookup | None,
    source_id: uuid.UUID,
    sha256: str,
) -> None:
    if lookup is None:
        return
    try:
        suggestion = await lookup.suggest(storage.blob_path(sha256))
    except Exception:  # suggest() should not raise; an upload never fails because of it
        logger.exception("Metadata suggestion failed for source %s", source_id)
        return
    await _apply_suggestion(db, source_id, suggestion)


# --- operations ----------------------------------------------------------------------------


async def ensure_can_add_sources(
    db: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID
) -> None:
    """Role check before an upload body is read. Ends the (read-only) transaction, so no
    database connection is held while the file streams in. Commit, not rollback: a rollback
    would expire objects already loaded in the session, such as the current user.
    """
    try:
        await require_project_role(
            db, user_id=user_id, project_id=project_id, minimum=ProjectRole.editor
        )
    finally:
        await db.commit()


async def create_source(
    db: AsyncSession,
    storage: FileStorage,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    title: str | None = None,
    folder_id: uuid.UUID | None = None,
    staged: StagedFile | None = None,
    allow_duplicate: bool = False,
    lookup: MetadataLookup | None = None,
) -> SourceView:
    """Add one source. With ``staged`` (a fully received upload) the PDF is checked, stored
    once per content hash and linked, then metadata is suggested from it (``lookup``); without
    it the source is citation-only and needs a title. The caller still owns ``staged`` and
    must ``discard()`` it afterwards.
    """
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.editor
    )
    if title is not None and title.strip():
        title = clean_title(title)
    elif staged is not None:
        title = title_from_filename(clean_filename(staged.original_filename))
    else:
        raise ValidationFailed("A title is required for a source without a file.")
    await require_folder_in_project(db, project_id=project_id, folder_id=folder_id)
    item = minimal_csl(title)

    if staged is None:
        source = await _insert_source(
            db, project_id=project_id, folder_id=folder_id, item=item, file_id=None
        )
        await db.commit()
        await db.refresh(source)
        return await _view(db, source)

    page_count = await _checked_pdf(staged)
    sha256 = staged.sha256
    async with storage.lock:
        created = False
        try:
            file, created = await _file_for_upload(
                db,
                staged,
                project_id=project_id,
                page_count=page_count,
                allow_duplicate=allow_duplicate,
            )
            source = await _insert_source(
                db, project_id=project_id, folder_id=folder_id, item=item, file_id=file.id
            )
            await storage.place(staged)
            await db.commit()
        except BaseException:
            await db.rollback()
            if created:  # the blob, if placed, belongs to no committed row
                await storage.remove(sha256)
            raise
    source_id = source.id
    await _suggest_after_store(db, storage, lookup, source_id, sha256)
    source = await db.get_one(Source, source_id, populate_existing=True)
    return await _view(db, source)


async def ensure_can_attach(db: AsyncSession, *, user_id: uuid.UUID, source_id: uuid.UUID) -> None:
    """Checks before an attach body is read; ends the transaction (see ensure_can_add_sources)."""
    try:
        source = await load_source(
            db, user_id=user_id, source_id=source_id, minimum=ProjectRole.editor
        )
        if source.file_id is not None:
            raise AlreadyHasFile
    finally:
        await db.commit()


async def attach_file(
    db: AsyncSession,
    storage: FileStorage,
    *,
    user_id: uuid.UUID,
    source_id: uuid.UUID,
    staged: StagedFile,
    allow_duplicate: bool = False,
    lookup: MetadataLookup | None = None,
) -> SourceView:
    """Give a citation-only source its PDF (same checks and storage rules as an upload).
    Confirmed or suggested metadata is kept; a ``pending`` source gets a suggestion."""
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.editor)
    if source.file_id is not None:
        raise AlreadyHasFile
    page_count = await _checked_pdf(staged)
    sha256 = staged.sha256
    async with storage.lock:
        created = False
        try:
            source = await db.get_one(
                Source, source_id, with_for_update=True, populate_existing=True
            )
            if source.file_id is not None:
                raise AlreadyHasFile
            file, created = await _file_for_upload(
                db,
                staged,
                project_id=source.project_id,
                page_count=page_count,
                allow_duplicate=allow_duplicate,
            )
            source.file_id = file.id
            pending = source.metadata_status == MetadataStatus.pending
            await storage.place(staged)
            await db.commit()
        except BaseException:
            await db.rollback()
            if created:
                await storage.remove(sha256)
            raise
    if pending:
        await _suggest_after_store(db, storage, lookup, source_id, sha256)
    source = await db.get_one(Source, source_id, populate_existing=True)
    return await _view(db, source)


async def get_source(db: AsyncSession, *, user_id: uuid.UUID, source_id: uuid.UUID) -> SourceView:
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.viewer)
    return await _view(db, source)


async def suggest_metadata(
    db: AsyncSession,
    storage: FileStorage,
    lookup: MetadataLookup,
    *,
    user_id: uuid.UUID,
    source_id: uuid.UUID,
) -> Suggestion:
    """Run the suggestion pipeline again and return the result without saving it."""
    source = await load_source(
        db,
        user_id=user_id,
        source_id=source_id,
        minimum=ProjectRole.editor,
        allow_archived=True,
    )
    file = await db.get(File, source.file_id) if source.file_id else None
    await db.commit()  # release the connection during the lookup
    if file is None:
        return Suggestion(csl=None, origin="none", doi=None)
    return await lookup.suggest(storage.blob_path(file.sha256))


async def _replace_tags(db: AsyncSession, source: Source, names: list[str]) -> None:
    existing = {
        name_key(tag.name): tag
        for tag in (await db.scalars(select(Tag).where(Tag.project_id == source.project_id)))
    }
    tag_ids: list[uuid.UUID] = []
    for name in names:
        tag = existing.get(name_key(name))
        if tag is None:
            tag = Tag(project_id=source.project_id, name=name)
            db.add(tag)
            await db.flush()
            existing[name_key(name)] = tag
        tag_ids.append(tag.id)
    await db.execute(delete(SourceTag).where(SourceTag.source_id == source.id))
    db.add_all(SourceTag(source_id=source.id, tag_id=tag_id) for tag_id in tag_ids)
    await db.flush()
    await delete_orphan_tags(db, source.project_id)


async def _set_manual_key(db: AsyncSession, source: Source, key: str) -> None:
    if not is_valid_key(key):
        raise ValidationFailed(
            "Citation keys are 1 to 64 lowercase letters, digits, hyphens or underscores."
        )
    await lock_project(db, source.project_id)
    clash = await db.scalar(
        select(Source.id).where(
            Source.project_id == source.project_id,
            Source.citation_key == key,
            Source.id != source.id,
        )
    )
    if clash is not None:
        raise CitationKeyConflict
    source.citation_key = key
    source.citation_key_auto = False


async def update_source(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    source_id: uuid.UUID,
    title: str | _Unset = UNSET,
    folder_id: uuid.UUID | _Unset | None = UNSET,
    last_page_read: int | _Unset = UNSET,
    tags: Sequence[str] | _Unset = UNSET,
    csl: object = UNSET,
    metadata_status: str | _Unset = UNSET,
    citation_key: str | _Unset | None = UNSET,
) -> SourceView:
    """Partial update. ``last_page_read`` is reading state, so viewers may set it alone (also
    in an archived project).

    ``csl`` replaces the stored item; ``title`` alone updates ``csl.title``. ``citation_key``
    sets a manual key; ``None`` returns to the automatic one. ``metadata_status`` accepts only
    ``confirmed``.
    """
    edits = [
        v for v in (title, folder_id, tags, csl, metadata_status, citation_key) if v is not UNSET
    ]
    minimum = ProjectRole.editor if edits else ProjectRole.viewer
    source = await load_source(
        db, user_id=user_id, source_id=source_id, minimum=minimum, for_update=True
    )
    item: dict[str, Any] | None = None
    if not isinstance(csl, _Unset):
        item = validated_csl(csl)
    if not isinstance(title, _Unset):
        item = dict(item if item is not None else source.csl or minimal_csl(source.title))
        item["title"] = clean_title(title)
        item = validated_csl(item)
    if not isinstance(metadata_status, _Unset):
        if metadata_status != MetadataStatus.confirmed:
            raise ValidationFailed("metadata_status can only be set to confirmed.")
        source.metadata_status = MetadataStatus.confirmed
    if citation_key is None:
        source.citation_key_auto = True
    elif not isinstance(citation_key, _Unset):
        await _set_manual_key(db, source, citation_key)
    if item is not None:
        await _set_csl(db, source, item)
    elif citation_key is None:  # back to automatic: regenerate from the current metadata
        await _set_csl(db, source, source.csl or minimal_csl(source.title))
    if not isinstance(folder_id, _Unset):
        await require_folder_in_project(db, project_id=source.project_id, folder_id=folder_id)
        source.folder_id = folder_id
    if not isinstance(last_page_read, _Unset):
        if last_page_read < 1:
            raise ValidationFailed("The last page read must be 1 or greater.")
        source.last_page_read = last_page_read
    if not isinstance(tags, _Unset):
        await _replace_tags(db, source, clean_tags(tags))
        source.updated_at = func.now()
    await db.commit()
    await db.refresh(source)
    return await _view(db, source)


async def move_sources(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    source_ids: Sequence[uuid.UUID],
    folder_id: uuid.UUID | None,
) -> int:
    """Move sources of one project into a folder of that project, all or nothing (FR-S4)."""
    ids = list(dict.fromkeys(source_ids))
    if not ids:
        raise ValidationFailed("No sources to move.")
    rows = (
        await db.execute(
            select(Source.id, Source.project_id).where(Source.id.in_(ids)).with_for_update()
        )
    ).all()
    projects = {project_id for _, project_id in rows}
    if len(rows) != len(ids) or len(projects) != 1:
        raise MoveInvalid
    (project_id,) = projects
    try:
        await require_project_role(
            db, user_id=user_id, project_id=project_id, minimum=ProjectRole.editor
        )
        await require_folder_in_project(db, project_id=project_id, folder_id=folder_id)
    except NotFound:  # unknown project (non-member) or folder elsewhere: same answer
        raise MoveInvalid from None
    await db.execute(
        update(Source)
        .where(Source.id.in_(ids))
        .values(folder_id=folder_id)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return len(ids)


async def delete_source(
    db: AsyncSession, storage: FileStorage, *, user_id: uuid.UUID, source_id: uuid.UUID
) -> None:
    """Delete a source; its stored file goes too once no other source references it, and so
    do tags no other source uses."""
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.editor)
    async with storage.lock:
        file_id, project_id = source.file_id, source.project_id
        await db.delete(source)
        await db.flush()
        await delete_orphan_tags(db, project_id)
        removed = await delete_unreferenced_files(db, [file_id]) if file_id else []
        await db.commit()
        for sha256 in removed:
            await storage.remove(sha256)


async def open_source_file(
    db: AsyncSession, storage: FileStorage, *, user_id: uuid.UUID, source_id: uuid.UUID
) -> tuple[File, Path]:
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.viewer)
    file = await db.get(File, source.file_id) if source.file_id else None
    if file is None:
        raise NoFile
    return file, storage.blob_path(file.sha256)


async def list_source_summaries(db: AsyncSession, project_id: uuid.UUID) -> list[SourceSummary]:
    """Every source of a project (caller has checked access), by title."""
    rows = (
        await db.execute(
            select(Source, File.page_count)
            .outerjoin(File, File.id == Source.file_id)
            .where(Source.project_id == project_id)
            .order_by(func.lower(Source.title), Source.created_at, Source.id)
        )
    ).all()
    return [SourceSummary(source=s, page_count=p) for s, p in rows]
