"""Request and response bodies for projects, folders and sources (M1, M2)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, ClassVar, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from research_repo.models import MetadataStatus, ProjectRole, TextStatus
from research_repo.services.projects import ProjectView, Readme
from research_repo.services.sources import SourceSummary, SourceView
from research_repo.services.tree import Tree

CitationLocale = Literal["en-US", "es"]

# Generous transport limits; services apply the precise rules (trimming, characters).
Name = Annotated[str, Field(max_length=1000)]
Text = Annotated[str, Field(max_length=20_000)]


class _Patch(BaseModel):
    """Partial update: omitted fields stay unchanged. Fields not listed in
    ``nullable`` reject an explicit null.
    """

    model_config = ConfigDict(extra="forbid")
    nullable: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def _reject_nulls(self) -> Self:
        for name in self.model_fields_set:
            if name not in self.nullable and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def given(self) -> dict[str, object]:
        return {name: getattr(self, name) for name in self.model_fields_set}


# --- projects ------------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Text = ""


class ProjectUpdate(_Patch):
    name: Name | None = None
    description: Text | None = None
    citation_locale: CitationLocale | None = None
    archived: bool | None = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    citation_locale: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    role: ProjectRole
    source_count: int

    @classmethod
    def of(cls, view: ProjectView) -> Self:
        p = view.project
        return cls(
            id=p.id,
            name=p.name,
            slug=p.slug,
            description=p.description,
            citation_locale=p.citation_locale,
            archived_at=p.archived_at,
            created_at=p.created_at,
            updated_at=p.updated_at,
            role=view.role,
            source_count=view.source_count,
        )


class ProjectCopy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class ReadmeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The service enforces the byte limit; this only stops absurd bodies early.
    readme_md: Annotated[str, Field(max_length=1_000_000)]


class ReadmeOut(BaseModel):
    readme_md: str
    updated_at: datetime

    @classmethod
    def of(cls, readme: Readme) -> Self:
        return cls(readme_md=readme.readme_md, updated_at=readme.updated_at)


# --- folders -------------------------------------------------------------------------------


class FolderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    parent_id: uuid.UUID | None = None


class FolderUpdate(_Patch):
    nullable: ClassVar[frozenset[str]] = frozenset({"parent_id"})

    name: Name | None = None
    parent_id: uuid.UUID | None = None
    position: Annotated[int, Field(ge=0)] | None = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    position: int


# --- sources -------------------------------------------------------------------------------


class SourceFileOut(BaseModel):
    size_bytes: int
    page_count: int | None
    original_filename: str


class SourceSummaryOut(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID | None
    title: str
    authors_text: str
    year: int | None
    citation_key: str
    has_file: bool
    metadata_status: MetadataStatus
    text_status: TextStatus
    page_count: int | None
    created_at: datetime

    @classmethod
    def of(cls, summary: SourceSummary) -> Self:
        s = summary.source
        return cls(
            id=s.id,
            folder_id=s.folder_id,
            title=s.title,
            authors_text=s.authors_text,
            year=s.year,
            citation_key=s.citation_key,
            has_file=s.file_id is not None,
            metadata_status=s.metadata_status,
            text_status=s.text_status,
            page_count=summary.page_count,
            created_at=s.created_at,
        )


class SourceOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    folder_id: uuid.UUID | None
    title: str
    authors_text: str
    year: int | None
    citation_key: str
    citation_key_auto: bool
    csl: dict[str, Any]
    doi: str | None
    metadata_status: MetadataStatus
    text_status: TextStatus
    last_page_read: int | None
    has_file: bool
    file: SourceFileOut | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: SourceView) -> Self:
        s, f = view.source, view.file
        return cls(
            id=s.id,
            project_id=s.project_id,
            folder_id=s.folder_id,
            title=s.title,
            authors_text=s.authors_text,
            year=s.year,
            citation_key=s.citation_key,
            citation_key_auto=s.citation_key_auto,
            csl=s.csl,
            doi=s.doi,
            metadata_status=s.metadata_status,
            text_status=s.text_status,
            last_page_read=s.last_page_read,
            has_file=f is not None,
            file=(
                SourceFileOut(
                    size_bytes=f.size_bytes,
                    page_count=f.page_count,
                    original_filename=f.original_filename,
                )
                if f is not None
                else None
            ),
            tags=view.tags,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )


class SourceUpdate(_Patch):
    # ``csl: null`` is passed on so that the service rejects it as invalid CSL.
    nullable: ClassVar[frozenset[str]] = frozenset({"folder_id", "citation_key", "csl"})

    title: Name | None = None
    folder_id: uuid.UUID | None = None
    last_page_read: Annotated[int, Field(ge=1, le=1_000_000)] | None = None
    tags: Annotated[list[Annotated[str, Field(max_length=1000)]], Field(max_length=1000)] | None = (
        None
    )
    # Any JSON value: the service validates it and answers metadata.invalid_csl.
    csl: Any = None
    metadata_status: Literal["confirmed"] | None = None
    citation_key: Annotated[str, Field(max_length=200)] | None = None


class SourceMove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=5000)]
    folder_id: uuid.UUID | None = None


class MoveResult(BaseModel):
    moved: int


class TreeOut(BaseModel):
    folders: list[FolderOut]
    sources: list[SourceSummaryOut]

    @classmethod
    def of(cls, tree: Tree) -> Self:
        return cls(
            folders=[FolderOut.model_validate(f) for f in tree.folders],
            sources=[SourceSummaryOut.of(s) for s in tree.sources],
        )
