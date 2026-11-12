"""Citation endpoint, bibliography export (scopes, order, formats) and the BibTeX writer.

Rendering uses the real citation service (``citeproc`` marker, see conftest).
"""

from typing import Any

import httpx
import pytest

from research_repo.citations.bibtex import entry_type, escape, to_bibtex
from research_repo.models import User
from tests.helpers import assert_error, create_folder, create_project, upload

pytestmark = pytest.mark.citeproc


def _article(family: str, year: int, title: str, **extra: Any) -> dict[str, Any]:
    return {
        "type": "article-journal",
        "title": title,
        "container-title": "Journal of Tests",
        "volume": "1",
        "page": "1-2",
        "issued": {"date-parts": [[year]]},
        "author": [{"family": family, "given": "Ann"}],
        **extra,
    }


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


async def _add(
    client: httpx.AsyncClient, pid: str, csl: dict[str, Any], folder_id: str | None = None
) -> dict[str, Any]:
    fields = {"title": csl["title"]}
    if folder_id:
        fields["folder_id"] = folder_id
    source = (await upload(client, pid, **fields)).json()
    response = await client.patch(f"/api/sources/{source['id']}", json={"csl": csl})
    assert response.status_code == 200, response.text
    return response.json()


async def _bib(client: httpx.AsyncClient, pid: str, **body: Any) -> dict[str, Any]:
    response = await client.post(f"/api/projects/{pid}/bibliography", json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def test_citation_endpoint(client: httpx.AsyncClient, pid: str) -> None:
    source = await _add(
        client,
        pid,
        {
            **_article("García", 2021, "Things <script>alert(1)</script> & more"),
            "author": [
                {"family": "García", "given": "María"},
                {"family": "Smith", "given": "John"},
            ],
        },
    )
    response = await client.get(f"/api/sources/{source['id']}/citation")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "style": "apa",
        "locale": "en-US",
        "reference_text": (
            "García, M., & Smith, J. (2021). Things <script>alert(1)</script> & more. "
            "Journal of Tests, 1, 1–2."
        ),
        "reference_html": (
            "García, M., &amp; Smith, J. (2021). Things &lt;script&gt;alert(1)&lt;/script&gt; "
            "&amp; more. <i>Journal of Tests</i>, <i>1</i>, 1–2."
        ),
        "in_text_parenthetical": "(García & Smith, 2021)",
        "in_text_narrative": "García and Smith (2021)",
    }
    # The project's citation locale switches the rendering.
    await client.patch(f"/api/projects/{pid}", json={"citation_locale": "es"})
    spanish = (await client.get(f"/api/sources/{source['id']}/citation")).json()
    assert spanish["locale"] == "es"
    assert spanish["in_text_narrative"] == "García y Smith (2021)"
    assert spanish["reference_text"].endswith("1, 1-2.")

    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(await client.get(f"/api/sources/{missing}/citation"), 404, "source.not_found")


async def test_citation_uses_project_wide_year_suffixes(
    client: httpx.AsyncClient, pid: str
) -> None:
    beta = await _add(client, pid, _article("Lee", 2020, "Beta"))
    await _add(client, pid, _article("Lee", 2020, "Alpha"))
    body = (await client.get(f"/api/sources/{beta['id']}/citation")).json()
    assert body["in_text_parenthetical"] == "(Lee, 2020b)"
    assert body["reference_text"].startswith("Lee, A. (2020b). Beta.")


async def test_only_allowed_markup_in_html(client: httpx.AsyncClient, pid: str) -> None:
    title = 'CO<sub>2</sub> and <i>Homo</i> <b>bold</b> <span style="x">s</span> <img src=x>'
    source = await _add(client, pid, _article("Kim", 2020, title))
    html = (await client.get(f"/api/sources/{source['id']}/citation")).json()["reference_html"]
    assert "CO<sub>2</sub>" in html
    assert "<i>Homo</i>" in html
    assert "<b>bold</b>" in html
    assert "&lt;span style=&quot;x&quot;&gt;" in html or '&lt;span style="x"&gt;' in html
    assert "<img" not in html
    assert "<span" not in html


async def test_scopes_and_order(client: httpx.AsyncClient, pid: str) -> None:
    theory = await create_folder(client, pid, "Theory")
    sub = await create_folder(client, pid, "Sub", parent_id=theory["id"])
    root = await _add(client, pid, _article("Zhou", 2019, "Root paper"))
    in_theory = await _add(client, pid, _article("Brown", 2018, "Theory paper"), theory["id"])
    in_sub = await _add(client, pid, _article("Adams", 2017, "Sub paper"), sub["id"])
    lee_b = await _add(client, pid, _article("Lee", 2020, "Beta"), theory["id"])
    lee_a = await _add(client, pid, _article("Lee", 2020, "Alpha"), theory["id"])

    whole = await _bib(client, pid, format="text")
    assert whole["format"] == "text"
    assert whole["count"] == 5
    lines = whole["content"].split("\n")
    assert [line.split(" (")[0] for line in lines] == [
        "Adams, A.",
        "Brown, A.",
        "Lee, A.",
        "Lee, A.",
        "Zhou, A.",
    ]
    assert lines[2].startswith("Lee, A. (2020a). Alpha.")
    assert lines[3].startswith("Lee, A. (2020b). Beta.")

    root_only = await _bib(client, pid, format="csl", folder_id=None, include_subfolders=False)
    assert [i["id"] for i in root_only["content"]] == [root["citation_key"]]
    whole_from_root = await _bib(client, pid, format="text", folder_id=None)
    assert whole_from_root["count"] == 5

    theory_tree = await _bib(client, pid, format="csl", folder_id=theory["id"])
    assert [i["id"] for i in theory_tree["content"]] == [
        in_sub["citation_key"],
        in_theory["citation_key"],
        lee_a["citation_key"],
        lee_b["citation_key"],
    ]
    theory_only = await _bib(
        client, pid, format="text", folder_id=theory["id"], include_subfolders=False
    )
    assert theory_only["count"] == 3

    # A selection: suffixes are computed within it, so a lone Lee 2020 has none.
    picked = await _bib(client, pid, format="text", source_ids=[lee_b["id"], root["id"]])
    assert picked["count"] == 2
    assert picked["content"].split("\n")[0].startswith("Lee, A. (2020). Beta.")

    html = await _bib(client, pid, format="html", source_ids=[in_sub["id"]])
    assert html["content"] == (
        "<p>Adams, A. (2017). Sub paper. <i>Journal of Tests</i>, <i>1</i>, 1–2.</p>"
    )


async def test_formats_and_errors(client: httpx.AsyncClient, pid: str) -> None:
    empty = await _bib(client, pid, format="bibtex")
    assert empty == {"format": "bibtex", "count": 0, "content": ""}
    assert (await _bib(client, pid, format="csl"))["content"] == []

    source = await _add(client, pid, _article("García", 2021, "Risk & return in 100% of cases"))
    bibtex = (await _bib(client, pid, format="bibtex"))["content"]
    assert bibtex.startswith("@article{garcia2021,\n")
    assert r"title = {Risk \& return in 100\% of cases}," in bibtex
    csl = (await _bib(client, pid, format="csl"))["content"]
    assert csl[0]["id"] == "garcia2021"
    assert csl[0]["title"] == source["csl"]["title"]

    url = f"/api/projects/{pid}/bibliography"
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(await client.post(url, json={"format": "ris"}), 422, "validation.invalid")
    assert_error(await client.post(url, json={}), 422, "validation.invalid")
    assert_error(
        await client.post(url, json={"format": "text", "source_ids": [missing]}),
        404,
        "source.not_found",
    )
    assert_error(
        await client.post(url, json={"format": "text", "folder_id": missing}),
        404,
        "folder.not_found",
    )
    assert_error(
        await client.post(
            url, json={"format": "text", "folder_id": None, "source_ids": [source["id"]]}
        ),
        422,
        "validation.invalid",
    )
    other = (await create_project(client, "Other"))["id"]
    assert_error(
        await client.post(
            f"/api/projects/{other}/bibliography",
            json={"format": "text", "source_ids": [source["id"]]},
        ),
        404,
        "source.not_found",
    )


# --- BibTeX writer -------------------------------------------------------------------------


def test_bibtex_escaping() -> None:
    assert escape(r"a & b % c $ d # e _ f { g } h ~ i ^ j \ k") == (
        r"a \& b \% c \$ d \# e \_ f \{ g \} h \textasciitilde{} i \textasciicircum{} j "
        r"\textbackslash{} k"
    )
    assert escape("multi\n  line") == "multi line"


def test_bibtex_entries() -> None:
    article = to_bibtex(
        {
            "type": "article-journal",
            "title": "The <i>Homo sapiens</i> effect in Chile and DNA",
            "container-title": "Journal of R&D",
            "author": [
                {"family": "García Márquez", "given": "Gabriel"},
                {"family": "Gogh", "non-dropping-particle": "van", "given": "Vincent"},
                {"family": "King", "given": "Martin Luther", "suffix": "Jr."},
                {"literal": "World Health Organization"},
            ],
            "volume": 12,
            "issue": "3",
            "page": "45–67",
            "issued": {"date-parts": [[2021, 5, 3]]},
            "DOI": "10.1234/a_b",
        },
        "garcia2021",
    )
    assert article == "\n".join(
        [
            "@article{garcia2021,",
            "  author = {García Márquez, Gabriel and van Gogh, Vincent and King, Jr., Martin Luther"
            " and {World Health Organization}},",
            r"  title = {The \textit{{Homo} sapiens} effect in {Chile} and {DNA}},",
            r"  journal = {Journal of R\&D},",
            "  volume = {12},",
            "  number = {3},",
            "  pages = {45--67},",
            "  year = {2021},",
            "  month = may,",
            r"  doi = {10.1234/a\_b},",
            "}",
        ]
    )
    chapter = to_bibtex(
        {
            "type": "chapter",
            "title": "A chapter",
            "container-title": "The book",
            "editor": [{"family": "Edwards", "given": "Eve"}],
            "publisher": "Routledge",
            "publisher-place": "London",
        },
        "k",
    )
    assert chapter.startswith("@incollection{k,")
    assert "  booktitle = {The book}," in chapter
    assert "  editor = {Edwards, Eve}," in chapter
    assert "  address = {London}," in chapter
    assert "year" not in chapter

    assert entry_type({"type": "thesis", "genre": "Doctoral dissertation"}) == "phdthesis"
    assert entry_type({"type": "thesis", "genre": "Tesis de magíster"}) == "mastersthesis"
    assert entry_type({"type": "paper-conference"}) == "inproceedings"
    assert entry_type({"type": "report"}) == "techreport"
    assert entry_type({"type": "webpage"}) == "misc"
    assert entry_type({"type": "article"}) == "misc"
    assert entry_type({"type": "chapter"}) == "inbook"

    report = to_bibtex(
        {
            "type": "report",
            "title": "Annual report",
            "genre": "Report",
            "number": "12",
            "publisher": "NIMH",
        },
        "r",
    )
    assert "  institution = {NIMH}," in report
    assert "  type = {Report}," in report
    thesis = to_bibtex(
        {"type": "thesis", "title": "T", "genre": "PhD thesis", "publisher": "UDD"}, "t"
    )
    assert thesis.startswith("@phdthesis{t,")
    assert "  school = {UDD}," in thesis
