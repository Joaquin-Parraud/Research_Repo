"""ORM models. Importing this package registers every table on ``Base.metadata``."""

from research_repo.models.activity import ActivityLog
from research_repo.models.base import Base
from research_repo.models.enums import MetadataStatus, ProjectRole, TextStatus, TokenMode
from research_repo.models.project import Folder, Membership, Project
from research_repo.models.source import File, Source, SourcePage, SourceTag, Tag
from research_repo.models.user import ApiToken, Session, User

__all__ = [
    "ActivityLog",
    "ApiToken",
    "Base",
    "File",
    "Folder",
    "Membership",
    "MetadataStatus",
    "Project",
    "ProjectRole",
    "Session",
    "Source",
    "SourcePage",
    "SourceTag",
    "Tag",
    "TextStatus",
    "TokenMode",
    "User",
]
