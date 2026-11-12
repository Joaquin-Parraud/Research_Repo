"""Archived projects are read-only (owner decision): every mutation is 409 project.archived."""

from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.core.config import Settings
from research_repo.models import ProjectRole, User
from tests.helpers import (
    add_member,
    assert_error,
    client_for,
    create_folder,
    create_project,
    make_pdf,
    upload,
)


@pytest.fixture
async def archived(client: httpx.AsyncClient, logged_in: User) -> dict[str, Any]:
    pid = (await create_project(client))["id"]
    folder = await create_folder(client, pid, "F")
    await create_folder(client, pid, "G")
    with_file = (await upload(client, pid, make_pdf(), title="Paper")).json()
    citation_only = (await upload(client, pid, title="Book")).json()
    await client.patch(f"/api/sources/{with_file['id']}", json={"tags": ["t"]})
    response = await client.patch(f"/api/projects/{pid}", json={"archived": True})
    assert response.json()["archived_at"] is not None
    return {"pid": pid, "folder": folder, "source": with_file, "bare": citation_only}


async def test_every_mutation_is_rejected(
    client: httpx.AsyncClient, archived: dict[str, Any], settings: Settings
) -> None:
    pid, folder = archived["pid"], archived["folder"]
    source, bare = archived["source"]["id"], archived["bare"]["id"]
    blobs_before = sorted(settings.storage_dir.rglob("*.pdf"))
    attempts = [
        client.put(f"/api/projects/{pid}/readme", json={"readme_md": "x"}),
        client.post(f"/api/projects/{pid}/folders", json={"name": "New"}),
        client.patch(f"/api/folders/{folder['id']}", json={"name": "Renamed"}),
        client.patch(f"/api/folders/{folder['id']}", json={"position": 1}),
        client.delete(f"/api/folders/{folder['id']}"),
        upload(client, pid, title="New source"),
        upload(client, pid, make_pdf(marker="new")),
        client.patch(f"/api/sources/{source}", json={"title": "x"}),
        client.patch(f"/api/sources/{source}", json={"folder_id": folder["id"]}),
        client.patch(f"/api/sources/{source}", json={"tags": []}),
        client.patch(f"/api/sources/{source}", json={"csl": {"type": "book", "title": "x"}}),
        client.patch(f"/api/sources/{source}", json={"metadata_status": "confirmed"}),
        client.patch(f"/api/sources/{source}", json={"citation_key": "k"}),
        client.patch(f"/api/sources/{source}", json={"citation_key": None}),
        client.patch(f"/api/sources/{source}", json={"last_page_read": 2, "title": "x"}),
        client.post("/api/sources/move", json={"source_ids": [source], "folder_id": None}),
        client.delete(f"/api/sources/{source}"),
        client.put(
            f"/api/sources/{bare}/file",
            files=[("file", ("a.pdf", make_pdf(marker="attach"), "application/pdf"))],
        ),
        client.patch(f"/api/projects/{pid}", json={"name": "Renamed"}),
        client.patch(f"/api/projects/{pid}", json={"description": "x"}),
        client.patch(f"/api/projects/{pid}", json={"citation_locale": "es"}),
        client.patch(f"/api/projects/{pid}", json={"archived": True}),
        client.patch(f"/api/projects/{pid}", json={"archived": False, "name": "x"}),
        client.patch(f"/api/projects/{pid}", json={}),
    ]
    for attempt in attempts:
        assert_error(await attempt, 409, "project.archived")

    tree = (await client.get(f"/api/projects/{pid}/tree")).json()
    assert sorted(f["name"] for f in tree["folders"]) == ["F", "G"]
    assert sorted(s["title"] for s in tree["sources"]) == ["Book", "Paper"]
    got = (await client.get(f"/api/sources/{source}")).json()
    assert (got["tags"], got["metadata_status"]) == (["t"], "pending")
    assert (await client.get(f"/api/sources/{bare}")).json()["has_file"] is False
    assert sorted(settings.storage_dir.rglob("*.pdf")) == blobs_before
    temp = settings.storage_dir / ".tmp"
    assert not temp.exists() or list(temp.iterdir()) == []


@pytest.mark.citeproc
async def test_reads_and_allowed_actions(
    app: FastAPI, client: httpx.AsyncClient, archived: dict[str, Any], db: AsyncSession
) -> None:
    pid, source = archived["pid"], archived["source"]["id"]
    for url in (
        f"/api/projects/{pid}",
        f"/api/projects/{pid}/readme",
        f"/api/projects/{pid}/tree",
        f"/api/sources/{source}",
        f"/api/sources/{source}/file",
        f"/api/sources/{source}/citation",
    ):
        assert (await client.get(url)).status_code == 200, url
    bib = await client.post(f"/api/projects/{pid}/bibliography", json={"format": "text"})
    assert bib.json()["count"] == 2
    suggest = await client.post(f"/api/sources/{source}/metadata/suggest")
    assert suggest.status_code == 200
    # Reading position is reading state, for owners and viewers alike.
    page = await client.patch(f"/api/sources/{source}", json={"last_page_read": 4})
    assert page.json()["last_page_read"] == 4
    viewer = await add_member(db, pid, ProjectRole.viewer)
    async with client_for(app, viewer.email) as v:
        assert (
            await v.patch(f"/api/sources/{source}", json={"last_page_read": 5})
        ).status_code == 200
        # Role checks come first: a viewer is still forbidden, not told about the archive.
        assert_error(
            await v.patch(f"/api/sources/{source}", json={"title": "x"}), 403, "auth.forbidden"
        )
    copy = await client.post(f"/api/projects/{pid}/copy", json={"name": "Copy"})
    assert copy.status_code == 201

    restored = await client.patch(f"/api/projects/{pid}", json={"archived": False})
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert (await client.patch(f"/api/sources/{source}", json={"title": "x"})).status_code == 200


async def test_archived_project_can_be_deleted(
    client: httpx.AsyncClient, archived: dict[str, Any], settings: Settings
) -> None:
    assert (await client.delete(f"/api/projects/{archived['pid']}")).status_code == 204
    assert sorted(settings.storage_dir.rglob("*.pdf")) == []
