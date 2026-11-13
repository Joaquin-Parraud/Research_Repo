"""Crossref records as they really come, through the mapping to CSL-JSON and into APA 7.

Regression tests for wrong or missing citations: each record below is shaped like a real
Crossref ``/works/{doi}`` message (hand-written, never fetched). The client tests use an
httpx.MockTransport; nothing reaches Crossref.
"""

import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from research_repo.citations import crossref
from research_repo.citations.keys import key_base
from research_repo.citations.pdfmeta import find_doi
from research_repo.citations.processor import CiteprocClient

ARTICLE_NUMBER = {
    "DOI": "10.1016/j.jbankfin.2020.105956",
    "type": "journal-article",
    "title": ["Market risk in emerging economies"],
    "container-title": ["Journal of Banking &amp; Finance"],
    "volume": "120",
    "article-number": "105956",
    "issued": {"date-parts": [[2020, 11]]},
    "author": [{"given": "Ana", "family": "Pérez", "sequence": "first", "affiliation": []}],
}


# --- mapping -------------------------------------------------------------------------------


def test_article_number_stays_a_number() -> None:
    """APA 9.26 / example 6: "*120*, Article 105956", not a page range "120, 105956"."""
    item = crossref.to_csl(ARTICLE_NUMBER)
    assert item["number"] == "105956"
    assert "page" not in item


def test_article_number_and_pages_are_both_kept() -> None:
    """APA 9.26 gives the article number instead of the page range; the style decides."""
    item = crossref.to_csl({**ARTICLE_NUMBER, "page": "1-12"})
    assert (item["page"], item["number"]) == ("1-12", "105956")


def test_article_number_of_a_chapter_is_not_a_series_number() -> None:
    item = crossref.to_csl(
        {**ARTICLE_NUMBER, "type": "book-chapter", "article-number": "7", "page": "100-110"}
    )
    assert "number" not in item


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Wiley marks small caps inside words; the tag is not a word boundary.
        ("The <scp>COVID</scp>‐19 pandemic", "The COVID‐19 pandemic"),
        ("<scp>m</scp>RNA vaccines", "mRNA vaccines"),
        ("Na<sup>+</sup> channels in <span>neurons</span>", "Na<sup>+</sup> channels in neurons"),
        ("A <mml:math><mml:mi>k</mml:mi></mml:math>-means study", "A k-means study"),
        # Block-level JATS elements still separate words.
        ("<jats:title>Part one</jats:title><jats:p>Part two</jats:p>", "Part one Part two"),
        ("Line<br/>break", "Line break"),
        # Some deposits escape their markup once more.
        (
            "Flies (&lt;i&gt;Drosophila&lt;/i&gt;) and &lt;scp&gt;DNA&lt;/scp&gt;",
            "Flies (<i>Drosophila</i>) and DNA",
        ),
        ("Risk &amp;amp; return", "Risk & return"),
    ],
)
def test_title_markup(raw: str, expected: str) -> None:
    assert crossref.clean_markup(raw) == expected


def test_comparison_signs_in_titles_are_text() -> None:
    assert (
        crossref.clean_markup("Effects at p &lt; .05 and n&gt;30") == "Effects at p < .05 and n>30"
    )


@pytest.mark.parametrize(
    ("degree", "genre"),
    [
        (["PhD"], "Doctoral dissertation"),
        (["Ph.D."], "Doctoral dissertation"),
        (["Doctor of Education"], "Doctoral dissertation"),
        (["EdD"], "Doctoral dissertation"),
        (["MSc"], "Master's thesis"),
        (["Master of Arts"], "Master's thesis"),
        (["MA"], "Master's thesis"),
        (None, None),
        (["Bachelor"], None),
    ],
)
def test_dissertation_degree_becomes_the_genre(degree: list[str] | None, genre: str | None) -> None:
    """APA 10.6: "[Doctoral dissertation, Institution]"."""
    message: dict[str, Any] = {
        "DOI": "10.5555/thesis.1",
        "type": "dissertation",
        "title": ["A study"],
        "author": [{"given": "Pedro", "family": "Ruiz"}],
        "institution": [{"name": "Universidad de Chile"}],
        "issued": {"date-parts": [[2019]]},
    }
    if degree is not None:
        message["degree"] = degree
    item = crossref.to_csl(message)
    assert item.get("genre") == genre
    assert item["publisher"] == "Universidad de Chile"


def test_date_parts_given_as_strings_are_kept() -> None:
    item = crossref.to_csl({**ARTICLE_NUMBER, "issued": {"date-parts": [["2018", "3"]]}})
    assert item["issued"] == {"date-parts": [[2018, 3]]}


def test_date_falls_through_to_the_next_usable_field() -> None:
    item = crossref.to_csl(
        {
            **ARTICLE_NUMBER,
            "issued": {"date-parts": [["n.d."]]},
            "published-online": {"date-parts": [[2017, 2]]},
        }
    )
    assert item["issued"] == {"date-parts": [[2017, 2]]}


def test_person_without_a_family_name_is_not_lost() -> None:
    item = crossref.to_csl(
        {**ARTICLE_NUMBER, "author": [{"given": "Aristotle"}, {"given": "", "family": " "}]}
    )
    assert item["author"] == [{"literal": "Aristotle"}]


# --- DOI detection -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # Wiley SICI DOIs contain "<" and ">".
        (
            "DOI 10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0",
            "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0",
        ),
        (
            "doi: 10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0.",
            "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0",
        ),
        # Line breaks inside a DOI, as text extraction gives them for a narrow first-page box.
        (
            "https://doi.org/10.1016/j.\njfineco.2020.01.001\nReceived",
            "10.1016/j.jfineco.2020.01.001",
        ),
        ("doi:10.1177/09567976-\n20959014 more", "10.1177/09567976-20959014"),
        ("https://doi.org/10.1037/\nabc0000123", "10.1037/abc0000123"),
        # A sentence that ends after a DOI is not glued to the next line.
        ("See doi:10.1234/abc.\nThe next sentence", "10.1234/abc"),
    ],
)
def test_find_doi_in_page_text(text: str, expected: str) -> None:
    assert find_doi(text) == expected


# --- client: retries, backoff, rate limits ----------------------------------------------------


def _client(
    responses: list[httpx.Response | Exception], **kwargs: Any
) -> tuple[crossref.CrossrefClient, list[float]]:
    times: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        times.append(time.monotonic())
        result = responses.pop(0) if len(responses) > 1 else responses[0]
        if isinstance(result, Exception):
            raise result
        return result

    client = crossref.CrossrefClient(
        transport=httpx.MockTransport(handler), retry_delays=(0.05, 0.1), **kwargs
    )
    return client, times


def _work(payload: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json={"status": "ok", "message": payload})


@pytest.mark.parametrize(
    "failure",
    [
        httpx.Response(429, headers={"Retry-After": "0"}),
        httpx.Response(503),
        httpx.Response(502),
        httpx.ConnectError("connection refused"),
        httpx.ReadTimeout("slow"),
    ],
)
async def test_transient_failures_are_retried(failure: httpx.Response | Exception) -> None:
    client, times = _client([failure, _work(ARTICLE_NUMBER)])
    message = await client.work("10.1016/j.jbankfin.2020.105956", timeout=5)
    assert message["DOI"] == ARTICLE_NUMBER["DOI"]
    assert len(times) == 2


async def test_retries_are_bounded_and_back_off() -> None:
    client, times = _client([httpx.Response(503)])
    with pytest.raises(crossref.CrossrefError):
        await client.work("10.1000/x", timeout=5)
    assert len(times) == 3
    assert times[1] - times[0] >= 0.04
    assert times[2] - times[1] >= 0.09


@pytest.mark.parametrize("status", [404, 400, 403])
async def test_permanent_answers_are_not_retried(status: int) -> None:
    client, times = _client([httpx.Response(status)])
    with pytest.raises((crossref.CrossrefNotFound, crossref.CrossrefError)):
        await client.work("10.1000/x", timeout=5)
    assert len(times) == 1


async def test_retry_after_beyond_the_budget_gives_up_at_once() -> None:
    client, times = _client([httpx.Response(429, headers={"Retry-After": "60"})])
    started = time.monotonic()
    with pytest.raises(crossref.CrossrefError):
        await client.work("10.1000/x", timeout=2)
    assert len(times) == 1
    assert time.monotonic() - started < 1


async def test_retry_after_is_honoured() -> None:
    client, times = _client(
        [httpx.Response(429, headers={"Retry-After": "1"}), _work(ARTICLE_NUMBER)]
    )
    await client.work("10.1000/x", timeout=5)
    assert times[1] - times[0] >= 0.95


# --- rendered: what the user sees ----------------------------------------------------------


@pytest.fixture
async def processor(citeproc_url: str) -> AsyncIterator[CiteprocClient]:
    client = CiteprocClient(citeproc_url, timeout=30)
    yield client
    await client.aclose()


RENDERED = [
    (
        ARTICLE_NUMBER,
        "Pérez, A. (2020). Market risk in emerging economies. <i>Journal of Banking &amp; "
        "Finance</i>, <i>120</i>, Article 105956. https://doi.org/10.1016/j.jbankfin.2020.105956",
    ),
    (
        {
            "DOI": "10.1111/risa.13000",
            "type": "journal-article",
            "title": ["The <scp>COVID</scp>‐19 pandemic and <i>Homo sapiens</i>"],
            "container-title": ["Risk Analysis"],
            "volume": "41",
            "issue": "2",
            "page": "1-9",
            "issued": {"date-parts": [[2021]]},
            "author": [{"given": "Bo", "family": "Li"}],
        },
        "Li, B. (2021). The COVID‐19 pandemic and <i>Homo sapiens</i>. <i>Risk Analysis</i>, "
        "<i>41</i>(2), 1–9. https://doi.org/10.1111/risa.13000",
    ),
    (
        {
            "DOI": "10.5555/thesis.1",
            "type": "dissertation",
            "title": ["A study of thesis formatting"],
            "author": [{"given": "Pedro", "family": "Ruiz"}],
            "institution": [{"name": "Universidad de Chile"}],
            "degree": ["PhD"],
            "issued": {"date-parts": [[2019]]},
        },
        "Ruiz, P. (2019). <i>A study of thesis formatting</i> [Doctoral dissertation, "
        "Universidad de Chile]. https://doi.org/10.5555/thesis.1",
    ),
]


@pytest.mark.citeproc
@pytest.mark.parametrize(("message", "expected"), RENDERED, ids=["article-number", "scp", "thesis"])
async def test_crossref_record_renders_as_apa(
    processor: CiteprocClient, message: dict[str, Any], expected: str
) -> None:
    csl = crossref.to_csl(message)
    key = key_base(csl)
    entry = await processor.citation("en-US", {key: csl}, key)
    assert entry.reference_html == expected
