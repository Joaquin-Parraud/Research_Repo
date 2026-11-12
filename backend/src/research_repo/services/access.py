"""Project permission checks. Every project-scoped service call goes through here (SDD §7.1)."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.errors import Forbidden, NotFound
from research_repo.models import Membership, ProjectRole

_RANK = {ProjectRole.viewer: 1, ProjectRole.editor: 2, ProjectRole.owner: 3}


class ProjectNotFound(NotFound):
    code = "project.not_found"
    message = "Project not found."


async def require_project_role(
    db: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID, minimum: ProjectRole
) -> ProjectRole:
    """Return the user's role, or raise.

    Non-members get "not found" rather than "forbidden", so project ids do not leak.
    """
    role = await db.scalar(
        select(Membership.role).where(
            Membership.user_id == user_id, Membership.project_id == project_id
        )
    )
    if role is None:
        raise ProjectNotFound
    if _RANK[role] < _RANK[minimum]:
        raise Forbidden
    return role
