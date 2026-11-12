"""Membership-based permission checks and schema constraints M1 relies on."""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import Forbidden
from research_repo.models import Folder, Membership, Project, ProjectRole, Source, User
from research_repo.services.access import ProjectNotFound, require_project_role


async def _project(db: AsyncSession, slug: str = "thesis") -> Project:
    project = Project(name="Thesis", slug=slug)
    db.add(project)
    await db.flush()
    return project


async def test_member_role_checks(db: AsyncSession, owner: User) -> None:
    project = await _project(db)
    db.add(Membership(user_id=owner.id, project_id=project.id, role=ProjectRole.editor))
    await db.commit()

    role = await require_project_role(
        db, user_id=owner.id, project_id=project.id, minimum=ProjectRole.viewer
    )
    assert role is ProjectRole.editor
    with pytest.raises(Forbidden):
        await require_project_role(
            db, user_id=owner.id, project_id=project.id, minimum=ProjectRole.owner
        )


async def test_non_member_sees_not_found(db: AsyncSession, owner: User) -> None:
    project = await _project(db)
    await db.commit()
    with pytest.raises(ProjectNotFound):
        await require_project_role(
            db, user_id=owner.id, project_id=project.id, minimum=ProjectRole.viewer
        )
    with pytest.raises(ProjectNotFound):
        await require_project_role(
            db, user_id=owner.id, project_id=uuid.uuid4(), minimum=ProjectRole.viewer
        )


async def test_project_defaults(db: AsyncSession) -> None:
    project = await _project(db)
    await db.commit()
    await db.refresh(project)
    assert project.citation_locale == "en-US"
    assert project.readme_md == ""


async def test_root_folder_names_are_unique(db: AsyncSession) -> None:
    project = await _project(db)
    db.add(Folder(project_id=project.id, name="Theory"))
    await db.commit()
    db.add(Folder(project_id=project.id, name="Theory"))
    with pytest.raises(IntegrityError):
        await db.commit()


async def test_citation_keys_are_unique_per_project(db: AsyncSession) -> None:
    first, second = await _project(db, "a"), await _project(db, "b")
    db.add_all(
        [
            Source(project_id=first.id, citation_key="garcia2021"),
            Source(project_id=second.id, citation_key="garcia2021"),
        ]
    )
    await db.commit()
    db.add(Source(project_id=first.id, citation_key="garcia2021"))
    with pytest.raises(IntegrityError):
        await db.commit()
