"""Automatic citation keys (FR-S7): ``garcia2021``, ``garcia2021a``, ``garcia2021b`` …

The base is the first author's family name (ASCII-folded, lowercase, letters and digits only)
followed by the year, or ``nd`` without a year. A corporate (literal) first author contributes
its first significant word. Without an author the first significant word of the title is used.
"""

import re
from collections.abc import Collection, Iterator
from typing import Any

from research_repo.citations.csl import ascii_fold, issued_year

MAX_KEY_LENGTH = 64
_BASE_LENGTH = 56  # leaves room for a suffix
KEY_RE = re.compile(r"^[a-z0-9_-]{1,64}$")
_NON_KEY = re.compile(r"[^a-z0-9]+")

# Articles and short function words skipped when a key comes from a title or corporate name.
STOPWORDS = frozenset(
    [
        "a",
        "an",
        "the",
        "of",
        "on",
        "in",
        "and",
        "for",
        "to",
        "at",
        "by",
        "with",
        "from",
        "el",
        "la",
        "los",
        "las",
        "lo",
        "un",
        "una",
        "unos",
        "unas",
        "de",
        "del",
        "al",
        "y",
        "e",
        "en",
        "con",
        "por",
        "para",
    ]
)


def _fold(value: str) -> str:
    return _NON_KEY.sub("", ascii_fold(value).lower())


def _first_significant_word(text: str) -> str:
    words = [_fold(w) for w in re.split(r"[\s\-\u2013\u2014/:;,.]+", text)]
    words = [w for w in words if w]
    for word in words:
        if word not in STOPWORDS:
            return word
    return words[0] if words else ""


def _author_part(item: dict[str, Any]) -> str:
    authors = item.get("author")
    if not isinstance(authors, list) or not authors or not isinstance(authors[0], dict):
        return ""
    first = authors[0]
    family = str(first.get("family", "")).strip()
    if family:
        particle = str(first.get("non-dropping-particle", ""))
        return _fold(particle + family)
    return _first_significant_word(str(first.get("literal", "")))


def key_base(item: dict[str, Any]) -> str:
    name = _author_part(item) or _first_significant_word(str(item.get("title", ""))) or "source"
    year = issued_year(item)
    year_part = str(year) if year is not None and year >= 0 else "nd"
    return name[: _BASE_LENGTH - len(year_part)] + year_part


def _suffix(n: int) -> str:
    """0 → "", 1 → "a" … 26 → "z", 27 → "aa" (bijective base 26)."""
    letters = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        letters = chr(ord("a") + rem) + letters
    return letters


def candidates(base: str) -> Iterator[str]:
    n = 0
    while True:
        yield base + _suffix(n)
        n += 1


def first_free_key(base: str, taken: Collection[str]) -> str:
    return next(key for key in candidates(base) if key not in taken)


def is_valid_key(key: str) -> bool:
    return bool(KEY_RE.match(key))
