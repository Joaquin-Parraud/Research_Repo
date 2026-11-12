"""CSL-JSON → BibTeX (FR-C4).

Values are UTF-8 (BibTeX 0.99 with biber or modern bibtex8 handle it); LaTeX special characters
are escaped. In titles, words with capitals other than the first letter of the title are
wrapped in braces so that bibliography styles do not lowercase them, and CSL rich-text markup
(``<i>``, ``<b>``, ``<sup>``, ``<sub>``, ``<span class="nocase">``) becomes the LaTeX
equivalent. Corporate (literal) names are protected with an extra pair of braces.
"""

import re
from typing import Any

from research_repo.citations.csl import issued_year

_ESCAPES = {
    "\\": r"\textbackslash{}",
    "{": r"\{",
    "}": r"\}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
_ESCAPE_RE = re.compile("|".join(re.escape(c) for c in _ESCAPES))
_MARKUP_RE = re.compile(r"(</?(?:i|b|sup|sub)>|<span class=\"nocase\">|</span>)")
_MARKUP = {
    "<i>": r"\textit{",
    "<b>": r"\textbf{",
    "<sup>": r"\textsuperscript{",
    "<sub>": r"\textsubscript{",
    '<span class="nocase">': "{",
}
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

_TYPES = {
    "article-journal": "article",
    "article-magazine": "article",
    "article-newspaper": "article",
    "review": "article",
    "review-book": "article",
    "book": "book",
    "classic": "book",
    "collection": "book",
    "periodical": "book",
    "chapter": "incollection",
    "entry": "incollection",
    "entry-dictionary": "incollection",
    "entry-encyclopedia": "incollection",
    "paper-conference": "inproceedings",
    "report": "techreport",
    "manuscript": "unpublished",
    "pamphlet": "booklet",
}
_DOCTORAL = re.compile(r"doct|ph\.?\s?d|tesis doctoral|dissertation", re.IGNORECASE)


def escape(value: str) -> str:
    return _ESCAPE_RE.sub(lambda m: _ESCAPES[m.group(0)], " ".join(value.split()))


def _markup(value: str, *, protect_capitals: bool) -> str:
    """Escape text, convert CSL rich-text tags; optionally brace capitalised words."""
    out: list[str] = []
    depth = 0
    first_letter_seen = False
    for index, piece in enumerate(_MARKUP_RE.split(value)):
        if index % 2:
            if piece.startswith("</"):
                if depth:
                    out.append("}")
                    depth -= 1
            else:
                out.append(_MARKUP[piece])
                depth += 1
            continue
        if not protect_capitals:
            out.append(escape(piece))
            continue
        for word in re.split(r"(\s+)", piece):
            if not word or word.isspace():
                out.append(word)
                continue
            letters = [c for c in word if c.isalpha()]
            rest = letters[1:] if not first_letter_seen else letters
            if letters:
                first_letter_seen = True
            escaped = escape(word)
            out.append(f"{{{escaped}}}" if any(c.isupper() for c in rest) else escaped)
    out.append("}" * depth)
    return "".join(out)


def _name(name: dict[str, Any]) -> str | None:
    literal = str(name.get("literal", "")).strip()
    if literal:
        return "{" + escape(literal) + "}"
    family = str(name.get("family", "")).strip()
    if not family:
        return None
    particle = str(name.get("non-dropping-particle", "")).strip()
    last = escape(f"{particle} {family}".strip())
    given_parts = [
        str(name.get("given", "")).strip(),
        str(name.get("dropping-particle", "")).strip(),
    ]
    given = escape(" ".join(p for p in given_parts if p))
    suffix = escape(str(name.get("suffix", "")).strip())
    if " and " in f" {last} ":
        last = "{" + last + "}"
    if suffix:
        return f"{last}, {suffix}, {given}"
    return f"{last}, {given}" if given else last


def _names(value: Any) -> str | None:
    if not isinstance(value, list):
        return None
    names = [n for n in (_name(item) for item in value if isinstance(item, dict)) if n]
    return " and ".join(names) or None


def _text(item: dict[str, Any], variable: str) -> str | None:
    value = item.get(variable)
    if isinstance(value, int | float) and not isinstance(value, bool):
        value = str(value)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def entry_type(item: dict[str, Any]) -> str:
    csl_type = item.get("type", "")
    if csl_type == "thesis":
        return "phdthesis" if _DOCTORAL.search(str(item.get("genre", ""))) else "mastersthesis"
    if csl_type in ("chapter", "entry", "entry-dictionary", "entry-encyclopedia") and not _text(
        item, "container-title"
    ):
        return "inbook"
    if csl_type == "article" and _text(item, "container-title"):
        return "article"
    return _TYPES.get(csl_type, "misc")


def to_bibtex(item: dict[str, Any], key: str) -> str:
    kind = entry_type(item)
    fields: list[tuple[str, str]] = []

    def add(name: str, value: str | None, *, raw: bool = False) -> None:
        if value:
            fields.append((name, value if raw else escape(value)))

    add("author", _names(item.get("author")), raw=True)
    add("editor", _names(item.get("editor")), raw=True)
    title = _text(item, "title")
    if title:
        fields.append(("title", _markup(title, protect_capitals=True)))
    container = _text(item, "container-title")
    if container:
        container_field = "journal" if kind == "article" else "booktitle"
        if kind in ("misc", "book", "techreport", "phdthesis", "mastersthesis", "booklet"):
            container_field = "howpublished" if kind == "misc" else "series"
        fields.append((container_field, _markup(container, protect_capitals=False)))
    add("series", _text(item, "collection-title") if not container else None)
    add("edition", _text(item, "edition"))
    add("volume", _text(item, "volume"))
    if kind == "article":
        add("number", _text(item, "issue"))
    else:
        add("number", _text(item, "number"))
    page = _text(item, "page")
    if page:
        fields.append(("pages", escape(re.sub(r"\s*[-\u2013\u2014]+\s*", "--", page))))
    publisher = _text(item, "publisher")
    publisher_field = {
        "techreport": "institution",
        "phdthesis": "school",
        "mastersthesis": "school",
    }.get(kind, "publisher")
    add(publisher_field, publisher)
    add("address", _text(item, "publisher-place"))
    if kind in ("techreport", "misc", "unpublished") and _text(item, "genre"):
        add("type", _text(item, "genre"))
    year = issued_year(item)
    if year is not None:
        fields.append(("year", str(year)))
        issued = item.get("issued")
        parts = issued.get("date-parts") if isinstance(issued, dict) else None
        if parts and len(parts[0]) > 1 and isinstance(parts[0][1], int) and 1 <= parts[0][1] <= 12:
            fields.append(("month", _MONTHS[parts[0][1] - 1]))
    add("doi", _text(item, "DOI"))
    add("url", _text(item, "URL"))
    add("isbn", _text(item, "ISBN"))
    add("issn", _text(item, "ISSN"))
    add("note", _text(item, "note"))

    lines = [f"@{kind}{{{key},"]
    for name, value in fields:
        if name == "month":
            lines.append(f"  {name} = {value},")
        else:
            lines.append(f"  {name} = {{{value}}},")
    lines.append("}")
    return "\n".join(lines)
