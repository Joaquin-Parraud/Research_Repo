"""The citation service from the backend's side: disambiguation scope, title-only sources, and
what the API answers when the service is down, slow or failing."""

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from research_repo.citations.processor import CiteprocClient
from research_repo.models import User
from tests.helpers import assert_error, create_folder, create_project, upload


def _article(family: str, year: int, title: str, given: str = "Ann") -> dict[str, Any]:
    return {
        "type": "article-journal",
        "title": title,
        "container-title": "Journal of Tests",
        "volume": "1",
        "page": "1-2",
        "issued": {"date-parts": [[year]]},
        "author": [{"family": family, "given": given}],
    }


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


async def _add(
    client: httpx.AsyncClient, pid: str, csl: dict[str, Any] | None, **fields: str
) -> dict[str, Any]:
    fields.setdefault("title", csl["title"] if csl else "Untitled")
    response = await upload(client, pid, **fields)
    assert response.status_code == 201, response.text
    source = response.json()
    if csl is None:
        return source
    response = await client.patch(f"/api/sources/{source['id']}", json={"csl": csl})
    assert response.status_code == 200, response.text
    return response.json()


async def _citation(client: httpx.AsyncClient, source: dict[str, Any]) -> dict[str, Any]:
    response = await client.get(f"/api/sources/{source['id']}/citation")
    assert response.status_code == 200, response.text
    return response.json()


async def _text(client: httpx.AsyncClient, pid: str, **body: Any) -> list[str]:
    response = await client.post(f"/api/projects/{pid}/bibliography", json=body)
    assert response.status_code == 200, response.text
    return str(response.json()["content"]).split("\n")


# --- with the real service -----------------------------------------------------------------


@pytest.mark.citeproc
async def test_disambiguation_scope(client: httpx.AsyncClient, pid: str) -> None:
    a = await create_folder(client, pid, "A")
    b = await create_folder(client, pid, "B")
    alpha = await _add(client, pid, _article("Lee", 2020, "Alpha"), folder_id=a["id"])
    beta = await _add(client, pid, _article("Lee", 2020, "Beta"), folder_id=b["id"])
    await _add(client, pid, _article("Smith", 2018, "Anne's paper", given="Anne"))
    john = await _add(client, pid, _article("Smith", 2020, "John's paper", given="John"))

    # One source's citation: the whole project is the scope, across folders.
    body = await _citation(client, beta)
    assert body["in_text_parenthetical"] == "(Lee, 2020b)"
    assert body["in_text_narrative"] == "Lee (2020b)"
    assert body["reference_text"].startswith("Lee, A. (2020b). Beta.")
    assert (await _citation(client, alpha))["in_text_parenthetical"] == "(Lee, 2020a)"
    # Same family name, different first author: initials, also across years (APA 8.20).
    john_body = await _citation(client, john)
    assert john_body["in_text_parenthetical"] == "(J. Smith, 2020)"
    assert john_body["in_text_narrative"] == "J. Smith (2020)"

    # An export: only the exported sources are the scope.
    assert (await _text(client, pid, format="text", folder_id=b["id"]))[0].startswith(
        "Lee, A. (2020). Beta."
    )
    both = await _text(client, pid, format="text", source_ids=[beta["id"], alpha["id"]])
    assert [line[:15] for line in both] == ["Lee, A. (2020a)", "Lee, A. (2020b)"]

    # The scope follows the project: without Alpha, Beta has no suffix any more.
    assert (await client.delete(f"/api/sources/{alpha['id']}")).status_code == 204
    assert (await _citation(client, beta))["in_text_parenthetical"] == "(Lee, 2020)"


@pytest.mark.citeproc
async def test_title_only_source(client: httpx.AsyncClient, pid: str) -> None:
    source = await _add(client, pid, None, title="Only a title")
    assert source["csl"] == {"type": "document", "title": "Only a title"}
    assert await _citation(client, source) == {
        "style": "apa",
        "locale": "en-US",
        "reference_text": "Only a title. (n.d.).",
        "reference_html": "<i>Only a title</i>. (n.d.).",
        "in_text_parenthetical": "(Only a Title, n.d.)",
        "in_text_narrative": "Only a Title (n.d.)",
    }


@pytest.mark.citeproc
async def test_edited_book_chapter(client: httpx.AsyncClient, pid: str) -> None:
    source = await _add(
        client,
        pid,
        {
            "type": "chapter",
            "title": "Chapter title here",
            "container-title": "The edited book",
            "editor": [{"family": "Edwards", "given": "Eve"}, {"family": "Ford", "given": "Frank"}],
            "page": "15-30",
            "publisher": "Routledge",
            "issued": {"date-parts": [[2016]]},
            "author": [{"family": "Hall", "given": "Harry"}],
        },
    )
    assert (await _citation(client, source))["reference_text"] == (
        "Hall, H. (2016). Chapter title here. In E. Edwards & F. Ford (Eds.), The edited book "
        "(pp. 15–30). Routledge."
    )


# --- service down, slow or failing -----------------------------------------------------------


async def test_service_unreachable(client: httpx.AsyncClient, pid: str) -> None:
    # Not marked "citeproc": the configured address has nothing listening.
    first = await _add(client, pid, _article("Zhou", 2019, "Zeta"))
    await _add(client, pid, _article("Adams", 2017, "Alpha"))

    error = assert_error(
        await client.get(f"/api/sources/{first['id']}/citation"), 503, "citation.unavailable"
    )
    assert "details" not in error
    url = f"/api/projects/{pid}/bibliography"
    for format in ("text", "html"):
        assert_error(await client.post(url, json={"format": format}), 503, "citation.unavailable")

    # BibTeX and CSL-JSON do not need the processor (fallback order: author, year, title).
    csl = await client.post(url, json={"format": "csl"})
    assert csl.status_code == 200
    assert [item["title"] for item in csl.json()["content"]] == ["Alpha", "Zeta"]
    bibtex = await client.post(url, json={"format": "bibtex"})
    assert bibtex.status_code == 200
    assert bibtex.json()["content"].startswith("@article{adams2017,")

    # The app itself stays healthy.
    assert (await client.get("/api/health")).json() == {"status": "ok"}


def _serve(handler: Callable[[httpx.Request], httpx.Response]) -> CiteprocClient:
    return CiteprocClient("http://citeproc.test", timeout=1, transport=httpx.MockTransport(handler))


async def test_service_timeout(app: FastAPI, client: httpx.AsyncClient, pid: str) -> None:
    source = await _add(client, pid, _article("Lee", 2020, "Slow"))

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("no answer", request=request)

    app.state.citeproc = _serve(timeout)
    assert_error(
        await client.get(f"/api/sources/{source['id']}/citation"), 503, "citation.unavailable"
    )
    app.state.citeproc = _serve(lambda _: httpx.Response(503, text="starting"))
    assert_error(
        await client.get(f"/api/sources/{source['id']}/citation"), 503, "citation.unavailable"
    )


async def test_service_errors(app: FastAPI, client: httpx.AsyncClient, pid: str) -> None:
    source = await _add(client, pid, _article("Lee", 2020, "Broken"))
    key = source["citation_key"]
    url = f"/api/sources/{source['id']}/citation"

    def failed(request: httpx.Request) -> httpx.Response:
        error = {"code": "render_failed", "message": "cannot render", "ids": [key]}
        return httpx.Response(422, json={"error": error})

    app.state.citeproc = _serve(failed)
    error = assert_error(await client.get(url), 500, "citation.render_failed")
    assert error["details"] == {"citation_keys": [key]}
    bib = await client.post(f"/api/projects/{pid}/bibliography", json={"format": "text"})
    assert assert_error(bib, 500, "citation.render_failed")["details"] == {"citation_keys": [key]}

    for response in (
        httpx.Response(500, json={"error": {"code": "internal", "message": "boom"}}),
        httpx.Response(400, json={"error": {"code": "invalid_request", "message": "bad"}}),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"bibliography": [], "citations": []}),
    ):
        app.state.citeproc = _serve(lambda _, r=response: r)
        error = assert_error(await client.get(url), 500, "citation.render_failed")
        assert error["details"] == {"citation_keys": []}


async def test_excluded_items_do_not_fail_a_citation(
    app: FastAPI, client: httpx.AsyncClient, pid: str
) -> None:
    source = await _add(client, pid, _article("Lee", 2020, "Fine"))
    other = await _add(client, pid, _article("Kim", 2020, "Unrenderable"))
    sent: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(body)
        return httpx.Response(
            200,
            json={
                "bibliography": [{"id": source["citation_key"], "html": "<i>x</i>", "text": "x"}],
                "citations": [
                    {"id": source["citation_key"], "mode": "parenthetical", "text": "(Lee, 2020)"},
                    {"id": source["citation_key"], "mode": "narrative", "text": "Lee (2020)"},
                ],
                "excluded_ids": [other["citation_key"]],
            },
        )

    app.state.citeproc = _serve(answer)
    body = await _citation(client, source)
    assert body["in_text_parenthetical"] == "(Lee, 2020)"
    # The request carried the whole project as the scope, and asked only for this source.
    (request,) = sent
    assert request["locale"] == "en-US"
    assert sorted(item["id"] for item in request["items"]) == sorted(
        [source["citation_key"], other["citation_key"]]
    )
    assert request["bibliography"] == {"ids": [source["citation_key"]]}
    assert request["citations"] == [
        {"id": source["citation_key"], "mode": "parenthetical"},
        {"id": source["citation_key"], "mode": "narrative"},
    ]
