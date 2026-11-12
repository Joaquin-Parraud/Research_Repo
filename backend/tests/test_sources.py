"""Sources: upload, citation-only, duplicates, shared blobs, edits, tags, moves, deletes."""

import hashlib
import os
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.config import Settings
from research_repo.core.storage import FileStorage, StagedFile
from research_repo.main import create_app
from research_repo.models import File, ProjectRole, Tag, User
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD
from tests.helpers import (
    add_member,
    assert_error,
    client_for,
    create_folder,
    create_project,
    make_encrypted_pdf,
    make_pdf,
    upload,
)

SOURCE_KEYS = {
    "id",
    "project_id",
    "folder_id",
    "title",
    "authors_text",
    "year",
    "citation_key",
    "citation_key_auto",
    "csl",
    "doi",
    "metadata_status",
    "text_status",
    "last_page_read",
    "has_file",
    "file",
    "tags",
    "created_at",
    "updated_at",
}


def _blobs(storage: Path) -> list[Path]:
    return sorted(p for p in storage.rglob("*.pdf") if ".tmp" not in p.parts)


def _temp_files(storage: Path) -> list[Path]:
    temp = storage / ".tmp"
    return list(temp.iterdir()) if temp.exists() else []


@pytest.fixture
def storage(settings: Settings) -> Path:
    return settings.storage_dir


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


async def test_upload(client: httpx.AsyncClient, pid: str, storage: Path) -> None:
    folder = await create_folder(client, pid, "Theory")
    pdf = make_pdf(pages=4)
    response = await upload(
        client, pid, pdf, filename="García et al 2021.PDF", folder_id=folder["id"]
    )
    assert response.status_code == 201, response.text
    source = response.json()
    assert set(source) == SOURCE_KEYS
    assert source["project_id"] == pid
    assert source["folder_id"] == folder["id"]
    assert source["title"] == "García et al 2021"
    # No author or year yet: first significant title word + "nd" (FR-S7).
    assert source["citation_key"] == "garciand"
    assert source["citation_key_auto"] is True
    assert source["csl"] == {"type": "document", "title": "García et al 2021"}
    assert source["has_file"] is True
    assert source["file"] == {
        "size_bytes": len(pdf),
        "page_count": 4,
        "original_filename": "García et al 2021.PDF",
    }
    assert source["metadata_status"] == "pending"
    assert source["text_status"] == "none"
    assert source["tags"] == []
    assert source["last_page_read"] is None
    assert source["doi"] is None

    sha = hashlib.sha256(pdf).hexdigest()
    blob = storage / sha[:2] / sha[2:4] / f"{sha}.pdf"
    assert blob.read_bytes() == pdf
    assert _blobs(storage) == [blob]
    assert _temp_files(storage) == []

    got = await client.get(f"/api/sources/{source['id']}")
    assert got.status_code == 200
    assert got.json() == source


async def test_title_and_key_rules(client: httpx.AsyncClient, pid: str) -> None:
    titled = (await upload(client, pid, make_pdf(marker="1"), title="  Given   title ")).json()
    assert titled["title"] == "Given title"
    assert titled["citation_key"] == "givennd"
    again = (await upload(client, pid, title="Given title")).json()
    assert again["citation_key"] == "givennda"
    third = (await upload(client, pid, title="GIVEN title!")).json()
    assert third["citation_key"] == "givenndb"
    long = (await upload(client, pid, title="A" * 300)).json()
    assert long["citation_key"] == "a" * 54 + "nd"
    long2 = (await upload(client, pid, title="A" * 300)).json()
    assert long2["citation_key"] == "a" * 54 + "nda"
    symbols = (await upload(client, pid, title="¿¿??")).json()
    assert symbols["citation_key"] == "sourcend"
    path = (await upload(client, pid, make_pdf(marker="2"), filename="dir/sub\\x.pdf")).json()
    assert path["title"] == "x"
    assert path["file"]["original_filename"] == "x.pdf"


async def test_citation_only(client: httpx.AsyncClient, pid: str) -> None:
    response = await upload(client, pid, title="A Book Without PDF")
    assert response.status_code == 201
    source = response.json()
    assert source["has_file"] is False
    assert source["file"] is None
    assert source["folder_id"] is None
    assert source["citation_key"] == "booknd"

    assert_error(await upload(client, pid), 422, "validation.invalid")
    assert_error(await upload(client, pid, title="   "), 422, "validation.invalid")
    # A browser form with no file chosen sends an empty, unnamed file part.
    empty_part = await upload(client, pid, b"", filename="", title="Still fine")
    assert empty_part.status_code == 201
    assert empty_part.json()["has_file"] is False


async def test_bad_forms(client: httpx.AsyncClient, pid: str) -> None:
    url = f"/api/projects/{pid}/sources"
    assert_error(await client.post(url, json={"title": "x"}), 422, "validation.invalid")
    assert_error(
        await client.post(url, files=[("unknown", (None, "x"))]), 422, "validation.invalid"
    )
    assert_error(
        await client.post(url, files=[("title", (None, "a")), ("title", (None, "b"))]),
        422,
        "validation.invalid",
    )
    assert_error(await upload(client, pid, title="x", folder_id="nope"), 422, "validation.invalid")
    assert_error(
        await client.post(
            url,
            content=b'--b\r\nContent-Disposition: form-data; name="title"\r\n\r\nunterminated',
            headers={"content-type": "multipart/form-data; boundary=b"},
        ),
        422,
        "validation.invalid",
    )


async def test_unknown_folder(client: httpx.AsyncClient, pid: str, storage: Path) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(await upload(client, pid, make_pdf(), folder_id=missing), 404, "folder.not_found")
    assert_error(await upload(client, pid, title="x", folder_id=missing), 404, "folder.not_found")
    assert _blobs(storage) == []
    assert _temp_files(storage) == []


@pytest.mark.parametrize(
    "content",
    [b"", b"hello world", b"<html>%PDF-1.7</html>", b"\x89PNG\r\n\x1a\n" + b"0" * 100],
)
async def test_invalid_pdf(
    client: httpx.AsyncClient, pid: str, storage: Path, db: AsyncSession, content: bytes
) -> None:
    response = await upload(client, pid, content, filename="fake.pdf")
    assert_error(response, 422, "source.invalid_pdf")
    assert _blobs(storage) == []
    assert _temp_files(storage) == []
    assert await db.scalar(select(func.count()).select_from(File)) == 0


async def test_unparseable_and_encrypted_pdfs_are_kept_without_page_count(
    client: httpx.AsyncClient, pid: str
) -> None:
    broken = await upload(client, pid, b"%PDF-1.4\nthis is not really a pdf", filename="b.pdf")
    assert broken.status_code == 201
    assert broken.json()["file"]["page_count"] is None
    encrypted = await upload(client, pid, make_encrypted_pdf(), filename="e.pdf")
    assert encrypted.status_code == 201
    assert encrypted.json()["file"]["page_count"] is None


async def test_too_large(settings: Settings, owner: User, tmp_path: Path) -> None:
    small = settings.model_copy(update={"max_upload_mb": 1})
    app = create_app(small)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            await c.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
            pid = (await create_project(c))["id"]
            exact = make_pdf()
            exact += b"%" * (1024 * 1024 - len(exact))
            assert (await upload(c, pid, exact)).status_code == 201

            big = exact + b"%"
            assert_error(await upload(c, pid, big), 413, "source.file_too_large")

            # A Content-Length far over the limit is refused before reading the body.
            huge = await c.post(
                f"/api/projects/{pid}/sources",
                content=b"x",
                headers={
                    "content-type": "multipart/form-data; boundary=b",
                    "content-length": str(10 * 1024 * 1024),
                },
            )
            assert_error(huge, 413, "source.file_too_large")
    assert len(_blobs(small.storage_dir)) == 1
    assert _temp_files(small.storage_dir) == []


async def test_duplicate_in_project(
    client: httpx.AsyncClient, pid: str, storage: Path, db: AsyncSession
) -> None:
    pdf = make_pdf()
    first = (await upload(client, pid, pdf)).json()
    response = await upload(client, pid, pdf, filename="again.pdf")
    error = assert_error(response, 409, "source.duplicate_file")
    assert error["details"] == {"existing_source_id": first["id"]}
    assert _temp_files(storage) == []

    allowed = await upload(client, pid, pdf, filename="again.pdf", allow_duplicate="true")
    assert allowed.status_code == 201
    second = allowed.json()
    assert second["id"] != first["id"]
    assert second["citation_key"] == "againnd"
    assert await db.scalar(select(func.count()).select_from(File)) == 1
    assert len(_blobs(storage)) == 1

    tree = (await client.get(f"/api/projects/{pid}/tree")).json()
    assert len(tree["sources"]) == 2


async def test_same_file_in_two_projects_shares_one_blob(
    client: httpx.AsyncClient, pid: str, storage: Path, db: AsyncSession
) -> None:
    other = (await create_project(client, "Other"))["id"]
    pdf = make_pdf(pages=2)
    a = (await upload(client, pid, pdf, filename="a.pdf")).json()
    b_response = await upload(client, other, pdf, filename="b.pdf")
    assert b_response.status_code == 201  # not a duplicate: different project
    b = b_response.json()
    assert a["id"] != b["id"]
    assert await db.scalar(select(func.count()).select_from(File)) == 1
    assert len(_blobs(storage)) == 1
    # The stored file keeps the name it was first uploaded with.
    assert b["file"]["original_filename"] == "a.pdf"
    assert b["title"] == "b"

    # Deleting one source keeps the blob the other still uses.
    assert (await client.delete(f"/api/sources/{a['id']}")).status_code == 204
    assert len(_blobs(storage)) == 1
    assert (await client.get(f"/api/sources/{b['id']}/file")).content == pdf
    # Deleting the last reference removes both the row and the blob.
    assert (await client.delete(f"/api/sources/{b['id']}")).status_code == 204
    assert _blobs(storage) == []
    assert await db.scalar(select(func.count()).select_from(File)) == 0


async def test_project_delete_keeps_blobs_used_elsewhere(
    client: httpx.AsyncClient, pid: str, storage: Path, db: AsyncSession
) -> None:
    other = (await create_project(client, "Other"))["id"]
    shared, private = make_pdf(marker="shared"), make_pdf(marker="private")
    await upload(client, pid, shared)
    await upload(client, pid, private)
    kept = (await upload(client, other, shared)).json()
    assert len(_blobs(storage)) == 2

    assert (await client.delete(f"/api/projects/{pid}")).status_code == 204
    assert len(_blobs(storage)) == 1
    assert await db.scalar(select(func.count()).select_from(File)) == 1
    assert (await client.get(f"/api/sources/{kept['id']}/file")).content == shared


async def test_patch(client: httpx.AsyncClient, pid: str) -> None:
    folder = await create_folder(client, pid, "F")
    source = (await upload(client, pid, make_pdf(), title="Old")).json()
    url = f"/api/sources/{source['id']}"

    response = await client.patch(url, json={"title": " New title ", "folder_id": folder["id"]})
    assert response.status_code == 200
    body = response.json()
    assert (body["title"], body["folder_id"]) == ("New title", folder["id"])
    # Automatic keys follow the metadata (here: the title, as there is no author).
    assert (source["citation_key"], body["citation_key"]) == ("oldnd", "newnd")
    assert body["csl"]["title"] == "New title"
    assert body["updated_at"] >= source["updated_at"]

    assert (await client.patch(url, json={"folder_id": None})).json()["folder_id"] is None
    assert (await client.patch(url, json={"last_page_read": 3})).json()["last_page_read"] == 3

    for bad in (
        {"last_page_read": 0},
        {"last_page_read": None},
        {"title": ""},
        {"title": None},
        {"tags": None},
        {"tags": [""]},
        {"tags": ["x" * 101]},
        {"citation_key": "Nope!"},
        {"citation_key": "x" * 65},
        {"metadata_status": "suggested"},
        {"metadata_status": "pending"},
        {"unknown": 1},
    ):
        assert_error(await client.patch(url, json=bad), 422, "validation.invalid")
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(await client.patch(url, json={"folder_id": missing}), 404, "folder.not_found")
    assert_error(
        await client.patch(f"/api/sources/{missing}", json={"title": "x"}),
        404,
        "source.not_found",
    )
    assert_error(await client.get(f"/api/sources/{missing}"), 404, "source.not_found")


async def test_tags(client: httpx.AsyncClient, pid: str, db: AsyncSession) -> None:
    a = (await upload(client, pid, title="A")).json()
    b = (await upload(client, pid, title="B")).json()
    other_project = (await create_project(client, "Other"))["id"]
    c = (await upload(client, other_project, title="C")).json()

    async def tag(source: dict[str, Any], tags: list[str]) -> list[str]:
        response = await client.patch(f"/api/sources/{source['id']}", json={"tags": tags})
        assert response.status_code == 200, response.text
        return response.json()["tags"]

    assert await tag(a, [" Methods ", "survey", "methods", "Chile"]) == [
        "Chile",
        "Methods",
        "survey",
    ]
    # Existing tags are reused with their stored spelling.
    assert await tag(b, ["METHODS", "new tag"]) == ["Methods", "new tag"]
    # Replacing the set.
    assert await tag(a, ["survey"]) == ["survey"]
    assert (await client.get(f"/api/sources/{a['id']}")).json()["tags"] == ["survey"]
    # Tags are per project.
    assert await tag(c, ["methods"]) == ["methods"]
    assert await tag(a, []) == []

    # Tags no source uses any more ("Chile", "survey") are deleted.
    names = (await db.scalars(select(Tag.name).order_by(Tag.name))).all()
    assert sorted(names) == sorted(["Methods", "new tag", "methods"])


async def test_bulk_move(client: httpx.AsyncClient, pid: str) -> None:
    folder = await create_folder(client, pid, "Target")
    sources = [(await upload(client, pid, title=f"S{i}")).json() for i in range(3)]
    ids = [s["id"] for s in sources]

    response = await client.post(
        "/api/sources/move", json={"source_ids": ids + ids[:1], "folder_id": folder["id"]}
    )
    assert response.status_code == 200
    assert response.json() == {"moved": 3}
    tree = (await client.get(f"/api/projects/{pid}/tree")).json()
    assert {s["folder_id"] for s in tree["sources"]} == {folder["id"]}

    back = await client.post("/api/sources/move", json={"source_ids": ids[:2], "folder_id": None})
    assert back.json() == {"moved": 2}
    tree = (await client.get(f"/api/projects/{pid}/tree")).json()
    assert sorted((s["title"], s["folder_id"]) for s in tree["sources"]) == [
        ("S0", None),
        ("S1", None),
        ("S2", folder["id"]),
    ]


async def test_bulk_move_is_all_or_nothing(client: httpx.AsyncClient, pid: str) -> None:
    other = (await create_project(client, "Other"))["id"]
    folder = await create_folder(client, pid, "Target")
    foreign_folder = await create_folder(client, other, "Foreign")
    mine = (await upload(client, pid, title="Mine")).json()
    theirs = (await upload(client, other, title="Theirs")).json()
    missing = "00000000-0000-0000-0000-000000000000"

    for body in (
        {"source_ids": [mine["id"], theirs["id"]], "folder_id": folder["id"]},
        {"source_ids": [mine["id"], missing], "folder_id": None},
        {"source_ids": [mine["id"]], "folder_id": foreign_folder["id"]},
        {"source_ids": [mine["id"]], "folder_id": missing},
    ):
        assert_error(await client.post("/api/sources/move", json=body), 422, "source.move_invalid")
    assert_error(
        await client.post("/api/sources/move", json={"source_ids": [], "folder_id": None}),
        422,
        "validation.invalid",
    )
    assert (await client.get(f"/api/sources/{mine['id']}")).json()["folder_id"] is None
    assert (await client.get(f"/api/sources/{theirs['id']}")).json()["folder_id"] is None


async def test_delete_citation_only(client: httpx.AsyncClient, pid: str) -> None:
    source = (await upload(client, pid, title="Book")).json()
    await client.patch(f"/api/sources/{source['id']}", json={"tags": ["t"]})
    assert (await client.delete(f"/api/sources/{source['id']}")).status_code == 204
    assert_error(await client.get(f"/api/sources/{source['id']}"), 404, "source.not_found")
    assert_error(await client.delete(f"/api/sources/{source['id']}"), 404, "source.not_found")


async def test_roles(app: FastAPI, client: httpx.AsyncClient, pid: str, db: AsyncSession) -> None:
    folder = await create_folder(client, pid, "F")
    source = (await upload(client, pid, make_pdf(), title="Paper")).json()
    url = f"/api/sources/{source['id']}"
    viewer = await add_member(db, pid, ProjectRole.viewer, "viewer@example.org")
    editor = await add_member(db, pid, ProjectRole.editor, "editor@example.org")
    outsider = await add_member(
        db, (await create_project(client, "Elsewhere"))["id"], ProjectRole.owner, "o@example.org"
    )

    async with client_for(app, viewer.email) as v:
        assert (await v.get(url)).status_code == 200
        assert (await v.get(f"{url}/file")).status_code == 200
        # Reading position is reading state: viewers may set it ...
        progress = await v.patch(url, json={"last_page_read": 2})
        assert progress.status_code == 200
        assert progress.json()["last_page_read"] == 2
        # ... but nothing else.
        for body in ({"title": "x"}, {"tags": ["x"]}, {"folder_id": None}):
            assert_error(await v.patch(url, json=body), 403, "auth.forbidden")
        assert_error(
            await v.patch(url, json={"last_page_read": 1, "title": "x"}), 403, "auth.forbidden"
        )
        move = await v.post(
            "/api/sources/move", json={"source_ids": [source["id"]], "folder_id": folder["id"]}
        )
        assert_error(move, 403, "auth.forbidden")
        assert_error(await v.delete(url), 403, "auth.forbidden")

    async with client_for(app, outsider.email) as o:
        assert_error(await o.get(url), 404, "source.not_found")
        assert_error(await o.get(f"{url}/file"), 404, "source.not_found")
        assert_error(await o.patch(url, json={"last_page_read": 1}), 404, "source.not_found")
        assert_error(await o.delete(url), 404, "source.not_found")
        move = await o.post("/api/sources/move", json={"source_ids": [source["id"]]})
        assert_error(move, 422, "source.move_invalid")

    async with client_for(app, editor.email) as e:
        assert (await e.patch(url, json={"title": "Edited", "tags": ["a"]})).status_code == 200
        move = await e.post(
            "/api/sources/move", json={"source_ids": [source["id"]], "folder_id": folder["id"]}
        )
        assert move.json() == {"moved": 1}
        assert (await e.delete(url)).status_code == 204


async def test_failure_after_placing_leaves_nothing_behind(
    client: httpx.AsyncClient,
    pid: str,
    storage: Path,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_place = FileStorage.place

    async def place_then_fail(self: FileStorage, staged: StagedFile) -> None:
        await real_place(self, staged)
        raise OSError("disk trouble after the rename")

    monkeypatch.setattr(FileStorage, "place", place_then_fail)
    response = await upload(client, pid, make_pdf())
    assert_error(response, 500, "server.internal")
    assert _blobs(storage) == []
    assert _temp_files(storage) == []
    assert await db.scalar(select(func.count()).select_from(File)) == 0
    assert (await client.get(f"/api/projects/{pid}/tree")).json()["sources"] == []


def test_stale_staging_files_are_swept(tmp_path: Path) -> None:
    storage = FileStorage(tmp_path)
    storage.prepare()
    stale, fresh = storage.temp_dir / "old.upload", storage.temp_dir / "new.upload"
    stale.write_bytes(b"x")
    fresh.write_bytes(b"x")
    os.utime(stale, (0, 0))
    storage.prepare()
    assert not stale.exists()
    assert fresh.exists()
