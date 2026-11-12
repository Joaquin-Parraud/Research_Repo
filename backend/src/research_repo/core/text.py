"""Small text helpers: slugs and name normalisation."""

import re
import unicodedata

_NON_SLUG = re.compile(r"[^a-z0-9]+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def slugify(value: str, *, max_length: int, fallback: str) -> str:
    """ASCII, lowercase, hyphen-separated; ``fallback`` when nothing usable remains."""
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = _NON_SLUG.sub("-", ascii_text.lower()).strip("-")
    slug = slug[:max_length].rstrip("-")
    return slug or fallback


def with_suffix(base: str, n: int, *, max_length: int) -> str:
    """``base`` for n == 1, else ``base-n``, trimming ``base`` so the result fits."""
    if n == 1:
        return base[:max_length]
    suffix = f"-{n}"
    return base[: max_length - len(suffix)].rstrip("-") + suffix


def strip_control(value: str) -> str:
    return _CONTROL.sub("", value)


def name_key(value: str) -> str:
    """Comparison key for names that must be unique case-insensitively."""
    return value.strip().casefold()
