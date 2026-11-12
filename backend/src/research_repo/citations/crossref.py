"""Crossref REST API: fetch a work by DOI and map it to CSL-JSON (FR-S2).

Etiquette (https://api.crossref.org/swagger-ui/index.html, "Etiquette"): requests carry a
descriptive User-Agent with a ``mailto:`` contact when ``CROSSREF_MAILTO`` is set, which puts
them in Crossref's "polite" pool; one request per upload, never retried in a loop.
"""

import html
import re
from typing import Any
from urllib.parse import quote

import httpx

from research_repo import __version__
from research_repo.citations.csl import InvalidCsl, normalize_doi, validate_csl

CROSSREF_API = "https://api.crossref.org"

TYPE_MAP = {
    "journal-article": "article-journal",
    "book-chapter": "chapter",
    "book-section": "chapter",
    "book-part": "chapter",
    "book-track": "chapter",
    "proceedings-article": "paper-conference",
    "posted-content": "article",
    "book": "book",
    "edited-book": "book",
    "monograph": "book",
    "reference-book": "book",
    "book-set": "book",
    "book-series": "book",
    "proceedings": "book",
    "reference-entry": "entry",
    "report": "report",
    "report-component": "report",
    "report-series": "report",
    "dissertation": "thesis",
    "dataset": "dataset",
    "standard": "standard",
    "peer-review": "review",
    "journal": "periodical",
    "journal-issue": "periodical",
    "journal-volume": "periodical",
    "component": "document",
    "database": "dataset",
    "grant": "document",
    "other": "document",
}

_TAG_MAP = {"italic": "i", "i": "i", "bold": "b", "b": "b", "sup": "sup", "sub": "sub"}
_TAG_RE = re.compile(r"<(/?)([A-Za-z][\w:.-]*)[^>]*>")


class CrossrefNotFound(Exception):
    pass


class CrossrefError(Exception):
    pass


def user_agent(mailto: str | None) -> str:
    agent = f"ResearchRepo/{__version__} (self-hosted research source manager"
    if mailto:
        agent += f"; mailto:{mailto}"
    return agent + ")"


def clean_markup(value: str) -> str:
    """Drop JATS/HTML tags, keeping italics, bold, super- and subscript as CSL rich text."""

    def tag(match: re.Match[str]) -> str:
        name = match.group(2).lower().split(":")[-1]
        mapped = _TAG_MAP.get(name)
        return f"<{match.group(1)}{mapped}>" if mapped else " "

    text = _TAG_RE.sub(tag, value)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    # Tags left empty or with spaces just inside them read badly once rendered.
    text = re.sub(r"<(i|b|sup|sub)>\s*</\1>", "", text)
    return re.sub(r"\s+([.,:;?!])", r"\1", text).strip()


def _first(value: Any) -> str | None:
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, str) and value.strip():
        return clean_markup(value)
    return None


def _names(value: Any) -> list[dict[str, str]]:
    names: list[dict[str, str]] = []
    if not isinstance(value, list):
        return names
    for person in value:
        if not isinstance(person, dict):
            continue
        family = str(person.get("family") or "").strip()
        given = str(person.get("given") or "").strip()
        if family:
            name = {"family": family}
            if given:
                name["given"] = given
            suffix = str(person.get("suffix") or "").strip()
            if suffix:
                name["suffix"] = suffix
            names.append(name)
        elif str(person.get("name") or "").strip():
            names.append({"literal": str(person["name"]).strip()})
    return names


def _date(message: dict[str, Any]) -> dict[str, Any] | None:
    for field in ("issued", "published-print", "published-online", "published"):
        value = message.get(field)
        if not isinstance(value, dict):
            continue
        parts = value.get("date-parts")
        if not parts or not isinstance(parts[0], list):
            continue
        date = [p for p in parts[0][:3] if isinstance(p, int)]
        if date and len(date) == len([p for p in parts[0][:3] if p is not None]):
            return {"date-parts": [date]}
    return None


def to_csl(message: dict[str, Any]) -> dict[str, Any]:
    """Map a Crossref ``message`` (one work) to a validated CSL-JSON item.

    Raises :class:`InvalidCsl` when the work has no usable title.
    """
    crossref_type = str(message.get("type") or "other")
    item: dict[str, Any] = {"type": TYPE_MAP.get(crossref_type, "document")}

    title = _first(message.get("title"))
    subtitle = _first(message.get("subtitle"))
    if title and subtitle and subtitle.casefold() not in title.casefold():
        title = f"{title.rstrip(':')}: {subtitle}"
    if title:
        item["title"] = title

    for variable in ("author", "editor", "translator", "chair"):
        names = _names(message.get(variable))
        if names:
            item[variable] = names

    container = _first(message.get("container-title"))
    if container:
        item["container-title"] = container
    short = _first(message.get("short-container-title"))
    if short and short != container:
        item["container-title-short"] = short

    issued = _date(message)
    if issued:
        item["issued"] = issued

    for source, target in (
        ("volume", "volume"),
        ("issue", "issue"),
        ("page", "page"),
        ("article-number", "number"),
        ("publisher", "publisher"),
        ("publisher-location", "publisher-place"),
        ("language", "language"),
        ("edition-number", "edition"),
    ):
        value = message.get(source)
        if isinstance(value, int) and not isinstance(value, bool):
            value = str(value)
        if isinstance(value, str) and value.strip():
            item[target] = value.strip()
    if "page" not in item and "number" in item and item["type"] == "article-journal":
        item["page"] = item.pop("number")

    for source, target in (("ISSN", "ISSN"), ("ISBN", "ISBN")):
        value = message.get(source)
        if isinstance(value, list) and value and isinstance(value[0], str):
            item[target] = value[0]

    doi = normalize_doi(str(message.get("DOI") or ""))
    if doi:
        item["DOI"] = doi
    elif isinstance(message.get("URL"), str):
        item["URL"] = message["URL"]

    event = message.get("event")
    if isinstance(event, dict):
        if isinstance(event.get("name"), str) and event["name"].strip():
            item["event-title"] = clean_markup(event["name"])
        if isinstance(event.get("location"), str) and event["location"].strip():
            item["event-place"] = event["location"].strip()

    institution = message.get("institution")
    institution_name = None
    if isinstance(institution, list) and institution and isinstance(institution[0], dict):
        institution_name = str(institution[0].get("name") or "").strip() or None
    if crossref_type == "posted-content":
        if message.get("subtype") in (None, "preprint"):
            item["genre"] = "Preprint"
        repository = institution_name or _first(message.get("group-title"))
        if repository:
            item["publisher"] = repository
    elif crossref_type == "dissertation" and institution_name:
        item["publisher"] = institution_name

    if "title" not in item:
        raise InvalidCsl("the Crossref record has no title")
    return validate_csl(item)


class CrossrefClient:
    def __init__(
        self,
        *,
        mailto: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        base_url: str = CROSSREF_API,
    ) -> None:
        self.mailto = mailto
        self.transport = transport
        self.base_url = base_url.rstrip("/")

    async def work(self, doi: str, *, timeout: float) -> dict[str, Any]:  # noqa: ASYNC109
        """The Crossref ``message`` for a DOI. Raises CrossrefNotFound or CrossrefError."""
        url = f"{self.base_url}/works/{quote(doi, safe='/')}"
        headers = {"User-Agent": user_agent(self.mailto), "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(
                transport=self.transport, timeout=timeout, follow_redirects=False
            ) as client:
                response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise CrossrefError(f"request failed: {exc.__class__.__name__}") from exc
        if response.status_code == 404:
            raise CrossrefNotFound
        if response.status_code != 200:
            raise CrossrefError(f"Crossref answered {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise CrossrefError("Crossref sent invalid JSON") from exc
        message = body.get("message") if isinstance(body, dict) else None
        if not isinstance(message, dict):
            raise CrossrefError("Crossref sent an unexpected body")
        return message
