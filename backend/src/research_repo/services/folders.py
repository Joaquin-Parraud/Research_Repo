"""Folder tree: create, rename, move, reorder and delete (FR-F1 to FR-F3, SDD §7.1).

Every mutation first locks the project row, so concurrent tree changes in one project are
serialised (this is what keeps cycle checks and dense sibling positions correct).
"""

import uuid
from typing import Final

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import AppError, NotFound, ValidationFailed
from research_repo.core.text import name_key, strip_control
from research_repo.models import Folder, ProjectRole, Source
from research_repo.services.access import ProjectNotFound, require_project_role
from research_repo.services.projects import lock_project

MAX_FOLDER_NAME_LENGTH = 255


class _Unset:
    def __repr__(self) -> str:
        return "UNSET"


UNSET: Final = _Unset()


class FolderNotFound(NotFound):
    code = "folder.not_found"
    message = "Folder not found."


class FolderNameConflict(AppError):
    status_code = 409
    code = "folder.name_conflict"
    message = "A folder with this name already exists here."


class FolderCycle(AppError):
    status_code = 409
    code = "folder.cycle"
    message = "A folder cannot be moved into itself or one of its subfolders."


def clean_folder_name(name: str) -> str:
    name = strip_control(name).strip()
    if not name or len(name) > MAX_FOLDER_NAME_LENGTH or "/" in name:
        raise ValidationFailed(
            f"Folder names must be 1 to {MAX_FOLDER_NAME_LENGTH} characters, without '/'."
        )
    return name


async def load_folder(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    folder_id: uuid.UUID,
    minimum: ProjectRole,
    for_update: bool = False,
) -> Folder:
    """The folder, after the role check. Folders of other users' projects are "not found"."""
    folder = await db.get(Folder, folder_id)
    if folder is None:
        raise FolderNotFound
    try:
        await require_project_role(
            db, user_id=user_id, project_id=folder.project_id, minimum=minimum
        )
    except ProjectNotFound:
        raise FolderNotFound from None
    if for_update:
        await lock_project(db, folder.project_id)
        await db.refresh(folder, with_for_update=True)
    return folder


async def require_folder_in_project(
    db: AsyncSession, *, project_id: uuid.UUID, folder_id: uuid.UUID | None
) -> None:
    """``None`` (the root) always exists; any other folder must belong to the project."""
    if folder_id is None:
        return
    found = await db.scalar(
        select(Folder.id).where(Folder.id == folder_id, Folder.project_id == project_id)
    )
    if found is None:
        raise FolderNotFound


async def _siblings(
    db: AsyncSession, project_id: uuid.UUID, parent_id: uuid.UUID | None
) -> list[Folder]:
    parent_clause = (
        Folder.parent_id.is_(None) if parent_id is None else Folder.parent_id == parent_id
    )
    return list(
        (
            await db.scalars(
                select(Folder)
                .where(Folder.project_id == project_id, parent_clause)
                .order_by(Folder.position, Folder.name, Folder.id)
            )
        ).all()
    )


def _renumber(folders: list[Folder]) -> None:
    for index, folder in enumerate(folders):
        if folder.position != index:
            folder.position = index


def _ensure_unique(siblings: list[Folder], name: str, *, exclude: uuid.UUID | None) -> None:
    key = name_key(name)
    if any(f.id != exclude and name_key(f.name) == key for f in siblings):
        raise FolderNameConflict


async def _ancestor_ids(db: AsyncSession, folder_id: uuid.UUID) -> set[uuid.UUID]:
    """The folder itself and every folder above it (recursive CTE)."""
    chain = (
        select(Folder.id, Folder.parent_id)
        .where(Folder.id == folder_id)
        .cte("chain", recursive=True)
    )
    chain = chain.union_all(
        select(Folder.id, Folder.parent_id).join(chain, Folder.id == chain.c.parent_id)
    )
    return set((await db.scalars(select(chain.c.id))).all())


async def descendant_ids(db: AsyncSession, folder_id: uuid.UUID) -> set[uuid.UUID]:
    """The folder itself and every folder below it (recursive CTE)."""
    tree = select(Folder.id).where(Folder.id == folder_id).cte("tree", recursive=True)
    tree = tree.union_all(select(Folder.id).join(tree, Folder.parent_id == tree.c.id))
    return set((await db.scalars(select(tree.c.id))).all())


async def list_folders(db: AsyncSession, project_id: uuid.UUID) -> list[Folder]:
    """All folders of a project (caller has checked access), parents' order irrelevant."""
    return list(
        (
            await db.scalars(
                select(Folder)
                .where(Folder.project_id == project_id)
                .order_by(Folder.parent_id.nulls_first(), Folder.position, Folder.name)
            )
        ).all()
    )


async def create_folder(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    name: str,
    parent_id: uuid.UUID | None = None,
) -> Folder:
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.editor
    )
    name = clean_folder_name(name)
    await lock_project(db, project_id)
    await require_folder_in_project(db, project_id=project_id, folder_id=parent_id)
    siblings = await _siblings(db, project_id, parent_id)
    _ensure_unique(siblings, name, exclude=None)
    _renumber(siblings)
    folder = Folder(project_id=project_id, parent_id=parent_id, name=name, position=len(siblings))
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def update_folder(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    folder_id: uuid.UUID,
    name: str | _Unset = UNSET,
    parent_id: uuid.UUID | _Unset | None = UNSET,
    position: int | _Unset = UNSET,
) -> Folder:
    """Rename, re-parent and/or reorder. ``UNSET`` leaves a field alone; ``parent_id=None``
    moves to the root. ``position`` is the 0-based index among the (new) siblings; without
    it a moved folder goes last and a folder that stays keeps its place.
    """
    folder = await load_folder(
        db, user_id=user_id, folder_id=folder_id, minimum=ProjectRole.editor, for_update=True
    )
    project_id = folder.project_id
    old_parent = folder.parent_id
    new_parent = old_parent if isinstance(parent_id, _Unset) else parent_id
    new_name = folder.name if isinstance(name, _Unset) else clean_folder_name(name)
    if not isinstance(position, _Unset) and position < 0:
        raise ValidationFailed("Position must be zero or greater.")
    moved = new_parent != old_parent

    if moved and new_parent is not None:
        await require_folder_in_project(db, project_id=project_id, folder_id=new_parent)
        if folder.id in await _ancestor_ids(db, new_parent):
            raise FolderCycle
    elif new_parent == folder.id:
        raise FolderCycle

    siblings = await _siblings(db, project_id, new_parent)
    _ensure_unique(siblings, new_name, exclude=folder.id)

    others = [f for f in siblings if f.id != folder.id]
    if not isinstance(position, _Unset):
        index = min(position, len(others))
    elif moved:
        index = len(others)
    else:
        index = next(i for i, f in enumerate(siblings) if f.id == folder.id)

    folder.name = new_name
    folder.parent_id = new_parent
    others.insert(index, folder)
    _renumber(others)
    if moved:
        _renumber([f for f in await _siblings(db, project_id, old_parent) if f.id != folder.id])
    await db.commit()
    await db.refresh(folder)
    return folder


def _numbered(name: str, n: int) -> str:
    suffix = f" ({n})"
    return name[: MAX_FOLDER_NAME_LENGTH - len(suffix)].rstrip() + suffix


async def delete_folder(db: AsyncSession, *, user_id: uuid.UUID, folder_id: uuid.UUID) -> None:
    """Delete a folder. Its sources and subfolders move up to its parent (FR-F2), taking its
    place in the sibling order; a subfolder whose name is taken there gets " (2)", " (3)"...
    """
    folder = await load_folder(
        db, user_id=user_id, folder_id=folder_id, minimum=ProjectRole.editor, for_update=True
    )
    project_id, parent_id = folder.project_id, folder.parent_id
    siblings = await _siblings(db, project_id, parent_id)
    children = await _siblings(db, project_id, folder.id)

    sibling_keys = {name_key(f.name) for f in siblings if f.id != folder.id}
    reserved = sibling_keys | {name_key(c.name) for c in children}
    assigned: set[str] = set()
    new_names: dict[uuid.UUID, str] = {}
    for child in children:
        key = name_key(child.name)
        candidate = child.name
        if key in sibling_keys or key in assigned:
            n = 2
            while name_key(candidate := _numbered(child.name, n)) in reserved | assigned:
                n += 1
        assigned.add(name_key(candidate))
        new_names[child.id] = candidate

    # Free the deleted folder's name first: a child may carry the same name.
    folder.name = str(folder.id)
    await db.flush()
    await db.execute(
        update(Source)
        .where(Source.folder_id == folder.id)
        .values(folder_id=parent_id)
        .execution_options(synchronize_session=False)
    )
    for child in children:
        child.parent_id = parent_id
        child.name = new_names[child.id]

    index = next(i for i, f in enumerate(siblings) if f.id == folder.id)
    ordered = siblings[:index] + children + siblings[index + 1 :]
    _renumber(ordered)
    await db.flush()
    await db.delete(folder)
    await db.commit()
