"""Attaching a PDF later, copying projects, automatic removal of unused tags, /api/config."""

import hashlib
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.config import Settings
from research_repo.main import create_app
from research_repo.models import File, Membership, ProjectRole, Tag, User
from research_repo.services.metadata import MetadataLookup
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD
from tests.helpers import (
    add_member,
    assert_error,
    client_for,
    create_folder,
    create_project,
    make_pdf,
    make_text_pdf,
    upload,
)
from tests.test_metadata import JOURNAL, _message


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


def _blobs(storage: Path) -> list[Path]:
    return sorted(p for p in storage.rglob("*.pdf") if ".tmp" not in p.parts)


async def _attach(
    client: httpx.AsyncClient, source_id: str, content: bytes | None, **fields: str
) -> httpx.Response:
    parts: list[tuple[str, tuple[str | None, bytes | str, str | None]]] = [
        (name, (None, value, None)) for name, value in fields.items()
    ]
    if content is not None:
        parts.append(("file", ("paper.pdf", content, "application/pdf")))
    if not parts:
        parts.append(("allow_duplicate", (None, "false", None)))
    return await client.put(f"/api/sources/{source_id}/file", files=parts)


# --- attach --------------------------------------------------------------------------------


async def test_attach(client: httpx.AsyncClient, pid: str, settings: Settings) -> None:
    source = (await upload(client, pid, title="A book")).json()
    pdf = make_pdf(pages=3)
    response = await _attach(client, source["id"], pdf)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_file"] is True
    assert body["file"]["page_count"] == 3
    assert body["title"] == "A book"
    assert (await client.get(f"/api/sources/{source['id']}/file")).content == pdf
    assert len(_blobs(settings.storage_dir)) == 1

    assert_error(
        await _attach(client, source["id"], make_pdf(marker="x")), 409, "source.already_has_file"
    )
    assert len(_blobs(settings.storage_dir)) == 1

    other = (await upload(client, pid, title="Other")).json()
    error = assert_error(await _attach(client, other["id"], pdf), 409, "source.duplicate_file")
    assert error["details"] == {"existing_source_id": source["id"]}
    allowed = await _attach(client, other["id"], pdf, allow_duplicate="true")
    assert allowed.status_code == 200
    assert len(_blobs(settings.storage_dir)) == 1

    third = (await upload(client, pid, title="Third")).json()
    assert_error(await _attach(client, third["id"], b"not a pdf"), 422, "source.invalid_pdf")
    assert_error(await _attach(client, third["id"], None), 422, "validation.invalid")
    bad_field = await client.put(
        f"/api/sources/{third['id']}/file",
        files=[("title", (None, "x", None)), ("file", ("a.pdf", pdf, "application/pdf"))],
    )
    assert_error(bad_field, 422, "validation.invalid")
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(await _attach(client, missing, pdf), 404, "source.not_found")


async def test_attach_too_large(settings: Settings, owner: User) -> None:
    app = create_app(settings.model_copy(update={"max_upload_mb": 1}))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            await c.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
            pid = (await create_project(c))["id"]
            source = (await upload(c, pid, title="x")).json()
            big = make_pdf() + b"%" * (1024 * 1024)
            assert_error(await _attach(c, source["id"], big), 413, "source.file_too_large")


async def test_attach_suggests_only_for_pending(
    app: FastAPI, settings: Settings, client: httpx.AsyncClient, pid: str
) -> None:
    app.state.metadata_lookup = MetadataLookup(
        settings,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=_message(JOURNAL))),
    )
    pdf = make_text_pdf([["doi:10.1037/abc0000123"]])
    pending = (await upload(client, pid, title="Pending")).json()
    body = (await _attach(client, pending["id"], pdf)).json()
    assert body["metadata_status"] == "suggested"
    assert body["citation_key"] == "garcia2021"

    confirmed = (await upload(client, pid, title="Mine")).json()
    await client.patch(f"/api/sources/{confirmed['id']}", json={"metadata_status": "confirmed"})
    body = (await _attach(client, confirmed["id"], pdf, allow_duplicate="true")).json()
    assert (body["metadata_status"], body["title"]) == ("confirmed", "Mine")


async def test_attach_roles(
    app: FastAPI, client: httpx.AsyncClient, pid: str, db: AsyncSession
) -> None:
    source = (await upload(client, pid, title="x")).json()
    viewer = await add_member(db, pid, ProjectRole.viewer)
    async with client_for(app, viewer.email) as v:
        assert_error(await _attach(v, source["id"], make_pdf()), 403, "auth.forbidden")


# --- copy ----------------------------------------------------------------------------------


async def test_copy_project(
    app: FastAPI, client: httpx.AsyncClient, pid: str, db: AsyncSession, settings: Settings
) -> None:
    await client.put(f"/api/projects/{pid}/readme", json={"readme_md": "# Thesis"})
    await client.patch(f"/api/projects/{pid}", json={"description": "D", "citation_locale": "es"})
    a = await create_folder(client, pid, "A")
    b = await create_folder(client, pid, "B", parent_id=a["id"])
    await create_folder(client, pid, "C")
    pdf = make_pdf(marker="shared")
    with_file = (await upload(client, pid, pdf, folder_id=b["id"], title="Paper")).json()
    citation_only = (await upload(client, pid, title="Book")).json()
    await client.patch(
        f"/api/sources/{with_file['id']}",
        json={"tags": ["x", "Y"], "last_page_read": 7, "citation_key": "manual-key"},
    )
    await client.patch(
        f"/api/sources/{citation_only['id']}",
        json={"tags": ["x"], "metadata_status": "confirmed"},
    )
    editor = await add_member(db, pid, ProjectRole.editor, "editor@example.org")
    await client.patch(f"/api/projects/{pid}", json={"archived": True})

    response = await client.post(f"/api/projects/{pid}/copy", json={"name": "Thesis v2"})
    assert response.status_code == 201, response.text
    copy = response.json()
    assert copy["id"] != pid
    assert (copy["name"], copy["slug"], copy["role"]) == ("Thesis v2", "thesis-v2", "owner")
    assert (copy["description"], copy["citation_locale"], copy["archived_at"]) == ("D", "es", None)
    assert copy["source_count"] == 2
    assert (await client.get(f"/api/projects/{copy['id']}/readme")).json()[
        "readme_md"
    ] == "# Thesis"

    tree = (await client.get(f"/api/projects/{copy['id']}/tree")).json()
    folders = {f["name"]: f for f in tree["folders"]}
    assert set(folders) == {"A", "B", "C"}
    assert folders["B"]["parent_id"] == folders["A"]["id"]
    assert folders["A"]["id"] != a["id"]
    assert [f["position"] for f in sorted(tree["folders"], key=lambda f: f["name"])] == [0, 0, 1]
    copied = {s["title"]: s for s in tree["sources"]}
    assert copied["Paper"]["folder_id"] == folders["B"]["id"]
    paper = (await client.get(f"/api/sources/{copied['Paper']['id']}")).json()
    assert paper["tags"] == ["x", "Y"]
    assert (paper["citation_key"], paper["citation_key_auto"]) == ("manual-key", False)
    assert paper["last_page_read"] == 1
    assert paper["csl"] == with_file["csl"]
    assert (await client.get(f"/api/sources/{paper['id']}/file")).content == pdf
    book = (await client.get(f"/api/sources/{copied['Book']['id']}")).json()
    assert (book["metadata_status"], book["tags"]) == ("confirmed", ["x"])

    # Only the caller is a member; the files are shared, not copied.
    members = (
        await db.scalars(select(Membership.user_id).where(Membership.project_id == copy["id"]))
    ).all()
    owner_id = await db.scalar(select(User.id).where(User.email == OWNER_EMAIL))
    assert members == [owner_id]
    assert editor.id not in members
    assert await db.scalar(select(func.count()).select_from(File)) == 1
    assert len(_blobs(settings.storage_dir)) == 1
    # The copy is editable while the original stays archived.
    assert (
        await client.patch(f"/api/sources/{paper['id']}", json={"title": "New"})
    ).status_code == 200

    # Deleting the copy keeps the blob the original still uses.
    assert (await client.delete(f"/api/projects/{copy['id']}")).status_code == 204
    assert len(_blobs(settings.storage_dir)) == 1
    assert (await client.get(f"/api/sources/{with_file['id']}/file")).content == pdf
    sha = hashlib.sha256(pdf).hexdigest()
    assert await db.scalar(select(func.count()).select_from(File).where(File.sha256 == sha)) == 1


async def test_copy_roles(
    app: FastAPI, client: httpx.AsyncClient, pid: str, db: AsyncSession
) -> None:
    viewer = await add_member(db, pid, ProjectRole.viewer, "viewer@example.org")
    editor = await add_member(db, pid, ProjectRole.editor, "editor@example.org")
    async with client_for(app, viewer.email) as v:
        assert_error(
            await v.post(f"/api/projects/{pid}/copy", json={"name": "x"}), 403, "auth.forbidden"
        )
    async with client_for(app, editor.email) as e:
        response = await e.post(f"/api/projects/{pid}/copy", json={"name": "Mine"})
        assert response.status_code == 201
        assert response.json()["role"] == "owner"
    assert_error(
        await client.post(f"/api/projects/{pid}/copy", json={"name": " "}),
        422,
        "validation.invalid",
    )
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(
        await client.post(f"/api/projects/{missing}/copy", json={"name": "x"}),
        404,
        "project.not_found",
    )


# --- tags and config -----------------------------------------------------------------------


async def test_unused_tags_are_deleted(
    client: httpx.AsyncClient, pid: str, db: AsyncSession
) -> None:
    a = (await upload(client, pid, title="A")).json()
    b = (await upload(client, pid, title="B")).json()
    await client.patch(f"/api/sources/{a['id']}", json={"tags": ["shared", "only-a"]})
    await client.patch(f"/api/sources/{b['id']}", json={"tags": ["shared"]})

    async def names() -> list[str]:
        return sorted((await db.scalars(select(Tag.name))).all())

    assert await names() == ["only-a", "shared"]
    await client.delete(f"/api/sources/{a['id']}")
    assert await names() == ["shared"]
    await client.patch(f"/api/sources/{b['id']}", json={"tags": []})
    assert await names() == []


async def test_config(client: httpx.AsyncClient, logged_in: User) -> None:
    assert (await client.get("/api/config")).json() == {
        "max_upload_mb": 200,
        "metadata_lookup_enabled": True,
    }


async def test_config_requires_login(client: httpx.AsyncClient) -> None:
    assert_error(await client.get("/api/config"), 401, "auth.not_authenticated")
