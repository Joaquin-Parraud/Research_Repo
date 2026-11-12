"""Sources: add (PDF upload or citation-only), edit, tag, move, delete, open the file.

FR-S1, FR-S4, FR-S5 (file-hash part), FR-S6, FR-S7 (provisional keys), FR-S8, FR-R2.
"""

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import AppError, NotFound, ValidationFailed
from research_repo.core.storage import FileStorage, StagedFile
from research_repo.core.text import name_key, slugify, strip_control, with_suffix
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

MAX_TITLE_LENGTH = 1000
MAX_TAG_LENGTH = 100
MAX_TAGS = 100
MAX_FILENAME_LENGTH = 255
CITATION_KEY_LENGTH = 40
_KEY_ATTEMPTS = 20


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


class MoveInvalid(AppError):
    status_code = 422
    code = "source.move_invalid"
    message = "The sources and the target folder must all belong to one project."


class NoFile(NotFound):
    code = "source.no_file"
    message = "This source has no file."


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


async def load_source(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    source_id: uuid.UUID,
    minimum: ProjectRole,
    for_update: bool = False,
) -> Source:
    source = await db.get(Source, source_id, with_for_update=for_update)
    if source is None:
        raise SourceNotFound
    try:
        await require_project_role(
            db, user_id=user_id, project_id=source.project_id, minimum=minimum
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


async def _insert_source(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    title: str,
    file_id: uuid.UUID | None,
) -> Source:
    """Insert with a provisional citation key derived from the title (M2 replaces this)."""
    base = slugify(title, max_length=CITATION_KEY_LENGTH, fallback="source")
    taken = set(
        (
            await db.scalars(
                select(Source.citation_key).where(
                    Source.project_id == project_id, Source.citation_key.like(f"{base[:20]}%")
                )
            )
        ).all()
    )
    n = 1
    for _ in range(_KEY_ATTEMPTS):
        while (key := with_suffix(base, n, max_length=CITATION_KEY_LENGTH)) in taken:
            n += 1
        source = Source(
            project_id=project_id,
            folder_id=folder_id,
            title=title,
            citation_key=key,
            file_id=file_id,
            metadata_status=MetadataStatus.pending,
            text_status=TextStatus.none,
        )
        try:
            async with db.begin_nested():
                db.add(source)
                await db.flush()
        except IntegrityError:  # a concurrent insert took the key
            taken.add(key)
            continue
        return source
    raise RuntimeError("could not allocate a citation key")


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
) -> SourceView:
    """Add one source. With ``staged`` (a fully received upload) the PDF is checked, stored
    once per content hash and linked; without it the source is citation-only and needs a
    title. The caller still owns ``staged`` and must ``discard()`` it afterwards.
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

    if staged is None:
        source = await _insert_source(
            db, project_id=project_id, folder_id=folder_id, title=title, file_id=None
        )
        await db.commit()
        await db.refresh(source)
        return await _view(db, source)

    if staged.size == 0 or not looks_like_pdf(staged.head):
        raise InvalidPdf
    await staged.finish()
    page_count = await asyncio.to_thread(pdf_page_count, staged.path)
    sha256 = staged.sha256

    async with storage.lock:
        created = False
        try:
            file = await db.scalar(select(File).where(File.sha256 == sha256))
            if file is not None and not allow_duplicate:
                existing = await db.scalar(
                    select(Source.id)
                    .where(Source.project_id == project_id, Source.file_id == file.id)
                    .order_by(Source.created_at, Source.id)
                    .limit(1)
                )
                if existing is not None:
                    raise DuplicateFile(existing)
            if file is None:
                file = File(
                    sha256=sha256,
                    size_bytes=staged.size,
                    page_count=page_count,
                    original_filename=clean_filename(staged.original_filename),
                )
                db.add(file)
                await db.flush()
                created = True
            source = await _insert_source(
                db, project_id=project_id, folder_id=folder_id, title=title, file_id=file.id
            )
            await storage.place(staged)
            await db.commit()
        except BaseException:
            await db.rollback()
            if created:  # the blob, if placed, belongs to no committed row
                await storage.remove(sha256)
            raise
    await db.refresh(source)
    return await _view(db, source)


async def get_source(db: AsyncSession, *, user_id: uuid.UUID, source_id: uuid.UUID) -> SourceView:
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.viewer)
    return await _view(db, source)


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


async def update_source(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    source_id: uuid.UUID,
    title: str | _Unset = UNSET,
    folder_id: uuid.UUID | _Unset | None = UNSET,
    last_page_read: int | _Unset = UNSET,
    tags: Sequence[str] | _Unset = UNSET,
) -> SourceView:
    """Partial update. ``last_page_read`` is reading state, so viewers may set it alone."""
    edits = [v for v in (title, folder_id, tags) if not isinstance(v, _Unset)]
    minimum = ProjectRole.editor if edits else ProjectRole.viewer
    source = await load_source(
        db, user_id=user_id, source_id=source_id, minimum=minimum, for_update=True
    )
    if not isinstance(title, _Unset):
        source.title = clean_title(title)
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
    """Delete a source; its stored file goes too once no other source references it."""
    source = await load_source(db, user_id=user_id, source_id=source_id, minimum=ProjectRole.editor)
    async with storage.lock:
        file_id = source.file_id
        await db.delete(source)
        await db.flush()
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
