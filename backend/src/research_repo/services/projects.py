"""Projects: create, list, update, archive, delete, README (FR-P1, FR-G1)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import ScalarSelect, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import ValidationFailed
from research_repo.core.storage import FileStorage
from research_repo.core.text import slugify, strip_control, with_suffix
from research_repo.models import Folder, Membership, Project, ProjectRole, Source
from research_repo.models.enums import CITATION_LOCALES
from research_repo.services.access import require_project_role
from research_repo.services.files import delete_unreferenced_files

MAX_NAME_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 5000
MAX_README_BYTES = 200 * 1024
_SLUG_LENGTH = 60
_SLUG_ATTEMPTS = 20


@dataclass(frozen=True)
class ProjectView:
    project: Project
    role: ProjectRole
    source_count: int


def _clean_name(name: str) -> str:
    name = strip_control(name).strip()
    if not name or len(name) > MAX_NAME_LENGTH:
        raise ValidationFailed(f"Project name must be 1 to {MAX_NAME_LENGTH} characters.")
    return name


def _clean_description(description: str) -> str:
    description = description.strip()
    if len(description) > MAX_DESCRIPTION_LENGTH:
        raise ValidationFailed(
            f"Project description must be at most {MAX_DESCRIPTION_LENGTH} characters."
        )
    return description


def _source_count() -> ScalarSelect[int]:
    return (
        select(func.count(Source.id))
        .where(Source.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )


async def _view(db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectView:
    row = (
        await db.execute(
            select(Project, Membership.role, _source_count())
            .join(Membership, Membership.project_id == Project.id)
            .where(Project.id == project_id, Membership.user_id == user_id)
        )
    ).one()
    return ProjectView(project=row[0], role=row[1], source_count=row[2])


async def list_projects(
    db: AsyncSession, *, user_id: uuid.UUID, include_archived: bool = False
) -> list[ProjectView]:
    query = (
        select(Project, Membership.role, _source_count())
        .join(Membership, Membership.project_id == Project.id)
        .where(Membership.user_id == user_id)
        .order_by(func.lower(Project.name), Project.name, Project.id)
    )
    if not include_archived:
        query = query.where(Project.archived_at.is_(None))
    rows = (await db.execute(query)).all()
    return [ProjectView(project=p, role=r, source_count=c) for p, r, c in rows]


async def get_project(
    db: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID
) -> ProjectView:
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.viewer
    )
    return await _view(db, project_id, user_id)


async def create_project(
    db: AsyncSession, *, user_id: uuid.UUID, name: str, description: str = ""
) -> ProjectView:
    name = _clean_name(name)
    description = _clean_description(description)
    base = slugify(name, max_length=_SLUG_LENGTH, fallback="project")
    taken = set((await db.scalars(select(Project.slug).where(Project.slug.like(f"{base}%")))).all())
    n = 1
    for _ in range(_SLUG_ATTEMPTS):
        while (slug := with_suffix(base, n, max_length=_SLUG_LENGTH)) in taken:
            n += 1
        project = Project(name=name, slug=slug, description=description, readme_md="")
        try:
            async with db.begin_nested():
                db.add(project)
                await db.flush()
        except IntegrityError:  # a concurrent create took the slug
            taken.add(slug)
            continue
        db.add(Membership(user_id=user_id, project_id=project.id, role=ProjectRole.owner))
        await db.commit()
        return await _view(db, project.id, user_id)
    raise RuntimeError("could not allocate a project slug")


async def update_project(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    name: str | None = None,
    description: str | None = None,
    citation_locale: str | None = None,
    archived: bool | None = None,
) -> ProjectView:
    """Owner-only settings. ``None`` leaves a field unchanged. The slug never changes."""
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.owner
    )
    project = await db.get_one(Project, project_id, with_for_update=True)
    if name is not None:
        project.name = _clean_name(name)
    if description is not None:
        project.description = _clean_description(description)
    if citation_locale is not None:
        if citation_locale not in CITATION_LOCALES:
            raise ValidationFailed("Unsupported citation locale.")
        project.citation_locale = citation_locale
    if archived is not None:
        if archived and project.archived_at is None:
            project.archived_at = datetime.now(UTC)
        elif not archived:
            project.archived_at = None
    await db.commit()
    await db.refresh(project)
    return await _view(db, project_id, user_id)


async def delete_project(
    db: AsyncSession, storage: FileStorage, *, user_id: uuid.UUID, project_id: uuid.UUID
) -> None:
    """Delete a project with its folders and sources, and stored files no one else uses."""
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.owner
    )
    async with storage.lock:
        await db.get_one(Project, project_id, with_for_update=True)
        file_ids = set(
            (
                await db.scalars(
                    select(Source.file_id).where(
                        Source.project_id == project_id, Source.file_id.is_not(None)
                    )
                )
            ).all()
        )
        await db.execute(delete(Source).where(Source.project_id == project_id))
        # One statement, so the folder self-references are checked only once all are gone.
        await db.execute(delete(Folder).where(Folder.project_id == project_id))
        await db.execute(delete(Project).where(Project.id == project_id))
        removed = await delete_unreferenced_files(db, file_ids)
        await db.commit()
        for sha256 in removed:
            await storage.remove(sha256)


@dataclass(frozen=True)
class Readme:
    readme_md: str
    updated_at: datetime


async def get_readme(db: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID) -> Readme:
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.viewer
    )
    project = await db.get_one(Project, project_id)
    return Readme(readme_md=project.readme_md, updated_at=project.updated_at)


async def put_readme(
    db: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID, readme_md: str
) -> Readme:
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.editor
    )
    if len(readme_md.encode()) > MAX_README_BYTES:
        raise ValidationFailed(f"The README is larger than {MAX_README_BYTES // 1024} kB.")
    project = await db.get_one(Project, project_id, with_for_update=True)
    project.readme_md = readme_md
    project.updated_at = func.now()
    await db.commit()
    await db.refresh(project)
    return Readme(readme_md=project.readme_md, updated_at=project.updated_at)


async def lock_project(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Serialise tree mutations within one project (row lock until the transaction ends)."""
    await db.execute(
        select(Project.id).where(Project.id == project_id).with_for_update(key_share=True)
    )
