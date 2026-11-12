"""CSL validation and derivation, title/CSL sync, automatic and manual citation keys."""

from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.citations.csl import (
    InvalidCsl,
    authors_text,
    derive,
    normalize_doi,
    validate_csl,
)
from research_repo.citations.keys import first_free_key, key_base
from research_repo.models import ProjectRole, User
from tests.helpers import add_member, assert_error, client_for, create_project, upload

ARTICLE = {
    "type": "article-journal",
    "title": "The effect of things",
    "author": [{"family": "García", "given": "María"}, {"family": "Smith", "given": "John"}],
    "issued": {"date-parts": [[2021, 5]]},
    "DOI": "https://doi.org/10.1234/ABC",
    "container-title": "Journal",
    "custom-field": {"kept": True},
}


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


async def _source(client: httpx.AsyncClient, pid: str, title: str = "Untitled work") -> Any:
    return (await upload(client, pid, title=title)).json()


async def _patch(client: httpx.AsyncClient, source: dict[str, Any], **body: Any) -> Any:
    response = await client.patch(f"/api/sources/{source['id']}", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# --- pure functions ------------------------------------------------------------------------


def test_validate_normalises_and_keeps_unknown_keys() -> None:
    item = validate_csl({**ARTICLE, "id": "client-id", "title": "  The   effect of things "})
    assert "id" not in item
    assert item["title"] == "The effect of things"
    assert item["custom-field"] == {"kept": True}
    assert validate_csl({"type": "book", "title": "x", "issued": {"date-parts": [["2020", "3"]]}})[
        "issued"
    ] == {"date-parts": [[2020, 3]]}
    for issued in ({"raw": "2020-03"}, {"literal": "Spring 2020"}):
        assert validate_csl({"type": "book", "title": "x", "issued": issued})["issued"] == issued
    validate_csl({"type": "book", "title": "x", "author": [{"literal": "WHO"}]})


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        "x",
        {"title": "No type"},
        {"type": "journal-article", "title": "Crossref type, not CSL"},
        {"type": "book"},
        {"type": "book", "title": "   "},
        {"type": "book", "title": 5},
        {"type": "book", "title": "x", "author": {"family": "A"}},
        {"type": "book", "title": "x", "author": [{"given": "Only given"}]},
        {"type": "book", "title": "x", "author": [{"family": 3}]},
        {"type": "book", "title": "x", "author": ["A. Name"]},
        {"type": "book", "title": "x", "issued": {"date-parts": [[2020, 13, 1, 4]]}},
        {"type": "book", "title": "x", "issued": {"date-parts": [[2020, 40]]}},
        {"type": "book", "title": "x", "issued": {"date-parts": [["twenty"]]}},
        {"type": "book", "title": "x", "issued": {}},
        {"type": "book", "title": "x", "issued": "2020"},
        {"type": "book", "title": "x", "DOI": 10},
        {"type": "book", "title": "x", "note": "y" * 70_000},
    ],
)
def test_validate_rejects(value: object) -> None:
    with pytest.raises(InvalidCsl):
        validate_csl(value)


def test_derive() -> None:
    derived = derive(validate_csl(ARTICLE))
    assert derived.title == "The effect of things"
    assert derived.authors_text == "García & Smith"
    assert derived.year == 2021
    assert derived.doi == "10.1234/ABC"
    assert authors_text({"author": [{"family": "Lee"}]}) == "Lee"
    assert authors_text({"author": [{"family": f"A{i}"} for i in range(3)]}) == "A0 et al."
    assert authors_text({"author": [{"literal": "World Health Organization"}]}) == (
        "World Health Organization"
    )
    assert authors_text({"editor": [{"family": "Gogh", "non-dropping-particle": "van"}]}) == (
        "van Gogh"
    )
    assert authors_text({}) == ""
    assert derive({"type": "book", "title": "x", "issued": {"raw": "c. 1999"}}).year == 1999


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("10.1000/xyz123", "10.1000/xyz123"),
        ("doi:10.1000/xyz123", "10.1000/xyz123"),
        ("DOI: 10.1000/xyz123", "10.1000/xyz123"),
        ("https://doi.org/10.1000/xyz123", "10.1000/xyz123"),
        ("http://dx.doi.org/10.1000/xyz123", "10.1000/xyz123"),
        ("  10.1000/a(b)c  ", "10.1000/a(b)c"),
        ("10.10/too-short-prefix", None),
        ("not a doi", None),
        ("https://example.org/10.1000/x", None),
    ],
)
def test_normalize_doi(value: str, expected: str | None) -> None:
    assert normalize_doi(value) == expected


def test_key_base() -> None:
    assert key_base(validate_csl(ARTICLE)) == "garcia2021"
    assert key_base({"title": "x", "author": [{"family": "O'Brien-Núñez"}]}) == "obriennuneznd"
    assert key_base({"title": "x", "author": [{"literal": "The World Bank"}]}) == "worldnd"
    assert key_base({"title": "The art of science", "issued": {"date-parts": [[1999]]}}) == (
        "art1999"
    )
    assert key_base({"title": "¿¿??"}) == "sourcend"
    van = {"title": "x", "author": [{"family": "Gogh", "non-dropping-particle": "van"}]}
    assert key_base(van) == "vangoghnd"
    assert first_free_key("lee2020", set()) == "lee2020"
    assert first_free_key("lee2020", {"lee2020", "lee2020a"}) == "lee2020b"
    taken = {"k"} | {"k" + chr(c) for c in range(ord("a"), ord("z") + 1)}
    assert first_free_key("k", taken) == "kaa"


# --- through the API -----------------------------------------------------------------------


async def test_patch_csl_derives_fields_and_key(client: httpx.AsyncClient, pid: str) -> None:
    source = await _source(client, pid)
    assert source["citation_key"] == "untitlednd"
    body = await _patch(client, source, csl=ARTICLE)
    assert body["title"] == "The effect of things"
    assert body["authors_text"] == "García & Smith"
    assert body["year"] == 2021
    assert body["doi"] == "10.1234/ABC"
    assert body["citation_key"] == "garcia2021"
    assert body["citation_key_auto"] is True
    assert body["csl"]["custom-field"] == {"kept": True}
    assert "id" not in body["csl"]
    assert body["metadata_status"] == "pending"  # editing does not confirm

    summary = (await client.get(f"/api/projects/{pid}/tree")).json()["sources"][0]
    assert (summary["title"], summary["authors_text"], summary["year"]) == (
        "The effect of things",
        "García & Smith",
        2021,
    )

    confirmed = await _patch(client, source, metadata_status="confirmed")
    assert confirmed["metadata_status"] == "confirmed"


async def test_invalid_csl(client: httpx.AsyncClient, pid: str) -> None:
    source = await _source(client, pid)
    url = f"/api/sources/{source['id']}"
    for bad in (None, "x", [], {"type": "nope", "title": "x"}, {"type": "book", "title": ""}):
        error = assert_error(
            await client.patch(url, json={"csl": bad}), 422, "metadata.invalid_csl"
        )
        assert error["details"]["reason"]
    assert (await client.get(url)).json()["csl"] == {"type": "document", "title": "Untitled work"}


async def test_title_and_csl_never_diverge(client: httpx.AsyncClient, pid: str) -> None:
    source = await _source(client, pid)
    await _patch(client, source, csl=ARTICLE)
    body = await _patch(client, source, title="  A new   title ")
    assert body["title"] == body["csl"]["title"] == "A new title"
    assert body["csl"]["author"] == ARTICLE["author"]  # the rest of the item is kept
    assert body["citation_key"] == "garcia2021"
    # Both at once: the title wins.
    both = await _patch(client, source, csl={**ARTICLE, "title": "From csl"}, title="From title")
    assert both["title"] == both["csl"]["title"] == "From title"


async def test_key_collisions_and_stability(client: httpx.AsyncClient, pid: str) -> None:
    a, b, c = [await _source(client, pid, f"S{i}") for i in range(3)]
    assert (await _patch(client, a, csl=ARTICLE))["citation_key"] == "garcia2021"
    assert (await _patch(client, b, csl=ARTICLE))["citation_key"] == "garcia2021a"
    assert (await _patch(client, c, csl=ARTICLE))["citation_key"] == "garcia2021b"
    # Editing b again keeps its key; other sources never change as a side effect.
    assert (await _patch(client, b, csl={**ARTICLE, "title": "Other"}))["citation_key"] == (
        "garcia2021a"
    )
    other_year = {**ARTICLE, "issued": {"date-parts": [[2022]]}}
    assert (await _patch(client, a, csl=other_year))["citation_key"] == "garcia2022"
    keys = {
        s["id"]: s["citation_key"]
        for s in (await client.get(f"/api/projects/{pid}/tree")).json()["sources"]
    }
    assert keys == {a["id"]: "garcia2022", b["id"]: "garcia2021a", c["id"]: "garcia2021b"}
    # A new source with the same metadata takes the free base key.
    d = await _source(client, pid, "S3")
    assert (await _patch(client, d, csl=ARTICLE))["citation_key"] == "garcia2021"


async def test_manual_key(client: httpx.AsyncClient, pid: str) -> None:
    a, b = await _source(client, pid, "A"), await _source(client, pid, "B")
    await _patch(client, a, csl=ARTICLE)
    manual = await _patch(client, b, citation_key="my-key_1")
    assert (manual["citation_key"], manual["citation_key_auto"]) == ("my-key_1", False)
    # A manual key no longer follows the metadata.
    assert (await _patch(client, b, csl=ARTICLE))["citation_key"] == "my-key_1"
    # Setting its own key again is fine; taking another source's key is a conflict.
    assert (await _patch(client, b, citation_key="my-key_1"))["citation_key"] == "my-key_1"
    assert_error(
        await client.patch(f"/api/sources/{b['id']}", json={"citation_key": "garcia2021"}),
        409,
        "source.citation_key_conflict",
    )
    for bad in ("", "UPPER", "with space", "ünïcode", "x" * 65, "a/b"):
        assert_error(
            await client.patch(f"/api/sources/{b['id']}", json={"citation_key": bad}),
            422,
            "validation.invalid",
        )
    # Back to automatic: regenerated from the metadata, colliding with a's key.
    reset = await _patch(client, b, citation_key=None)
    assert (reset["citation_key"], reset["citation_key_auto"]) == ("garcia2021a", True)
    assert (await client.get(f"/api/sources/{a['id']}")).json()["citation_key"] == "garcia2021"


async def test_viewer_cannot_edit_metadata(
    app: FastAPI, client: httpx.AsyncClient, pid: str, db: AsyncSession
) -> None:
    source = await _source(client, pid)
    viewer = await add_member(db, pid, ProjectRole.viewer)
    async with client_for(app, viewer.email) as v:
        url = f"/api/sources/{source['id']}"
        for body in ({"csl": ARTICLE}, {"citation_key": "x"}, {"metadata_status": "confirmed"}):
            assert_error(await v.patch(url, json=body), 403, "auth.forbidden")
