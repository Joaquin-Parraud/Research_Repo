"""CSL-JSON items: validation, normalisation and the fields derived from them (FR-C1).

A source's ``csl`` is the canonical metadata. ``title``, ``authors_text``, ``year`` and ``doi``
on the source row are derived from it with :func:`derive` whenever it changes.

``authors_text`` is a short display form built from family names, the way the list view shows
sources: ``García``, ``García & Smith``, ``García et al.``; a corporate (literal) name is used
as is. It comes from ``author``, or from ``editor`` when there is no author (APA substitutes
editors for missing authors).
"""

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

MAX_CSL_BYTES = 64 * 1024
MAX_TITLE_LENGTH = 1000

# CSL 1.0.2 item types (https://docs.citationstyles.org/en/stable/specification.html#appendix-iii-types).
ITEM_TYPES = frozenset(
    [
        "article",
        "article-journal",
        "article-magazine",
        "article-newspaper",
        "bill",
        "book",
        "broadcast",
        "chapter",
        "classic",
        "collection",
        "dataset",
        "document",
        "entry",
        "entry-dictionary",
        "entry-encyclopedia",
        "event",
        "figure",
        "graphic",
        "hearing",
        "interview",
        "legal_case",
        "legislation",
        "manuscript",
        "map",
        "motion_picture",
        "musical_score",
        "pamphlet",
        "paper-conference",
        "patent",
        "performance",
        "periodical",
        "personal_communication",
        "post",
        "post-weblog",
        "regulation",
        "report",
        "review",
        "review-book",
        "software",
        "song",
        "speech",
        "standard",
        "thesis",
        "treaty",
        "webpage",
    ]
)

NAME_VARIABLES = frozenset(
    [
        "author",
        "chair",
        "collection-editor",
        "compiler",
        "composer",
        "container-author",
        "contributor",
        "curator",
        "director",
        "editor",
        "editorial-director",
        "editor-translator",
        "executive-producer",
        "guest",
        "host",
        "illustrator",
        "interviewer",
        "narrator",
        "organizer",
        "original-author",
        "performer",
        "producer",
        "recipient",
        "reviewed-author",
        "script-writer",
        "series-creator",
        "translator",
    ]
)

DATE_VARIABLES = frozenset(
    ["accessed", "available-date", "event-date", "issued", "original-date", "submitted"]
)

_NAME_STRING_PARTS = (
    "family",
    "given",
    "literal",
    "dropping-particle",
    "non-dropping-particle",
    "suffix",
)
_DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")
_DOI_PREFIX_RE = re.compile(
    r"^(?:doi\s*:\s*|https?://(?:dx\.)?doi\.org/|(?:dx\.)?doi\.org/)", re.IGNORECASE
)
_YEAR_RE = re.compile(r"(?<!\d)(\d{4})(?!\d)")
_RAW_DATE_RE = re.compile(r"^\s*(-?\d{1,4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?\s*$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class InvalidCsl(ValueError):
    """The value is not an acceptable CSL-JSON item. ``str(exc)`` says why (English)."""


@dataclass(frozen=True)
class Derived:
    title: str
    authors_text: str
    year: int | None
    doi: str | None


def clean_title(title: str) -> str:
    """Whitespace collapsed, control characters removed; raises if empty or too long."""
    cleaned = " ".join(_CONTROL.sub("", title).split())
    if not cleaned or len(cleaned) > MAX_TITLE_LENGTH:
        raise InvalidCsl(f"title must be 1 to {MAX_TITLE_LENGTH} characters")
    return cleaned


def normalize_doi(value: str) -> str | None:
    """A bare DOI (``10.x/…``) from ``10.x/…``, ``doi:…`` or a doi.org URL; None if invalid."""
    doi = _DOI_PREFIX_RE.sub("", value.strip()).strip()
    return doi if _DOI_RE.match(doi) and len(doi) <= 300 else None


def _check_names(variable: str, value: object) -> None:
    if not isinstance(value, list):
        raise InvalidCsl(f"{variable} must be a list of names")
    for name in value:
        if not isinstance(name, dict):
            raise InvalidCsl(f"{variable} entries must be objects")
        for part in _NAME_STRING_PARTS:
            if part in name and not isinstance(name[part], str):
                raise InvalidCsl(f"{variable}.{part} must be a string")
        family = str(name.get("family", "")).strip()
        literal = str(name.get("literal", "")).strip()
        if not family and not literal:
            raise InvalidCsl(f"{variable} entries need a non-empty family or literal")


def _check_date(variable: str, value: object) -> None:
    if not isinstance(value, dict):
        raise InvalidCsl(f"{variable} must be a date object")
    parts = value.get("date-parts")
    if parts is not None:
        if not isinstance(parts, list) or not 1 <= len(parts) <= 2:
            raise InvalidCsl(f"{variable}.date-parts must hold one date or a range of two")
        for date in parts:
            if not isinstance(date, list) or not 1 <= len(date) <= 3:
                raise InvalidCsl(f"{variable}.date-parts entries must be [year, month?, day?]")
            for index, part in enumerate(date):
                number = _as_int(part)
                if number is None:
                    raise InvalidCsl(f"{variable}.date-parts must contain numbers")
                low, high = ((-9999, 9999), (1, 24), (1, 31))[index]
                if not low <= number <= high:
                    raise InvalidCsl(f"{variable}.date-parts value {number} is out of range")
    for key in ("raw", "literal"):
        if key in value and (not isinstance(value[key], str) or not value[key].strip()):
            raise InvalidCsl(f"{variable}.{key} must be a non-empty string")
    if parts is None and "raw" not in value and "literal" not in value:
        raise InvalidCsl(f"{variable} needs date-parts, raw or literal")


def _as_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d{1,4}", value.strip()):
        return int(value.strip())
    return None


def validate_csl(value: object) -> dict[str, Any]:
    """Check an item and return a normalised copy.

    Normalisation: ``id`` is dropped (the server sets it to the citation key when rendering),
    ``title`` is whitespace-cleaned, numeric date parts given as strings become integers.
    Unknown keys are kept as they are.
    """
    if not isinstance(value, dict):
        raise InvalidCsl("csl must be an object")
    try:
        size = len(json.dumps(value, ensure_ascii=False).encode())
    except (TypeError, ValueError):
        raise InvalidCsl("csl must be plain JSON") from None
    if size > MAX_CSL_BYTES:
        raise InvalidCsl(f"csl is larger than {MAX_CSL_BYTES // 1024} kB")
    item = json.loads(json.dumps(value))  # deep copy
    item.pop("id", None)
    if item.get("type") not in ITEM_TYPES:
        raise InvalidCsl("type must be a CSL item type")
    title = item.get("title")
    if not isinstance(title, str):
        raise InvalidCsl("title must be a non-empty string")
    item["title"] = clean_title(title)
    for variable in NAME_VARIABLES & item.keys():
        _check_names(variable, item[variable])
    for variable in DATE_VARIABLES & item.keys():
        _check_date(variable, item[variable])
        parts = item[variable].get("date-parts")
        if parts is not None:
            item[variable]["date-parts"] = [[_as_int(p) for p in date] for date in parts]
    if "DOI" in item and not isinstance(item["DOI"], str):
        raise InvalidCsl("DOI must be a string")
    return item


def minimal_csl(title: str) -> dict[str, Any]:
    """The item a source starts with before any metadata is known."""
    return {"type": "document", "title": clean_title(title)}


def _name_display(name: dict[str, Any]) -> str:
    literal = str(name.get("literal", "")).strip()
    if literal:
        return literal
    particle = str(name.get("non-dropping-particle", "")).strip()
    family = str(name.get("family", "")).strip()
    return f"{particle} {family}".strip()


def authors_text(item: dict[str, Any]) -> str:
    names = item.get("author") or item.get("editor") or []
    shown = [n for n in (_name_display(name) for name in names) if n]
    if not shown:
        return ""
    if len(shown) == 1:
        return shown[0]
    if len(shown) == 2:
        return f"{shown[0]} & {shown[1]}"
    return f"{shown[0]} et al."


def issued_year(item: dict[str, Any]) -> int | None:
    issued = item.get("issued")
    if not isinstance(issued, dict):
        return None
    parts = issued.get("date-parts")
    if parts and parts[0]:
        year = _as_int(parts[0][0])
        if year is not None:
            return year
    for key in ("raw", "literal"):
        match = _YEAR_RE.search(str(issued.get(key, "")))
        if match:
            return int(match.group(1))
    return None


def derive(item: dict[str, Any]) -> Derived:
    doi = normalize_doi(item["DOI"]) if isinstance(item.get("DOI"), str) else None
    return Derived(
        title=item["title"],
        authors_text=authors_text(item)[:1000],
        year=issued_year(item),
        doi=doi,
    )


def raw_to_date_parts(raw: str) -> list[list[int]] | None:
    """``2021``, ``2021-05`` or ``2021-05-03`` as CSL date-parts; None for anything else."""
    match = _RAW_DATE_RE.match(raw)
    if not match:
        return None
    return [[int(g) for g in match.groups() if g is not None]]


def ascii_fold(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
