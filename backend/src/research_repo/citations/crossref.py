"""Crossref REST API: fetch a work by DOI and map it to CSL-JSON (FR-S2).

Etiquette (https://api.crossref.org/swagger-ui/index.html, "Etiquette"): requests carry a
descriptive User-Agent with a ``mailto:`` contact when ``CROSSREF_MAILTO`` is set, which puts
them in Crossref's "polite" pool. Crossref limits request rate and concurrency per client and
answers 429 (with ``Retry-After``) or 5xx when it is busy: a lookup is retried a few times with
backoff, never beyond its time budget, and only a few requests run at once (bulk uploads send
several PDFs in parallel).
"""

import asyncio
import html
import logging
import random
import re
import time
from collections.abc import Sequence
from typing import Any
from urllib.parse import quote

import httpx

from research_repo import __version__
from research_repo.citations.csl import InvalidCsl, normalize_doi, validate_csl

logger = logging.getLogger(__name__)

CROSSREF_API = "https://api.crossref.org"
RETRY_STATUSES = frozenset([429, 500, 502, 503, 504])
# Waits before the second and third attempt (plus up to 10 % jitter).
RETRY_DELAYS_SECONDS = (0.5, 1.5)
# An attempt is not started with less time than this left.
MIN_ATTEMPT_SECONDS = 0.2
MAX_CONCURRENT_REQUESTS = 3

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
    "proceedings-series": "book",
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

_ARTICLE_NUMBER_TYPES = frozenset(["article-journal", "paper-conference", "article"])

_TAG_MAP = {"italic": "i", "i": "i", "bold": "b", "b": "b", "sup": "sup", "sub": "sub"}
# Elements that separate words. Every other tag (``scp``, ``span``, ``sc``, MathML, …) is inline
# and is removed without a space: Wiley's "<scp>m</scp>RNA" is one word.
_BLOCK_TAGS = frozenset(
    ["p", "title", "sec", "br", "break", "div", "list", "list-item", "li", "label", "caption"]
)
_TAG_RE = re.compile(r"<(/?)([A-Za-z][\w:.-]*)(?:\s[^<>]*)?/?>")


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
        if mapped:
            return f"<{match.group(1)}{mapped}>"
        return " " if name in _BLOCK_TAGS else ""

    # Entities first: some deposits escape their markup ("&lt;i&gt;"), a few twice ("&amp;amp;").
    text = value
    for _ in range(2):
        unescaped = html.unescape(text)
        if unescaped == text:
            break
        text = unescaped
    text = _TAG_RE.sub(tag, text)
    text = re.sub(r"\s+", " ", text).strip()
    # Tags left empty or with spaces just inside them read badly once rendered.
    text = re.sub(r"<(i|b|sup|sub)>\s*</\1>", "", text)
    # Not before a decimal such as "p < .05".
    return re.sub(r"\s+([.,:;?!])(?![\d])", r"\1", text).strip()


def _first(value: Any) -> str | None:
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, str) and value.strip():
        return clean_markup(value)
    return None


def _names(value: Any) -> list[dict[str, str]]:
    """CSL names. A person with only a given name (a mononym such as "Aristotle", or a deposit
    that put the whole name there) becomes a literal name instead of being dropped."""
    names: list[dict[str, str]] = []
    if not isinstance(value, list):
        return names
    for person in value:
        if not isinstance(person, dict):
            continue
        family = str(person.get("family") or "").strip()
        given = str(person.get("given") or "").strip()
        if not family and given and not str(person.get("name") or "").strip():
            names.append({"literal": given})
        elif family:
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


def _date_part(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{1,4}", value.strip()):
        return int(value)
    return None


def _date(message: dict[str, Any]) -> dict[str, Any] | None:
    """The first usable date; its parts may come as numbers or as numeric strings."""
    for field in ("issued", "published-print", "published-online", "published"):
        value = message.get(field)
        if not isinstance(value, dict):
            continue
        parts = value.get("date-parts")
        if not parts or not isinstance(parts, list) or not isinstance(parts[0], list):
            continue
        given = [p for p in parts[0][:3] if p is not None]
        date = [d for d in (_date_part(p) for p in given) if d is not None]
        if date and len(date) == len(given):
            return {"date-parts": [date]}
    return None


_DOCTORAL = re.compile(r"\b(?:ph\.?\s?d|d\.?\s?phil|ed\.?\s?d|doctor\w*)\b", re.IGNORECASE)
_MASTERS = re.compile(r"\b(?:masters?|master's|m\.?\s?(?:a|sc?|phil|ed|eng|res))\b", re.IGNORECASE)


def _thesis_genre(message: dict[str, Any]) -> str | None:
    """APA's bracketed description of a thesis (10.6), from Crossref's ``degree``."""
    degree = _first(message.get("degree")) or ""
    if _DOCTORAL.search(degree):
        return "Doctoral dissertation"
    if _MASTERS.search(degree):
        return "Master's thesis"
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
    # An article number stays ``number``: the APA style prints it as "Article 105956" in place of
    # a page range (APA 9.26); moved into ``page`` it read as a bare page number. Other types
    # print ``number`` as a report or series number ("No. 7"), which an article number is not.
    if item["type"] not in _ARTICLE_NUMBER_TYPES:
        item.pop("number", None)

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
    elif crossref_type == "dissertation":
        if institution_name:
            item["publisher"] = institution_name
        genre = _thesis_genre(message)
        if genre:
            item["genre"] = genre

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
        retry_delays: Sequence[float] = RETRY_DELAYS_SECONDS,
        max_concurrency: int = MAX_CONCURRENT_REQUESTS,
    ) -> None:
        self.mailto = mailto
        self.transport = transport
        self.base_url = base_url.rstrip("/")
        self.retry_delays = tuple(retry_delays)
        self._slots = asyncio.Semaphore(max_concurrency)

    async def work(self, doi: str, *, timeout: float) -> dict[str, Any]:  # noqa: ASYNC109
        """The Crossref ``message`` for a DOI. Raises CrossrefNotFound or CrossrefError.

        ``timeout`` bounds the whole call, retries and waits included. Transient failures
        (network errors, 429, 5xx) are retried after ``retry_delays`` (or the server's
        ``Retry-After``), as long as the next attempt can still start within the budget.
        """
        deadline = time.monotonic() + timeout
        url = f"{self.base_url}/works/{quote(doi, safe='/')}"
        headers = {"User-Agent": user_agent(self.mailto), "Accept": "application/json"}
        async with (
            self._slots,
            httpx.AsyncClient(transport=self.transport, follow_redirects=False) as client,
        ):
            for attempt in range(len(self.retry_delays) + 1):
                remaining = deadline - time.monotonic()
                if remaining <= 0:  # the budget went on waiting for a free slot
                    raise CrossrefError("no time left for the request")
                try:
                    response = await client.get(url, headers=headers, timeout=remaining)
                except httpx.TransportError as exc:
                    failure = CrossrefError(f"request failed: {exc.__class__.__name__}")
                    failure.__cause__ = exc
                    retry_after = None
                except httpx.HTTPError as exc:
                    raise CrossrefError(f"request failed: {exc.__class__.__name__}") from exc
                else:
                    if response.status_code not in RETRY_STATUSES:
                        return _message(response)
                    failure = CrossrefError(f"Crossref answered {response.status_code}")
                    retry_after = _retry_after(response)
                if attempt == len(self.retry_delays):
                    raise failure
                delay = self.retry_delays[attempt] if retry_after is None else retry_after
                delay *= 1 + random.uniform(0, 0.1)  # noqa: S311 - jitter, not security
                if time.monotonic() + delay + MIN_ATTEMPT_SECONDS > deadline:
                    raise failure
                logger.info("Crossref lookup for %s: %s; retrying in %.2f s", doi, failure, delay)
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")  # pragma: no cover


def _retry_after(response: httpx.Response) -> float | None:
    """Seconds from a ``Retry-After`` header given in seconds (the HTTP-date form is ignored)."""
    value = response.headers.get("retry-after", "").strip()
    try:
        return max(0.0, float(value)) if value else None
    except ValueError:
        return None


def _message(response: httpx.Response) -> dict[str, Any]:
    """The work in a final (not retried) answer."""
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
