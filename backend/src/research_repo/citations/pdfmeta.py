"""What a PDF says about itself: a DOI, and its embedded title/author/date (FR-S2).

:func:`inspect_pdf` is blocking; call it in a worker thread. It reads the document information
dictionary, the XMP packet and the text of the first pages only, through pypdf's lazy reader on
an open file (never the whole file into memory), and skips files without an end-of-file marker,
for which pypdf's recovery would read everything.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from research_repo.citations.csl import clean_title, normalize_doi

logger = logging.getLogger(__name__)

TEXT_PAGES = 2
_MAX_TEXT = 200_000
_MAX_XMP_BYTES = 1024 * 1024
_EOF_SEARCH_BYTES = 1024

# Crossref's recommended patterns (https://www.crossref.org/blog/dois-and-matching-regular-expressions/),
# found anywhere in running text: the modern one, and Wiley's early SICI DOIs, which contain
# "<" and ">" (10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0).
DOI_RE = re.compile(
    r"\b(10\.1002/\(SICI\)[-._;()/:<>a-z0-9]+|10\.\d{4,9}/[-._;()/:a-z0-9]+)", re.IGNORECASE
)
# A DOI broken over two lines, as text extraction gives it for a narrow column: the first line
# ends inside the DOI (after "/", ".", "-" or "_") and the next one goes on in lowercase or digits.
# A capital letter after a full stop starts a new sentence instead.
_BROKEN_DOI = re.compile(
    r"(\b10\.\d{4,9}/(?:[-._;()/:a-z0-9]*[-./_])?)[ \t]*\r?\n[ \t]*(?=(?-i:[a-z0-9]))",
    re.IGNORECASE,
)
_TRAILING = ".,;:"

_JUNK_TITLE = re.compile(
    r"""^(?:
        microsoft\s+(?:word|powerpoint|excel)\b.*
        | untitled.* | sin\s+t[ií]tulo.* | title | t[ií]tulo | document\d* | doc\d* | unknown
        | none | null | n/?a | draft | slide\s*\d* | presentation\d* | manuscript | paper
        | .*\.(?:docx?|pdf|tex|dvi|ps|rtf|odt|indd|qxd|pages|pptx?|xlsx?)
        | [a-z]:\\.* | /.*
        | \d+
    )$""",
    re.IGNORECASE | re.VERBOSE,
)
_JUNK_AUTHOR = re.compile(
    r"^(?:admin(?:istrator)?|user|owner|author|autor|unknown|default|guest|test|pc"
    r"|microsoft office user|usuario|windows user|.*@.*|.*\d.*)$",
    re.IGNORECASE,
)


@dataclass
class PdfFacts:
    doi: str | None = None
    title: str | None = None
    authors: list[dict[str, str]] = field(default_factory=list)
    year: int | None = None


def find_doi(text: str) -> str | None:
    """The first DOI in a text, with trailing punctuation and unbalanced brackets removed."""
    for match in DOI_RE.finditer(_BROKEN_DOI.sub(r"\1", text)):
        doi = match.group(1).split("</", 1)[0]  # a SICI DOI ends where XML markup starts
        while doi and (
            doi[-1] in _TRAILING
            or (doi[-1] == ")" and doi.count("(") < doi.count(")"))
            or (doi[-1] == "]" and doi.count("[") < doi.count("]"))
        ):
            doi = doi[:-1]
        normalized = normalize_doi(doi)
        if normalized:
            return normalized
    return None


def plausible_title(value: str | None) -> str | None:
    if not value:
        return None
    try:
        title = clean_title(value)
    except ValueError:
        return None
    if _JUNK_TITLE.match(title):
        return None
    letters = sum(c.isalpha() for c in title)
    if len(title.split()) < 2 or letters < 6 or letters < len(title) / 2:
        return None
    return title


def _person(text: str, *, family_first: bool) -> dict[str, str] | None:
    text = " ".join(text.split()).strip(" ,.")
    if not text or _JUNK_AUTHOR.match(text) or len(text) > 100:
        return None
    if family_first and "," in text:
        family, _, given = text.partition(",")
        family, given = family.strip(), given.strip()
    else:
        words = text.split()
        if len(words) == 1:
            return {"family": words[0]}
        family, given = words[-1], " ".join(words[:-1])
    if not family:
        return None
    return {"family": family, "given": given} if given else {"family": family}


def parse_authors(value: str | None) -> list[dict[str, str]]:
    """Names from an info-dictionary author string such as ``García, M.; Smith, J.``,
    ``María García and John Smith`` or ``María García, John Smith``."""
    if not value or not value.strip():
        return []
    text = value.strip()
    if ";" in text:
        parts, family_first = text.split(";"), True
    elif re.search(r"\s(?:and|&|y)\s", text):
        parts, family_first = re.split(r"\s*(?:,\s*)?\b(?:and|y)\b\s*|\s*&\s*", text), False
    elif "," in text and all(len(p.split()) >= 2 for p in text.split(",")):
        parts, family_first = text.split(","), False
    else:
        parts, family_first = [text], True
    names = [_person(p, family_first=family_first) for p in parts]
    return [n for n in names if n][:50]


def _year(value: Any) -> int | None:
    if isinstance(value, datetime):
        year = value.year
    else:
        match = re.match(r"^(?:D:)?(\d{4})", str(value or ""))
        if not match:
            return None
        year = int(match.group(1))
    return year if 1900 <= year <= datetime.now(UTC).year + 1 else None


def _info_strings(info: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    if not info:
        return result
    for key in list(info.keys())[:100]:
        try:
            value = info[key]
        except Exception:  # noqa: S112 - damaged entries are skipped
            continue
        if isinstance(value, str):
            result[str(key)] = value
    return result


def _xmp_text(reader: Any) -> str:
    try:
        metadata = reader.trailer["/Root"].get("/Metadata")
        if metadata is None:
            return ""
        stream = metadata.get_object()
        if int(stream.get("/Length", 0) or 0) > _MAX_XMP_BYTES:
            return ""
        return bytes(stream.get_data()[:_MAX_XMP_BYTES]).decode("utf-8", "replace")
    except Exception:
        return ""


def inspect_pdf(path: Path, *, text_pages: int = TEXT_PAGES) -> PdfFacts:
    """DOI (info dictionary, then XMP, then page text) and embedded metadata. Never raises."""
    from pypdf import PdfReader

    facts = PdfFacts()
    try:
        with path.open("rb") as fh:
            fh.seek(max(0, path.stat().st_size - _EOF_SEARCH_BYTES))
            if b"%%EOF" not in fh.read():
                return facts
            fh.seek(0)
            reader = PdfReader(fh, strict=False)
            if reader.is_encrypted and not reader.decrypt(""):
                return facts
            info = _info_strings(reader.metadata)
            facts.title = plausible_title(info.get("/Title"))
            facts.authors = parse_authors(info.get("/Author"))
            facts.year = _year(info.get("/CreationDate"))

            preferred = [info[k] for k in info if k.lower() in ("/doi", "/prism:doi")]
            others = [v for k, v in info.items() if k.lower() not in ("/doi", "/prism:doi")]
            for text in (*preferred, *others, _xmp_text(reader)):
                facts.doi = find_doi(text)
                if facts.doi:
                    return facts
            text = ""
            for index in range(min(text_pages, len(reader.pages))):
                text += (reader.pages[index].extract_text() or "") + "\n"
                if len(text) > _MAX_TEXT:
                    break
            facts.doi = find_doi(text[:_MAX_TEXT])
    except Exception:  # pypdf raises many types for damaged files
        logger.info("Could not read metadata from %s", path.name)
    return facts


def embedded_csl(facts: PdfFacts) -> dict[str, Any] | None:
    """A CSL item from embedded metadata, if the title looks like a real title."""
    if not facts.title:
        return None
    item: dict[str, Any] = {"type": "document", "title": facts.title}
    if facts.authors:
        item["author"] = facts.authors
    if facts.year:
        item["issued"] = {"date-parts": [[facts.year]]}
    if facts.doi:
        item["DOI"] = facts.doi
    return item
