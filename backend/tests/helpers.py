"""Shared helpers for the library (M1) tests."""

import io
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI
from pypdf import PdfWriter
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.security import hash_password
from research_repo.models import Membership, ProjectRole, User

MEMBER_PASSWORD = "another long password"


def make_pdf(pages: int = 1, marker: str = "") -> bytes:
    """A small valid PDF; ``marker`` changes the bytes (and so the hash)."""
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Title": marker or "test"})
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def make_encrypted_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt(user_password="secret", algorithm="RC4-128")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def assert_error(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code
    assert isinstance(error["message"], str)
    assert error["message"]
    return error


async def create_project(client: httpx.AsyncClient, name: str = "Thesis") -> dict[str, Any]:
    response = await client.post("/api/projects", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def create_folder(
    client: httpx.AsyncClient, project_id: str, name: str, parent_id: str | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"name": name}
    if parent_id is not None:
        body["parent_id"] = parent_id
    response = await client.post(f"/api/projects/{project_id}/folders", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def upload(
    client: httpx.AsyncClient,
    project_id: str,
    content: bytes | None = None,
    *,
    filename: str = "paper.pdf",
    **fields: str,
) -> httpx.Response:
    # (None, value) parts are plain form fields, so the body is multipart even without a file.
    parts: list[tuple[str, tuple[str | None, bytes | str, str | None]]] = [
        (name, (None, value, None)) for name, value in fields.items()
    ]
    if content is not None:
        parts.append(("file", (filename, content, "application/pdf")))
    if not parts:
        parts.append(("title", (None, "", None)))
    return await client.post(f"/api/projects/{project_id}/sources", files=parts)


async def add_member(
    db: AsyncSession, project_id: str, role: ProjectRole, email: str = "member@example.org"
) -> User:
    user = User(email=email, display_name="Member", password_hash=hash_password(MEMBER_PASSWORD))
    db.add(user)
    await db.flush()
    db.add(Membership(user_id=user.id, project_id=project_id, role=role))
    await db.commit()
    return user


@asynccontextmanager
async def client_for(app: FastAPI, email: str) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        response = await c.post(
            "/api/auth/login", json={"email": email, "password": MEMBER_PASSWORD}
        )
        assert response.status_code == 200, response.text
        yield c


def _pdf_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_text_pdf(
    pages: list[list[str]], info: dict[str, str] | None = None, xmp: str | None = None
) -> bytes:
    """A PDF with real text (Helvetica) on each page, an optional info dictionary and XMP."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages_id = len(objects) + 1 + 2 * len(pages) + (1 if xmp else 0) + 1
    page_ids = []
    for lines in pages:
        ops = ["BT", "/F1 10 Tf", "14 TL", "40 750 Td"]
        for line in lines:
            ops.append(f"({_pdf_string(line)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
                b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, font, content)
            )
        )
    metadata_ref = b""
    if xmp:
        data = xmp.encode()
        xmp_id = add(
            b"<< /Type /Metadata /Subtype /XML /Length %d >>\nstream\n" % len(data)
            + data
            + b"\nendstream"
        )
        metadata_ref = b" /Metadata %d 0 R" % xmp_id
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R%s >>" % (pages_id, metadata_ref))
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    assert add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))) == pages_id
    info_id = None
    if info:
        entries = " ".join(f"/{k} ({_pdf_string(v)})" for k, v in info.items())
        info_id = add(f"<< {entries} >>".encode("latin-1"))

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % number + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    trailer = b"<< /Size %d /Root %d 0 R" % (len(objects) + 1, catalog)
    if info_id:
        trailer += b" /Info %d 0 R" % info_id
    out.write(b"trailer\n" + trailer + b" >>\nstartxref\n%d\n%%%%EOF\n" % xref)
    return out.getvalue()
