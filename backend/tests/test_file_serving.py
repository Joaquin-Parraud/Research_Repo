"""GET /api/sources/{id}/file: headers, Range requests, conditional requests and access."""

import hashlib
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.api.file_response import content_disposition, parse_range
from research_repo.models import ProjectRole, User
from tests.helpers import add_member, assert_error, client_for, create_project, make_pdf, upload

PDF = make_pdf(pages=3, marker="served")
SIZE = len(PDF)


@pytest.fixture
async def source(client: httpx.AsyncClient, logged_in: User) -> dict[str, Any]:
    pid = (await create_project(client))["id"]
    response = await upload(client, pid, PDF, filename='Réseau «neuronal» "v2".pdf')
    assert response.status_code == 201
    return response.json()


def _url(source: dict[str, Any]) -> str:
    return f"/api/sources/{source['id']}/file"


async def test_full_file(client: httpx.AsyncClient, source: dict[str, Any]) -> None:
    response = await client.get(_url(source))
    assert response.status_code == 200
    assert response.content == PDF
    h = response.headers
    assert h["content-type"] == "application/pdf"
    assert h["content-length"] == str(SIZE)
    assert h["accept-ranges"] == "bytes"
    assert h["etag"] == f'"{hashlib.sha256(PDF).hexdigest()}"'
    assert h["cache-control"] == "private"
    assert h["content-disposition"] == (
        'inline; filename="R_seau _neuronal_ _v2_.pdf"; '
        "filename*=UTF-8''R%C3%A9seau%20%C2%ABneuronal%C2%BB%20%22v2%22.pdf"
    )
    assert "content-range" not in h


async def test_first_bytes(client: httpx.AsyncClient, source: dict[str, Any]) -> None:
    response = await client.get(_url(source), headers={"Range": "bytes=0-99"})
    assert response.status_code == 206
    assert response.content == PDF[:100]
    assert response.headers["content-range"] == f"bytes 0-99/{SIZE}"
    assert response.headers["content-length"] == "100"
    assert response.headers["content-type"] == "application/pdf"


async def test_middle_range(client: httpx.AsyncClient, source: dict[str, Any]) -> None:
    response = await client.get(_url(source), headers={"Range": "bytes=100-199"})
    assert response.status_code == 206
    assert response.content == PDF[100:200]
    assert response.headers["content-range"] == f"bytes 100-199/{SIZE}"


async def test_open_ended_and_clamped(client: httpx.AsyncClient, source: dict[str, Any]) -> None:
    response = await client.get(_url(source), headers={"Range": "bytes=50-"})
    assert response.status_code == 206
    assert response.content == PDF[50:]
    assert response.headers["content-range"] == f"bytes 50-{SIZE - 1}/{SIZE}"
    clamped = await client.get(_url(source), headers={"Range": f"bytes=10-{SIZE * 2}"})
    assert clamped.status_code == 206
    assert clamped.content == PDF[10:]


async def test_suffix_range(client: httpx.AsyncClient, source: dict[str, Any]) -> None:
    response = await client.get(_url(source), headers={"Range": "bytes=-64"})
    assert response.status_code == 206
    assert response.content == PDF[-64:]
    assert response.headers["content-range"] == f"bytes {SIZE - 64}-{SIZE - 1}/{SIZE}"
    whole = await client.get(_url(source), headers={"Range": f"bytes=-{SIZE + 10}"})
    assert whole.status_code == 206
    assert whole.content == PDF


@pytest.mark.parametrize("header", [f"bytes={SIZE}-", f"bytes={SIZE + 5}-{SIZE + 10}", "bytes=-0"])
async def test_unsatisfiable_range(
    client: httpx.AsyncClient, source: dict[str, Any], header: str
) -> None:
    response = await client.get(_url(source), headers={"Range": header})
    assert_error(response, 416, "source.range_not_satisfiable")
    assert response.headers["content-range"] == f"bytes */{SIZE}"


@pytest.mark.parametrize("header", ["bytes=abc", "items=0-10", "bytes=0-10,20-30", "bytes=9-3"])
async def test_ignored_range_headers(
    client: httpx.AsyncClient, source: dict[str, Any], header: str
) -> None:
    response = await client.get(_url(source), headers={"Range": header})
    assert response.status_code == 200
    assert response.content == PDF


async def test_conditional_requests(client: httpx.AsyncClient, source: dict[str, Any]) -> None:
    etag = (await client.get(_url(source))).headers["etag"]
    not_modified = await client.get(_url(source), headers={"If-None-Match": etag})
    assert not_modified.status_code == 304
    assert not_modified.content == b""
    fresh = await client.get(_url(source), headers={"Range": "bytes=0-9", "If-Range": etag})
    assert fresh.status_code == 206
    stale = await client.get(_url(source), headers={"Range": "bytes=0-9", "If-Range": '"old"'})
    assert stale.status_code == 200
    assert stale.content == PDF


async def test_citation_only_has_no_file(client: httpx.AsyncClient, logged_in: User) -> None:
    pid = (await create_project(client))["id"]
    source = (await upload(client, pid, title="Book")).json()
    assert_error(await client.get(_url(source)), 404, "source.no_file")


async def test_access(
    app: FastAPI, client: httpx.AsyncClient, source: dict[str, Any], db: AsyncSession
) -> None:
    viewer = await add_member(db, source["project_id"], ProjectRole.viewer, "v@example.org")
    outsider = await add_member(
        db, (await create_project(client, "Elsewhere"))["id"], ProjectRole.owner, "o@example.org"
    )
    async with client_for(app, viewer.email) as v:
        response = await v.get(_url(source), headers={"Range": "bytes=0-4"})
        assert response.status_code == 206
        assert response.content == b"%PDF-"
    async with client_for(app, outsider.email) as o:
        assert_error(await o.get(_url(source)), 404, "source.not_found")

    await client.post("/api/auth/logout")
    assert_error(await client.get(_url(source)), 401, "auth.not_authenticated")


def test_parse_range_unit() -> None:
    assert parse_range(None, 10) is None
    assert parse_range("bytes=0-0", 10) == (0, 0)
    assert parse_range("bytes=9-", 10) == (9, 9)
    assert parse_range(" bytes=2-4 ", 10) == (2, 4)
    assert parse_range("bytes=-", 10) is None


def test_content_disposition_fallback() -> None:
    assert content_disposition("") == "inline; filename=\"document.pdf\"; filename*=UTF-8''"
    header = content_disposition("a\r\nb.pdf")
    assert "\r" not in header
    assert "\n" not in header
