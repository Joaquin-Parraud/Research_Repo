"""PDFs as they come from real readers' downloads: every one is stored, and as much metadata as
possible is read from it, without the upload ever failing or hanging because of the file.

Regression tests for "some PDFs are not processed". The PDFs are built here (pypdf and the
text-PDF helper); Crossref is never contacted.
"""

import asyncio
import io
import time
import tomllib
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from pypdf import PageObject, PdfWriter

from research_repo.citations import pdfmeta
from research_repo.citations.pdfmeta import inspect_pdf
from research_repo.core.config import Settings
from research_repo.core.pdf import header_offset
from research_repo.models import User
from research_repo.services import sources
from research_repo.services.files import pdf_page_count
from research_repo.services.metadata import MetadataLookup
from tests.helpers import create_project, make_text_pdf, upload

TITLE = "Financial risk in emerging markets"
INFO = {"Title": TITLE, "Author": "García, María; Smith, John"}
PAPER = make_text_pdf([["A paper", "doi:10.5555/paper.1"], ["Page two"]], info=INFO)

XMP_TEMPLATE = (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    ' xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/">'
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>'
    "<dc:creator><rdf:Seq><rdf:li>Ann Lee</rdf:li><rdf:li>Bo Li</rdf:li></rdf:Seq></dc:creator>"
    "{doi}"
    "</rdf:Description></rdf:RDF></x:xmpmeta>"
    '<?xpacket end="w"?>'
)


def _xmp(title: str = "Deep learning for graph data", doi: str = "") -> str:
    return XMP_TEMPLATE.format(title=title, doi=f"<prism:doi>{doi}</prism:doi>" if doi else "")


def _encrypted(content: bytes, algorithm: str, user_password: str = "") -> bytes:
    """Owner-password protection as publishers apply it: anyone may open the file."""
    writer = PdfWriter(clone_from=io.BytesIO(content))
    writer.encrypt(user_password=user_password, owner_password="publisher", algorithm=algorithm)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture(autouse=True)
def _embedded_metadata_only(app: FastAPI, settings: Settings) -> None:
    """These files carry DOIs; the suggestion comes from what the PDF says (no Crossref)."""
    app.state.metadata_lookup = MetadataLookup(
        settings.model_copy(update={"metadata_lookup_enabled": False})
    )


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


# --- the header --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "prefix",
    [b"\xef\xbb\xbf", b"\r\n", b"  \n", b"\x00" * 16, b"\xef\xbb\xbf\n\n"],
    ids=["utf8-bom", "crlf", "spaces", "nul-padding", "bom-and-newlines"],
)
async def test_pdf_with_bytes_before_the_header_is_accepted(
    client: httpx.AsyncClient, pid: str, prefix: bytes
) -> None:
    """Readers (Acrobat, pdf.js, pypdf) look for %PDF- in the first 1024 bytes."""
    response = await upload(client, pid, prefix + PAPER)
    assert response.status_code == 201, response.text
    source = response.json()
    assert source["file"]["page_count"] == 2
    assert source["metadata_status"] == "suggested"
    assert source["title"] == TITLE


def test_header_offset() -> None:
    assert header_offset(b"%PDF-1.7\n") == 0
    assert header_offset(b"\xef\xbb\xbf%PDF-1.4") == 3
    assert header_offset(b" " * 1000 + b"%PDF-1.4") == 1000
    assert header_offset(b" " * 1020 + b"%PDF-1.4") is None  # beyond the first 1024 bytes
    assert header_offset(b"<html>%PDF-1.7</html>") is None
    assert header_offset(b"hello %PDF-1.7") is None
    assert header_offset(b"") is None


@pytest.mark.parametrize("content_type", ["application/octet-stream", "application/x-pdf", ""])
async def test_declared_content_type_does_not_matter(
    client: httpx.AsyncClient, pid: str, content_type: str
) -> None:
    """Browsers on some systems label PDFs application/octet-stream or application/x-pdf."""
    files = [("file", ("paper.pdf", PAPER, content_type or None))]
    response = await client.post(f"/api/projects/{pid}/sources", files=files)
    assert response.status_code == 201, response.text
    assert response.json()["file"]["page_count"] == 2


# --- the end of the file ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "suffix",
    [b"\x00" * 4096, b"\n" * 2000, b"<html><body>" + b"x" * 3000 + b"</body></html>"],
    ids=["nul-padding", "newlines", "html-appended"],
)
async def test_pdf_with_data_after_the_end_marker_is_read(
    client: httpx.AsyncClient, pid: str, suffix: bytes
) -> None:
    """Downloads padded to a block size, or with a proxy's page appended after %%EOF."""
    response = await upload(client, pid, PAPER + suffix)
    assert response.status_code == 201, response.text
    source = response.json()
    assert source["file"]["page_count"] == 2
    assert (source["metadata_status"], source["title"]) == ("suggested", TITLE)
    assert source["doi"] == "10.5555/paper.1"


def test_file_without_any_end_marker_is_skipped_cheaply(tmp_path: Path) -> None:
    path = tmp_path / "truncated.pdf"
    path.write_bytes(PAPER[: PAPER.index(b"%%EOF")])
    assert pdf_page_count(path) is None
    assert inspect_pdf(path) == pdfmeta.PdfFacts()


# --- encryption --------------------------------------------------------------------------------


@pytest.mark.parametrize("algorithm", ["RC4-128", "AES-128", "AES-256"])
async def test_owner_password_only_pdf_is_read(
    client: httpx.AsyncClient, pid: str, algorithm: str
) -> None:
    """Publishers restrict printing or copying with an owner password; the file opens for
    everyone (empty user password), so its pages and metadata are readable."""
    response = await upload(client, pid, _encrypted(PAPER, algorithm))
    assert response.status_code == 201, response.text
    source = response.json()
    assert source["file"]["page_count"] == 2
    assert (source["title"], source["doi"]) == (TITLE, "10.5555/paper.1")


async def test_pdf_with_a_real_password_is_stored_without_metadata(
    client: httpx.AsyncClient, pid: str
) -> None:
    response = await upload(client, pid, _encrypted(PAPER, "AES-256", user_password="secret"))
    assert response.status_code == 201, response.text
    source = response.json()
    assert source["file"]["page_count"] is None
    assert source["metadata_status"] == "pending"
    assert (await client.get(f"/api/sources/{source['id']}/file")).status_code == 200


def test_aes_support_is_a_declared_dependency() -> None:
    """pypdf needs `cryptography` for AES, the encryption of most publisher PDFs. Without the
    extra, the Docker image (which installs only the declared dependencies) raised pypdf's
    DependencyError for every AES-protected file."""
    pyproject = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    dependencies = pyproject["project"]["dependencies"]
    assert any(d.replace(" ", "").startswith("pypdf[crypto]") for d in dependencies)


# --- damaged content: fail soft, stage by stage ----------------------------------------------


def test_text_of_a_broken_page_does_not_hide_the_doi_on_the_next(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "x.pdf"
    path.write_bytes(make_text_pdf([["Broken page"], ["https://doi.org/10.5555/p2.9"]]))
    real = PageObject.extract_text

    def extract_text(self: PageObject, *args: object, **kwargs: object) -> str:
        if "Broken" in real(self):
            raise KeyError("/Font")  # what pypdf raises for some damaged resource dictionaries
        return real(self)

    monkeypatch.setattr(PageObject, "extract_text", extract_text)
    assert inspect_pdf(path).doi == "10.5555/p2.9"


def test_damaged_info_dictionary_does_not_hide_the_page_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "x.pdf"
    path.write_bytes(make_text_pdf([["doi:10.5555/text.1"]], xmp=_xmp()))

    def broken(_: object) -> None:
        raise ValueError("damaged /Info")

    monkeypatch.setattr("pypdf.PdfReader.metadata", property(broken))
    facts = inspect_pdf(path)
    assert facts.doi == "10.5555/text.1"
    assert facts.title == "Deep learning for graph data"  # from XMP


async def test_slow_page_count_does_not_hang_the_upload(
    client: httpx.AsyncClient, pid: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A pathological file can keep pypdf busy for minutes; the upload must still answer."""

    def slow(_: Path) -> int:
        time.sleep(3)
        return 99

    monkeypatch.setattr(sources, "pdf_page_count", slow)
    monkeypatch.setattr(sources, "PAGE_COUNT_TIMEOUT_SECONDS", 0.2)
    started = time.monotonic()
    response = await asyncio.wait_for(upload(client, pid, PAPER), timeout=10)
    assert response.status_code == 201, response.text
    assert response.json()["file"]["page_count"] is None
    assert time.monotonic() - started < 2.5


# --- XMP ---------------------------------------------------------------------------------------


def test_xmp_title_and_creators_when_the_info_dictionary_has_none(tmp_path: Path) -> None:
    """PDF 2.0 deprecates the info dictionary; many tools write only XMP."""
    path = tmp_path / "x.pdf"
    path.write_bytes(make_text_pdf([["no doi"]], xmp=_xmp()))
    facts = inspect_pdf(path)
    assert facts.title == "Deep learning for graph data"
    assert facts.authors == [{"family": "Lee", "given": "Ann"}, {"family": "Li", "given": "Bo"}]


def test_info_dictionary_wins_over_xmp(tmp_path: Path) -> None:
    path = tmp_path / "x.pdf"
    path.write_bytes(make_text_pdf([["no doi"]], info=INFO, xmp=_xmp()))
    facts = inspect_pdf(path)
    assert facts.title == TITLE
    assert facts.authors[0] == {"family": "García", "given": "María"}


def test_junk_xmp_title_is_ignored(tmp_path: Path) -> None:
    path = tmp_path / "x.pdf"
    path.write_bytes(make_text_pdf([["no doi"]], xmp=_xmp(title="Microsoft Word - draft.docx")))
    assert inspect_pdf(path).title is None


@pytest.mark.parametrize("encoding", ["utf-16-be", "utf-16-le", "utf-16"])
def test_xmp_packet_in_utf16(tmp_path: Path, encoding: str) -> None:
    """XMP packets may be UTF-16 (XMP part 1, 7.3.2)."""
    path = tmp_path / "x.pdf"
    packet = _xmp(title="Política pública en Ñuñoa", doi="10.5555/utf16.1").encode(encoding)
    path.write_bytes(make_text_pdf([["no doi"]], xmp=packet))
    facts = inspect_pdf(path)
    assert facts.doi == "10.5555/utf16.1"
    assert facts.title == "Política pública en Ñuñoa"
