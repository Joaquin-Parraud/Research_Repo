"""Metadata suggestions: DOI extraction, embedded metadata, Crossref mapping and lookups.

Crossref is never contacted: every test uses an httpx.MockTransport with payloads shaped like
real Crossref ``/works/{doi}`` responses (written by hand).
"""

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from research_repo.citations import crossref
from research_repo.citations.csl import InvalidCsl
from research_repo.citations.pdfmeta import (
    find_doi,
    inspect_pdf,
    parse_authors,
    plausible_title,
)
from research_repo.core.config import Settings
from research_repo.models import User
from research_repo.services.metadata import MetadataLookup
from tests.helpers import assert_error, create_project, make_pdf, make_text_pdf, upload

JOURNAL = {
    "DOI": "10.1037/abc0000123",
    "type": "journal-article",
    "title": [
        "The <i>effect</i> of <jats:italic>things</jats:italic> on CO<sub>2</sub> &amp; stuff"
    ],
    "subtitle": ["A replication"],
    "author": [
        {
            "given": "María",
            "family": "García",
            "sequence": "first",
            "affiliation": [{"name": "UDD"}],
            "ORCID": "http://orcid.org/0000-0000-0000-0000",
        },
        {"given": "John", "family": "Smith", "sequence": "additional", "affiliation": []},
    ],
    "container-title": ["Journal of Applied Things"],
    "short-container-title": ["J. Appl. Things"],
    "volume": "12",
    "issue": "3",
    "page": "45-67",
    "issued": {"date-parts": [[2021, 5, 3]]},
    "published-print": {"date-parts": [[2021, 6]]},
    "ISSN": ["1234-5678", "8765-4321"],
    "URL": "http://dx.doi.org/10.1037/abc0000123",
    "publisher": "American Psychological Association (APA)",
    "abstract": "<jats:p>Long abstract…</jats:p>",
    "reference-count": 42,
}
CHAPTER = {
    "DOI": "10.4324/9781003-5",
    "type": "book-chapter",
    "title": ["Chapter title here"],
    "author": [{"given": "Harry", "family": "Hall", "sequence": "first", "affiliation": []}],
    "editor": [
        {"given": "Eve", "family": "Edwards", "affiliation": []},
        {"given": "Frank", "family": "Ford", "affiliation": []},
    ],
    "container-title": ["The edited book"],
    "page": "15-30",
    "publisher": "Routledge",
    "publisher-location": "London",
    "ISBN": ["9781003000000"],
    "issued": {"date-parts": [[2016]]},
}
PROCEEDINGS = {
    "DOI": "10.1145/3292500.3330701",
    "type": "proceedings-article",
    "title": ["Learning with graphs"],
    "author": [{"given": "Andrew", "family": "Ng"}, {"name": "The Graph Consortium"}],
    "container-title": ["Proceedings of the 25th ACM SIGKDD Conference"],
    "event": {"name": "KDD '19: The 25th ACM SIGKDD Conference", "location": "Anchorage AK USA"},
    "page": "100-110",
    "publisher": "ACM",
    "issued": {"date-parts": [[None]]},
    "published-online": {"date-parts": [[2019, 7, 25]]},
}
PREPRINT = {
    "DOI": "10.31234/osf.io/abcd",
    "type": "posted-content",
    "subtype": "preprint",
    "title": ["A preprint about things"],
    "author": [{"given": "Li", "family": "Zhou"}],
    "institution": [{"name": "PsyArXiv"}],
    "group-title": "PsyArXiv",
    "issued": {"date-parts": [[2021, 2, 1]]},
    "publisher": "Center for Open Science",
}
DISSERTATION = {
    "DOI": "10.5555/thesis.1",
    "type": "dissertation",
    "title": ["A study of thesis formatting"],
    "author": [{"given": "Pedro", "family": "Ruiz"}],
    "institution": [{"name": "Universidad de Chile"}],
    "issued": {"date-parts": [[2019]]},
    "publisher": "ProQuest",
}


def _message(payload: dict[str, Any]) -> dict[str, Any]:
    return {"status": "ok", "message-type": "work", "message-version": "1.0.0", "message": payload}


def test_map_journal_article() -> None:
    item = crossref.to_csl(JOURNAL)
    assert item["type"] == "article-journal"
    assert item["title"] == (
        "The <i>effect</i> of <i>things</i> on CO<sub>2</sub> & stuff: A replication"
    )
    assert item["author"] == [
        {"family": "García", "given": "María"},
        {"family": "Smith", "given": "John"},
    ]
    assert item["container-title"] == "Journal of Applied Things"
    assert item["container-title-short"] == "J. Appl. Things"
    assert item["issued"] == {"date-parts": [[2021, 5, 3]]}
    assert (item["volume"], item["issue"], item["page"]) == ("12", "3", "45-67")
    assert item["DOI"] == "10.1037/abc0000123"
    assert "URL" not in item  # the DOI is the link
    assert item["ISSN"] == "1234-5678"
    assert "abstract" not in item


def test_map_chapter_proceedings_preprint_dissertation() -> None:
    chapter = crossref.to_csl(CHAPTER)
    assert chapter["type"] == "chapter"
    assert chapter["editor"][1] == {"family": "Ford", "given": "Frank"}
    assert (chapter["container-title"], chapter["publisher-place"]) == ("The edited book", "London")
    assert chapter["ISBN"] == "9781003000000"

    paper = crossref.to_csl(PROCEEDINGS)
    assert paper["type"] == "paper-conference"
    assert paper["author"][1] == {"literal": "The Graph Consortium"}
    assert paper["issued"] == {"date-parts": [[2019, 7, 25]]}  # issued [[null]] skipped
    assert paper["event-title"] == "KDD '19: The 25th ACM SIGKDD Conference"
    assert paper["event-place"] == "Anchorage AK USA"

    preprint = crossref.to_csl(PREPRINT)
    assert (preprint["type"], preprint["genre"], preprint["publisher"]) == (
        "article",
        "Preprint",
        "PsyArXiv",
    )

    thesis = crossref.to_csl(DISSERTATION)
    assert (thesis["type"], thesis["publisher"]) == ("thesis", "Universidad de Chile")

    assert crossref.to_csl({"type": "something-new", "title": ["X y"]})["type"] == "document"
    with pytest.raises(InvalidCsl):
        crossref.to_csl({"type": "journal-article", "title": []})


def test_user_agent() -> None:
    assert crossref.user_agent(None).startswith("ResearchRepo/")
    assert "mailto:me@example.org" in crossref.user_agent("me@example.org")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("see https://doi.org/10.1234/abc.def.", "10.1234/abc.def"),
        ("(doi:10.1234/abc)", "10.1234/abc"),
        ("DOI 10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0", None),
        ("doi: 10.1016/j.jfineco.2020.01.001;", "10.1016/j.jfineco.2020.01.001"),
        ("10.1000/a(b)c), more", "10.1000/a(b)c"),
        ("[10.5555/xyz]", "10.5555/xyz"),
        ("no doi here 10.12/short", None),
    ],
)
def test_find_doi(text: str, expected: str | None) -> None:
    found = find_doi(text)
    if text.startswith("DOI 10.1002/(SICI)"):
        assert found is not None
        assert found.startswith("10.1002/(SICI)1097-4571(199806)49:8")
    else:
        assert found == expected


@pytest.mark.parametrize(
    ("title", "plausible"),
    [
        ("Microsoft Word - final_v3.docx", False),
        ("untitled", False),
        ("Untitled document", False),
        ("paper.pdf", False),
        ("C:\\Users\\me\\draft", False),
        ("test", False),
        ("12345", False),
        ("Document1", False),
        ("Financial risk in emerging markets", True),
        ("Política de gratuidad universitaria", True),
    ],
)
def test_plausible_title(title: str, plausible: bool) -> None:
    assert (plausible_title(title) is not None) is plausible


def test_parse_authors() -> None:
    assert parse_authors("García, María; Smith, John") == [
        {"family": "García", "given": "María"},
        {"family": "Smith", "given": "John"},
    ]
    assert parse_authors("María García and John Smith") == [
        {"family": "García", "given": "María"},
        {"family": "Smith", "given": "John"},
    ]
    assert parse_authors("María García, John Smith") == [
        {"family": "García", "given": "María"},
        {"family": "Smith", "given": "John"},
    ]
    assert parse_authors("Lee, Ann") == [{"family": "Lee", "given": "Ann"}]
    assert parse_authors("Administrator") == []
    assert parse_authors("jdoe@example.org") == []
    assert parse_authors("") == []


def test_inspect_pdf(tmp_path: Path) -> None:
    path = tmp_path / "x.pdf"
    path.write_bytes(make_text_pdf([["Title"]], info={"doi": "10.5555/info.1"}))
    assert inspect_pdf(path).doi == "10.5555/info.1"
    path.write_bytes(make_text_pdf([["x"]], info={"Subject": "J. Things, doi:10.5555/subj.2"}))
    assert inspect_pdf(path).doi == "10.5555/subj.2"
    xmp = "<x:xmpmeta><rdf:RDF><prism:doi>10.5555/xmp.3</prism:doi></rdf:RDF></x:xmpmeta>"
    path.write_bytes(make_text_pdf([["x"]], xmp=xmp))
    assert inspect_pdf(path).doi == "10.5555/xmp.3"
    path.write_bytes(make_text_pdf([["A title"], ["Published as https://doi.org/10.5555/p2.4."]]))
    assert inspect_pdf(path).doi == "10.5555/p2.4"
    # Only the first two pages are read.
    path.write_bytes(make_text_pdf([["one"], ["two"], ["doi:10.5555/p3.5"]]))
    assert inspect_pdf(path).doi is None

    path.write_bytes(
        make_text_pdf(
            [["no doi"]],
            info={
                "Title": "Financial risk in emerging markets",
                "Author": "García, María; Smith, John",
                "CreationDate": "D:20200115120000Z",
            },
        )
    )
    facts = inspect_pdf(path)
    assert (facts.doi, facts.title, facts.year) == (
        None,
        "Financial risk in emerging markets",
        2020,
    )
    assert facts.authors[0] == {"family": "García", "given": "María"}
    # Damaged or truncated files give nothing, without raising.
    path.write_bytes(b"%PDF-1.4\nbroken")
    assert inspect_pdf(path).doi is None


# --- the pipeline through the API ----------------------------------------------------------

Handler = Callable[[httpx.Request], Any]


def _use_crossref(
    app: FastAPI, settings: Settings, handler: Handler, **overrides: Any
) -> list[str]:
    """Route Crossref calls to ``handler``; returns the list of requested URLs."""
    calls: list[str] = []

    async def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert request.headers["user-agent"].startswith("ResearchRepo/")
        result = handler(request)
        if asyncio.iscoroutine(result):
            result = await result
        return result

    app.state.metadata_lookup = MetadataLookup(
        settings.model_copy(update=overrides), transport=httpx.MockTransport(wrapped)
    )
    return calls


def _ok(payload: dict[str, Any]) -> Handler:
    return lambda _: httpx.Response(200, json=_message(payload))


DOI_PDF = make_text_pdf(
    [["The effect of things", "https://doi.org/10.1037/abc0000123."]],
    info={"Title": "Embedded fallback title here", "Author": "Embedded, Author"},
)


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


async def test_upload_with_doi_found(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, pid: str
) -> None:
    calls = _use_crossref(app, settings, _ok(JOURNAL), crossref_mailto="me@example.org")
    response = await upload(client, pid, DOI_PDF)
    assert response.status_code == 201, response.text
    source = response.json()
    assert calls == ["https://api.crossref.org/works/10.1037/abc0000123"]
    assert source["metadata_status"] == "suggested"
    assert source["csl"]["container-title"] == "Journal of Applied Things"
    assert source["title"].startswith("The <i>effect</i>")
    assert source["authors_text"] == "García & Smith"
    assert (source["year"], source["doi"]) == (2021, "10.1037/abc0000123")
    assert source["citation_key"] == "garcia2021"


async def test_upload_doi_not_found_falls_back_to_embedded(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, pid: str
) -> None:
    calls = _use_crossref(app, settings, lambda _: httpx.Response(404, text="Resource not found."))
    source = (await upload(client, pid, DOI_PDF)).json()
    assert len(calls) == 1
    assert source["metadata_status"] == "suggested"
    assert source["csl"] == {
        "type": "document",
        "title": "Embedded fallback title here",
        "author": [{"family": "Embedded", "given": "Author"}],
        "DOI": "10.1037/abc0000123",
    }


async def test_upload_survives_timeout_and_errors(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, pid: str
) -> None:
    async def slow(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200, json=_message(JOURNAL))

    _use_crossref(app, settings, slow, metadata_lookup_timeout_seconds=0.3)
    plain = make_text_pdf([["doi:10.1037/abc0000123"]])
    response = await upload(client, pid, plain)
    assert response.status_code == 201
    assert response.json()["metadata_status"] == "pending"

    def boom(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    _use_crossref(app, settings, boom)
    response = await upload(client, pid, plain, allow_duplicate="true")
    assert response.status_code == 201
    assert response.json()["metadata_status"] == "pending"

    _use_crossref(app, settings, lambda _: httpx.Response(500))
    assert (await upload(client, pid, plain, allow_duplicate="true")).status_code == 201
    _use_crossref(app, settings, lambda _: httpx.Response(200, text="not json"))
    assert (await upload(client, pid, plain, allow_duplicate="true")).status_code == 201


async def test_upload_with_lookup_disabled(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, pid: str
) -> None:
    calls = _use_crossref(app, settings, _ok(JOURNAL), metadata_lookup_enabled=False)
    source = (await upload(client, pid, DOI_PDF)).json()
    assert calls == []
    assert source["metadata_status"] == "suggested"
    assert source["csl"]["title"] == "Embedded fallback title here"


async def test_upload_junk_metadata_stays_pending(client: httpx.AsyncClient, pid: str) -> None:
    pdf = make_text_pdf([["no identifiers"]], info={"Title": "Microsoft Word - thesis.docx"})
    source = (await upload(client, pid, pdf, filename="My paper.pdf")).json()
    assert source["metadata_status"] == "pending"
    assert source["title"] == "My paper"
    # The test helper's PDFs carry a one-word /Title, which is not plausible either.
    assert (await upload(client, pid, make_pdf())).json()["metadata_status"] == "pending"


async def test_suggest_endpoint_does_not_save(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, pid: str
) -> None:
    _use_crossref(app, settings, lambda _: httpx.Response(404))
    source = (await upload(client, pid, DOI_PDF)).json()
    await client.patch(
        f"/api/sources/{source['id']}", json={"title": "Mine", "metadata_status": "confirmed"}
    )
    _use_crossref(app, settings, _ok(JOURNAL))
    response = await client.post(f"/api/sources/{source['id']}/metadata/suggest")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["origin"], body["doi"]) == ("doi", "10.1037/abc0000123")
    assert body["csl"]["container-title"] == "Journal of Applied Things"
    stored = (await client.get(f"/api/sources/{source['id']}")).json()
    assert (stored["title"], stored["metadata_status"]) == ("Mine", "confirmed")

    _use_crossref(app, settings, _ok(JOURNAL), metadata_lookup_enabled=False)
    body = (await client.post(f"/api/sources/{source['id']}/metadata/suggest")).json()
    assert body["origin"] == "pdf"

    plain = (await upload(client, pid, make_text_pdf([["nothing"]]))).json()
    body = (await client.post(f"/api/sources/{plain['id']}/metadata/suggest")).json()
    assert body == {"csl": None, "origin": "none", "doi": None}
    citation_only = (await upload(client, pid, title="Book")).json()
    body = (await client.post(f"/api/sources/{citation_only['id']}/metadata/suggest")).json()
    assert body == {"csl": None, "origin": "none", "doi": None}


async def test_lookup_endpoint(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, logged_in: User
) -> None:
    calls = _use_crossref(app, settings, _ok(PREPRINT))
    for given in (
        "10.31234/osf.io/abcd",
        "doi:10.31234/osf.io/abcd",
        "https://doi.org/10.31234/osf.io/abcd",
    ):
        response = await client.post("/api/metadata/lookup", json={"doi": given})
        assert response.status_code == 200, response.text
        assert response.json()["csl"]["title"] == "A preprint about things"
    assert len(calls) == 3
    assert all(c.endswith("/works/10.31234/osf.io/abcd") for c in calls)

    assert_error(
        await client.post("/api/metadata/lookup", json={"doi": "nope"}),
        422,
        "metadata.invalid_doi",
    )
    _use_crossref(app, settings, lambda _: httpx.Response(404))
    assert_error(
        await client.post("/api/metadata/lookup", json={"doi": "10.1/x"}),
        422,
        "metadata.invalid_doi",
    )
    assert_error(
        await client.post("/api/metadata/lookup", json={"doi": "10.1000/x"}),
        404,
        "metadata.doi_not_found",
    )
    for handler in (
        lambda _: httpx.Response(503),
        lambda _: httpx.Response(200, json={"status": "ok"}),
        lambda _: httpx.Response(200, json=_message({"type": "journal-article"})),
    ):
        _use_crossref(app, settings, handler)
        assert_error(
            await client.post("/api/metadata/lookup", json={"doi": "10.1000/x"}),
            502,
            "metadata.lookup_failed",
        )

    async def slow(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200)

    _use_crossref(app, settings, slow, metadata_lookup_timeout_seconds=0.2)
    assert_error(
        await client.post("/api/metadata/lookup", json={"doi": "10.1000/x"}),
        502,
        "metadata.lookup_failed",
    )
    calls = _use_crossref(app, settings, _ok(JOURNAL), metadata_lookup_enabled=False)
    assert_error(
        await client.post("/api/metadata/lookup", json={"doi": "10.1000/x"}),
        503,
        "metadata.lookup_disabled",
    )
    assert calls == []


async def test_lookup_requires_login(client: httpx.AsyncClient) -> None:
    assert_error(
        await client.post("/api/metadata/lookup", json={"doi": "10.1000/x"}),
        401,
        "auth.not_authenticated",
    )


def test_payloads_are_json_serialisable() -> None:
    for payload in (JOURNAL, CHAPTER, PROCEEDINGS, PREPRINT, DISSERTATION):
        json.dumps(crossref.to_csl(payload))
