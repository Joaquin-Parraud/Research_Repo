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
