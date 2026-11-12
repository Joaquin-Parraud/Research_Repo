"""Copy a project (owner decision): keep working on an archived project in a fresh copy.

The copy is a new, non-archived project owned by the caller with the same description, README,
citation locale, folder tree, tags and sources (metadata, CSL, statuses, citation keys and
tags; ``last_page_read`` reset to 1). Sources point at the same stored files, so no blob is
copied; files are reference-counted (``services/files.py``), so deleting either project keeps
the blobs the other still uses. Other members are not copied. One transaction, under the
storage lock so a concurrent delete cannot remove a file the copy is about to reference.
"""

import uuid
from collections import defaultdict

from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.storage import FileStorage
from research_repo.models import Folder, Project, ProjectRole, Source, SourceTag, Tag
from research_repo.services.access import require_project_role
from research_repo.services.projects import ProjectView, _view, insert_project, lock_project


async def copy_project(
    db: AsyncSession,
    storage: FileStorage,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    name: str,
) -> ProjectView:
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.editor, allow_archived=True
    )
    async with storage.lock:
        await lock_project(db, project_id)
        original = await db.get_one(Project, project_id)
        copy = await insert_project(
            db, user_id=user_id, name=name, description=original.description
        )
        copy.readme_md = original.readme_md
        copy.citation_locale = original.citation_locale

        # Folders, parents before children (the self-reference is checked row by row).
        folders = list(await db.scalars(select(Folder).where(Folder.project_id == project_id)))
        children: dict[uuid.UUID | None, list[Folder]] = defaultdict(list)
        for folder in folders:
            children[folder.parent_id].append(folder)
        folder_ids = {f.id: uuid.uuid4() for f in folders}
        ordered: list[Folder] = []
        level = children[None]
        while level:
            ordered.extend(level)
            level = [c for f in level for c in children[f.id]]
        if ordered:
            await db.execute(
                insert(Folder),
                [
                    {
                        "id": folder_ids[f.id],
                        "project_id": copy.id,
                        "parent_id": folder_ids[f.parent_id] if f.parent_id else None,
                        "name": f.name,
                        "position": f.position,
                    }
                    for f in ordered
                ],
            )

        tags = list(await db.scalars(select(Tag).where(Tag.project_id == project_id)))
        tag_ids = {t.id: uuid.uuid4() for t in tags}
        if tags:
            await db.execute(
                insert(Tag),
                [{"id": tag_ids[t.id], "project_id": copy.id, "name": t.name} for t in tags],
            )

        sources = list(await db.scalars(select(Source).where(Source.project_id == project_id)))
        source_ids = {s.id: uuid.uuid4() for s in sources}
        if sources:
            await db.execute(
                insert(Source),
                [
                    {
                        "id": source_ids[s.id],
                        "project_id": copy.id,
                        "folder_id": folder_ids[s.folder_id] if s.folder_id else None,
                        "citation_key": s.citation_key,
                        "citation_key_auto": s.citation_key_auto,
                        "csl": s.csl,
                        "title": s.title,
                        "year": s.year,
                        "authors_text": s.authors_text,
                        "doi": s.doi,
                        "file_id": s.file_id,
                        "metadata_status": s.metadata_status,
                        "text_status": s.text_status,
                        "last_page_read": 1,
                    }
                    for s in sources
                ],
            )
            links = (
                await db.execute(
                    select(SourceTag.source_id, SourceTag.tag_id).where(
                        SourceTag.source_id.in_(list(source_ids))
                    )
                )
            ).all()
            if links:
                await db.execute(
                    insert(SourceTag),
                    [{"source_id": source_ids[s], "tag_id": tag_ids[t]} for s, t in links],
                )
            # Extracted page text (M3) belongs to the source; copy it with the source.
            await db.execute(
                text(
                    "INSERT INTO source_page (source_id, page_number, text, tsv) "
                    "SELECT m.new_id, p.page_number, p.text, p.tsv FROM source_page p "
                    "JOIN unnest(CAST(:old AS uuid[]), CAST(:new AS uuid[])) AS m(old_id, new_id) "
                    "ON p.source_id = m.old_id"
                ),
                {"old": list(source_ids), "new": list(source_ids.values())},
            )
        await db.commit()
    return await _view(db, copy.id, user_id)
