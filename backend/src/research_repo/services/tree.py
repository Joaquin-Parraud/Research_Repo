"""A project's whole folder tree and source list, as flat lists (the client nests them)."""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.models import Folder, ProjectRole
from research_repo.services.access import require_project_role
from research_repo.services.folders import list_folders
from research_repo.services.sources import SourceSummary, list_source_summaries


@dataclass(frozen=True)
class Tree:
    folders: list[Folder]
    sources: list[SourceSummary]


async def get_tree(db: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID) -> Tree:
    await require_project_role(
        db, user_id=user_id, project_id=project_id, minimum=ProjectRole.viewer
    )
    return Tree(
        folders=await list_folders(db, project_id),
        sources=await list_source_summaries(db, project_id),
    )
