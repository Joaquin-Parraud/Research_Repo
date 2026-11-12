"""APA 7 output through a CSL processor (FR-C1 to FR-C3, FR-L3).

The processor is citeproc-py with the official ``apa.csl`` (vendored in ``data/``). Nothing in
this module builds reference strings itself; it only prepares the processor's input and makes
its output safe:

* Input normalisation. ``id`` is the citation key; an item without ``language`` gets the
  project's citation language (otherwise citeproc-py title-cases Spanish titles).
  Same-author, same-year works get a ``year-suffix`` (a, b, …; APA 9.47) because
  citeproc-py does not compute it; suffixes follow the processor's own title order.
  ``raw`` dates become ``date-parts`` (or ``literal``); a date range is reduced to its first
  date and ``event-title`` is copied to ``event``, because citeproc-py cannot handle either.
* Narrative in-text citations come from a variant of the same style, derived in memory: the
  citation layout prints ``author-short`` followed by ``(date-short)``, and that macro joins
  names with the locale's word for "and" instead of "&".
* Escaping. User text reaches the processor with ``&``, ``<`` and ``>`` replaced by private-use
  placeholders (CSL's own ``<i>``, ``<b>``, ``<sup>``, ``<sub>`` markup in titles is kept), so
  no user text can become markup and case transforms cannot touch entities. The output is then
  reduced to ``<i>``, ``<b>``, ``<sup>``, ``<sub>`` and everything else is escaped.

citeproc-py is not thread-safe; rendering runs under one lock (callers use a worker thread).
"""

import copy
import html
import io
import re
import threading
import warnings
from collections import defaultdict
from dataclasses import dataclass
from functools import cache
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from lxml import etree

from research_repo.citations.csl import (
    DATE_VARIABLES,
    NAME_VARIABLES,
    ascii_fold,
    issued_year,
    raw_to_date_parts,
)

DATA_DIR = Path(__file__).parent / "data"
STYLE_PATH = DATA_DIR / "apa.csl"
# Project citation locale → CSL locale file (``es`` is neutral Spanish: CSL's primary es-ES).
CSL_LOCALES = {"en-US": "en-US", "es": "es-ES"}
_CSL_NS = "http://purl.org/net/xbiblio/csl"
_NS = {"cs": _CSL_NS}

_AMP, _LT, _GT = "", "", ""
_KEPT_TAGS = re.compile(r"(</?(?:i|b|sup|sub)>|<span class=\"nocase\">|</span>)")
_ALLOWED_OUTPUT_TAGS = {"i": "i", "em": "i", "b": "b", "strong": "b", "sup": "sup", "sub": "sub"}

# citeproc-py warns about every CSL variable it does not model; that is expected here.
warnings.filterwarnings("ignore", category=UserWarning, module=r"citeproc(\.|$)")

_lock = threading.Lock()


class RenderFailed(Exception):
    """The processor raised for these items."""


@dataclass(frozen=True)
class Entry:
    key: str
    reference_html: str
    reference_text: str
    in_text_parenthetical: str
    in_text_narrative: str


# --- style loading ------------------------------------------------------------------------


def _narrative_variant(style_xml: bytes) -> bytes:
    root = etree.fromstring(style_xml)
    layout = root.find("cs:citation/cs:layout", _NS)
    macro = root.find("cs:macro[@name='author-short']", _NS)
    if layout is None or macro is None:
        raise RuntimeError("apa.csl does not have the expected citation layout")
    for attribute in ("prefix", "suffix"):
        layout.attrib.pop(attribute, None)
    for child in list(layout):
        layout.remove(child)
    narrative = etree.fromstring(
        f'<group xmlns="{_CSL_NS}" delimiter=" ">'
        '<text macro="author-short"/>'
        '<group prefix="(" suffix=")" delimiter=", ">'
        '<text macro="date-short"/><text macro="label-locator"/>'
        "</group></group>"
    )
    layout.append(narrative)
    for name in macro.iter(f"{{{_CSL_NS}}}name"):
        if name.get("and") == "symbol":
            name.set("and", "text")
    return etree.tostring(root, xml_declaration=True, encoding="utf-8")


def _use_vendored_locales(style: Any, csl_locale: str) -> None:
    """Replace the locale chain citeproc-py built from its bundled files with ours."""
    from citeproc.frontend import CitationStylesXML

    root = style.root
    language = csl_locale.split("-")[0]
    chain: list[Any] = []
    for expr in (
        f'./cs:locale[@xml:lang="{csl_locale}"]',
        f'./cs:locale[@xml:lang="{language}"]',
        "./cs:locale[not(@xml:lang)]",
    ):
        chain.extend(root.xpath_search(expr))
    for name in dict.fromkeys([csl_locale, "en-US"]):
        chain.append(CitationStylesXML(str(DATA_DIR / f"locales-{name}.xml"), validate=False).root)
    for element in chain:
        element.style = root
    root.locales = chain


@cache
def _styles(locale: str) -> tuple[Any, Any]:
    """(reference/parenthetical style, narrative style) for a project citation locale."""
    from citeproc import CitationStylesStyle

    csl_locale = CSL_LOCALES[locale]
    xml = STYLE_PATH.read_bytes()
    styles = []
    for variant in (xml, _narrative_variant(xml)):
        style = CitationStylesStyle(io.BytesIO(variant), locale=csl_locale, validate=False)
        _use_vendored_locales(style, csl_locale)
        styles.append(style)
    return styles[0], styles[1]


# --- input normalisation -------------------------------------------------------------------


def _protect(value: str) -> str:
    pieces = _KEPT_TAGS.split(value)
    out = []
    for index, piece in enumerate(pieces):
        if index % 2:  # a kept tag
            out.append(piece)
        else:
            out.append(piece.replace("&", _AMP).replace("<", _LT).replace(">", _GT))
    return "".join(out)


def _protect_all(value: Any) -> Any:
    if isinstance(value, str):
        return _protect(value)
    if isinstance(value, list):
        return [_protect_all(v) for v in value]
    if isinstance(value, dict):
        return {k: _protect_all(v) for k, v in value.items()}
    return value


def _date_for_processor(value: dict[str, Any]) -> dict[str, Any] | None:
    parts = value.get("date-parts")
    if parts:
        date: dict[str, Any] = {"date-parts": [list(parts[0])]}
    elif isinstance(value.get("raw"), str):
        parsed = raw_to_date_parts(value["raw"])
        date = {"date-parts": parsed} if parsed else {"literal": value["raw"]}
    elif isinstance(value.get("literal"), str):
        date = {"literal": value["literal"]}
    else:
        return None
    for extra in ("season", "circa"):
        if extra in value:
            date[extra] = value[extra]
    return date


def processor_item(
    item: dict[str, Any], key: str, year_suffix: str | None, locale: str = "en-US"
) -> dict[str, Any]:
    data = copy.deepcopy(item)
    # CSL treats an item without ``language`` as English and title-cases it; citeproc-py does
    # so even in a Spanish reference list. An item without a language is taken to be in the
    # project's citation language.
    if not isinstance(data.get("language"), str) or not data["language"].strip():
        data["language"] = CSL_LOCALES[locale]
    data.pop("year-suffix", None)
    if "event-title" in data:
        event_title = data.pop("event-title")
        data.setdefault("event", event_title)
    for variable in DATE_VARIABLES & data.keys():
        date = _date_for_processor(data[variable]) if isinstance(data[variable], dict) else None
        if date is None:
            del data[variable]
        else:
            data[variable] = date
    for variable, value in list(data.items()):
        if variable in NAME_VARIABLES or variable in DATE_VARIABLES:
            continue
        if isinstance(value, bool):
            del data[variable]
        elif isinstance(value, int | float):
            data[variable] = str(value)
        elif not isinstance(value, str):
            del data[variable]  # nested values are not CSL variables the processor uses
    data = _protect_all(data)
    data["id"] = key
    if year_suffix:
        data["year-suffix"] = year_suffix
    return data


def _names_signature(item: dict[str, Any]) -> tuple[str, ...]:
    for variable in ("author", "editor"):
        names = item.get(variable)
        if isinstance(names, list) and names:
            signature = [variable]
            for name in names:
                if not isinstance(name, dict):
                    continue
                literal = str(name.get("literal", "")).strip()
                if literal:
                    signature.append(literal.casefold())
                else:
                    family = str(name.get("family", "")).strip().casefold()
                    given = str(name.get("given", "")).strip()
                    initials = "".join(w[0] for w in re.split(r"[\s.\-]+", given) if w)
                    signature.append(f"{family}|{initials.casefold()}")
            return tuple(signature)
    return ("title", str(item.get("title", "")).casefold())


def _date_signature(item: dict[str, Any]) -> str:
    year = issued_year(item)
    if year is not None:
        return str(year)
    issued = item.get("issued")
    if isinstance(issued, dict) and isinstance(issued.get("literal"), str):
        return issued["literal"].casefold()
    return "nd"


def _title_sort_key(item: dict[str, Any]) -> str:
    # The same order the processor uses for the reference list (plain title, no article
    # stripping), so that 2020a is always listed before 2020b.
    title = re.sub(r"<[^>]+>", "", str(item.get("title", "")))
    return ascii_fold(title.strip()).casefold()


def year_suffixes(items: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Year suffixes for works with identical author lists and year (APA 9.47), by title."""
    groups: dict[tuple[Any, ...], list[str]] = defaultdict(list)
    for key, item in items.items():
        groups[(_names_signature(item), _date_signature(item))].append(key)
    result: dict[str, str] = {}
    for keys in groups.values():
        if len(keys) < 2:
            continue
        ordered = sorted(keys, key=lambda k: (_title_sort_key(items[k]), k))
        for index, key in enumerate(ordered):
            result[key] = _letters(index + 1)
    return result


def _letters(n: int) -> str:
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(ord("a") + rem) + out
    return out


# --- output --------------------------------------------------------------------------------


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _ALLOWED_OUTPUT_TAGS:
            self.out.append(f"<{_ALLOWED_OUTPUT_TAGS[tag]}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in _ALLOWED_OUTPUT_TAGS:
            self.out.append(f"</{_ALLOWED_OUTPUT_TAGS[tag]}>")

    def handle_data(self, data: str) -> None:
        self.out.append(html.escape(data, quote=False))


def _sanitize(markup: str) -> str:
    parser = _Sanitizer()
    parser.feed(markup)
    parser.close()
    return "".join(parser.out)


def _restore_html(value: str) -> str:
    return value.replace(_AMP, "&amp;").replace(_LT, "&lt;").replace(_GT, "&gt;")


def _to_text(safe_html: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", "", safe_html))
    return text.replace(_AMP, "&").replace(_LT, "<").replace(_GT, ">")


def _clean(markup: str) -> tuple[str, str]:
    """(safe HTML, plain text) from processor output."""
    safe = _sanitize(" ".join(str(markup).split()))
    return _restore_html(safe), _to_text(safe)


def _run(style: Any, items: list[dict[str, Any]]) -> tuple[list[str], dict[str, str], list[str]]:
    """Processor bibliography order, in-text citation per key, bibliography entries."""
    from citeproc import Citation, CitationItem, CitationStylesBibliography, formatter
    from citeproc.source.json import CiteProcJSON

    bibliography = CitationStylesBibliography(style, CiteProcJSON(items), formatter.html)
    citations = {item["id"]: Citation([CitationItem(item["id"])]) for item in items}
    for citation in citations.values():
        bibliography.register(citation)
    bibliography.sort()
    cites = {key: str(bibliography.cite(c, lambda _: None)) for key, c in citations.items()}
    entries = [str(entry) for entry in bibliography.bibliography()]
    return list(bibliography.keys), cites, entries


def render(items: list[dict[str, Any]], locale: str) -> list[Entry]:
    """Render prepared items (see :func:`processor_item`) in APA reference-list order."""
    if not items:
        return []
    reference_style, narrative_style = _styles(locale)
    try:
        with _lock:
            order, parenthetical, entries = _run(reference_style, items)
            _, narrative, _ = _run(narrative_style, items)
    except Exception as exc:  # the processor raises many types on input it cannot handle
        raise RenderFailed(str(exc)) from exc
    result = []
    for key, entry in zip(order, entries, strict=True):
        reference_html, reference_text = _clean(entry)
        result.append(
            Entry(
                key=key,
                reference_html=reference_html,
                reference_text=reference_text,
                in_text_parenthetical=_clean(parenthetical[key])[1],
                in_text_narrative=_clean(narrative[key])[1],
            )
        )
    return result


def warm_up() -> None:
    """Parse the styles ahead of the first request (optional)."""
    for locale in CSL_LOCALES:
        _styles(locale)
