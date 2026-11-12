"""Project permission checks. Every project-scoped service call goes through here (SDD §7.1).

Archived projects are read-only: a check for the editor or owner role also rejects an
archived project with 409 ``project.archived``, unless the caller passes
``allow_archived=True`` for one of the few operations that stay possible (un-archiving,
deleting and copying the project, metadata suggestions that save nothing). Viewer-level checks
(reading, citing, the reading position) never look at the archive state.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import AppError, Forbidden, NotFound
from research_repo.models import Membership, Project, ProjectRole

_RANK = {ProjectRole.viewer: 1, ProjectRole.editor: 2, ProjectRole.owner: 3}


class ProjectNotFound(NotFound):
    code = "project.not_found"
    message = "Project not found."


class ProjectArchived(AppError):
    status_code = 409
    code = "project.archived"
    message = "This project is archived and read-only. Restore it to make changes."


async def require_project_role(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    minimum: ProjectRole,
    allow_archived: bool = False,
) -> ProjectRole:
    """Return the user's role, or raise.

    Non-members get "not found" rather than "forbidden", so project ids do not leak.
    """
    row = (
        await db.execute(
            select(Membership.role, Project.archived_at)
            .join(Project, Project.id == Membership.project_id)
            .where(Membership.user_id == user_id, Membership.project_id == project_id)
        )
    ).one_or_none()
    if row is None:
        raise ProjectNotFound
    role, archived_at = row
    if _RANK[role] < _RANK[minimum]:
        raise Forbidden
    if archived_at is not None and minimum != ProjectRole.viewer and not allow_archived:
        raise ProjectArchived
    return role
