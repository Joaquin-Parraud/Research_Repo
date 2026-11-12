"""Request and response bodies for citations, bibliographies, metadata and config (M2)."""

import uuid
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field

from research_repo.services.citations import Bibliography, CitationView
from research_repo.services.metadata import Suggestion


class CitationOut(BaseModel):
    style: Literal["apa"] = "apa"
    locale: str
    reference_text: str
    reference_html: str
    in_text_parenthetical: str
    in_text_narrative: str

    @classmethod
    def of(cls, view: CitationView) -> Self:
        e = view.entry
        return cls(
            locale=view.locale,
            reference_text=e.reference_text,
            reference_html=e.reference_html,
            in_text_parenthetical=e.in_text_parenthetical,
            in_text_narrative=e.in_text_narrative,
        )


class BibliographyIn(BaseModel):
    """No ``source_ids`` and no ``folder_id`` key: whole project. ``folder_id: null``: the
    project root."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["text", "html", "bibtex", "csl"]
    source_ids: Annotated[list[uuid.UUID], Field(max_length=10_000)] | None = None
    folder_id: uuid.UUID | None = None
    include_subfolders: bool = True


class BibliographyOut(BaseModel):
    format: str
    count: int
    content: str | list[dict[str, Any]]

    @classmethod
    def of(cls, bibliography: Bibliography) -> Self:
        return cls(
            format=bibliography.format, count=bibliography.count, content=bibliography.content
        )


class SuggestionOut(BaseModel):
    csl: dict[str, Any] | None
    origin: Literal["doi", "pdf", "none"]
    doi: str | None

    @classmethod
    def of(cls, suggestion: Suggestion) -> Self:
        return cls(csl=suggestion.csl, origin=suggestion.origin, doi=suggestion.doi)


class DoiLookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doi: Annotated[str, Field(max_length=500)]


class DoiLookupOut(BaseModel):
    csl: dict[str, Any]


class ConfigOut(BaseModel):
    max_upload_mb: int
    metadata_lookup_enabled: bool
