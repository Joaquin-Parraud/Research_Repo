"""Projects: CRUD, slugs, archive, README, tree and role enforcement."""

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from research_repo.models import Membership, Project, ProjectRole, User
from tests.helpers import (
    add_member,
    assert_error,
    client_for,
    create_folder,
    create_project,
    make_pdf,
    upload,
)

PROJECT_KEYS = {
    "id",
    "name",
    "slug",
    "description",
    "citation_locale",
    "archived_at",
    "created_at",
    "updated_at",
    "role",
    "source_count",
}


async def test_requires_login(client: httpx.AsyncClient) -> None:
    assert_error(await client.get("/api/projects"), 401, "auth.not_authenticated")
    assert_error(
        await client.post("/api/projects", json={"name": "x"}), 401, "auth.not_authenticated"
    )


async def test_create_and_get(client: httpx.AsyncClient, logged_in: User, db: AsyncSession) -> None:
    response = await client.post(
        "/api/projects", json={"name": "  My Thesis ", "description": "About things"}
    )
    assert response.status_code == 201
    project = response.json()
    assert set(project) == PROJECT_KEYS
    assert project["name"] == "My Thesis"
    assert project["slug"] == "my-thesis"
    assert project["description"] == "About things"
    assert project["citation_locale"] == "en-US"
    assert project["archived_at"] is None
    assert project["role"] == "owner"
    assert project["source_count"] == 0

    role = await db.scalar(select(Membership.role).where(Membership.project_id == project["id"]))
    assert role is ProjectRole.owner

    got = await client.get(f"/api/projects/{project['id']}")
    assert got.status_code == 200
    assert got.json() == project

    readme = await client.get(f"/api/projects/{project['id']}/readme")
    assert readme.json()["readme_md"] == ""


async def test_slugs_are_unique(client: httpx.AsyncClient, logged_in: User) -> None:
    slugs = [(await create_project(client, "Tesis Doctoral"))["slug"] for _ in range(3)]
    assert slugs == ["tesis-doctoral", "tesis-doctoral-2", "tesis-doctoral-3"]
    assert (await create_project(client, "Árbol, ñandú & co."))["slug"] == "arbol-nandu-co"
    assert (await create_project(client, "!!!"))["slug"] == "project"
    long = await create_project(client, "x" * 150)
    assert len(long["slug"]) <= 60


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
async def test_invalid_names(client: httpx.AsyncClient, logged_in: User, name: str) -> None:
    assert_error(await client.post("/api/projects", json={"name": name}), 422, "validation.invalid")


async def test_list_orders_by_name_and_hides_archived(
    client: httpx.AsyncClient, logged_in: User, db: AsyncSession
) -> None:
    b = await create_project(client, "beta")
    a = await create_project(client, "Alpha")
    c = await create_project(client, "Gamma")
    db.add(Project(name="Not mine", slug="not-mine"))
    await db.commit()

    names = [p["name"] for p in (await client.get("/api/projects")).json()]
    assert names == ["Alpha", "beta", "Gamma"]

    archived = await client.patch(f"/api/projects/{c['id']}", json={"archived": True})
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    listed = (await client.get("/api/projects")).json()
    assert [p["id"] for p in listed] == [a["id"], b["id"]]
    listed = (await client.get("/api/projects?include_archived=true")).json()
    assert [p["id"] for p in listed] == [a["id"], b["id"], c["id"]]

    restored = await client.patch(f"/api/projects/{c['id']}", json={"archived": False})
    assert restored.json()["archived_at"] is None


async def test_update(client: httpx.AsyncClient, logged_in: User) -> None:
    project = await create_project(client)
    response = await client.patch(
        f"/api/projects/{project['id']}",
        json={"name": "Renamed", "description": "New", "citation_locale": "es"},
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["description"], body["citation_locale"]) == (
        "Renamed",
        "New",
        "es",
    )
    assert body["slug"] == project["slug"]  # slugs are stable

    bad = await client.patch(f"/api/projects/{project['id']}", json={"citation_locale": "fr"})
    assert_error(bad, 422, "validation.invalid")
    null = await client.patch(f"/api/projects/{project['id']}", json={"name": None})
    assert_error(null, 422, "validation.invalid")
    extra = await client.patch(f"/api/projects/{project['id']}", json={"slug": "x"})
    assert_error(extra, 422, "validation.invalid")


async def test_source_count(client: httpx.AsyncClient, logged_in: User) -> None:
    project = await create_project(client)
    await upload(client, project["id"], make_pdf())
    await upload(client, project["id"], title="A book")
    got = (await client.get(f"/api/projects/{project['id']}")).json()
    assert got["source_count"] == 2
    assert (await client.get("/api/projects")).json()[0]["source_count"] == 2


async def test_readme(client: httpx.AsyncClient, logged_in: User) -> None:
    project = await create_project(client)
    url = f"/api/projects/{project['id']}/readme"
    before = (await client.get(url)).json()

    text = "# Research question\n\n¿Por qué? Ünïcode ✓\n"
    put = await client.put(url, json={"readme_md": text})
    assert put.status_code == 200
    assert put.json()["readme_md"] == text
    assert put.json()["updated_at"] >= before["updated_at"]
    assert (await client.get(url)).json()["readme_md"] == text

    too_big = await client.put(url, json={"readme_md": "é" * (100 * 1024 + 1)})
    assert_error(too_big, 422, "validation.invalid")
    exactly = await client.put(url, json={"readme_md": "a" * (200 * 1024)})
    assert exactly.status_code == 200


async def test_tree(client: httpx.AsyncClient, logged_in: User) -> None:
    project = await create_project(client)
    pid = project["id"]
    theory = await create_folder(client, pid, "Theory")
    method = await create_folder(client, pid, "Method", theory["id"])
    in_folder = (await upload(client, pid, make_pdf(3), folder_id=method["id"])).json()
    at_root = (await upload(client, pid, title="Citation only")).json()

    tree = (await client.get(f"/api/projects/{pid}/tree")).json()
    assert set(tree) == {"folders", "sources"}
    assert {f["id"]: f["parent_id"] for f in tree["folders"]} == {
        theory["id"]: None,
        method["id"]: theory["id"],
    }
    by_id = {s["id"]: s for s in tree["sources"]}
    assert set(by_id[in_folder["id"]]) == {
        "id",
        "folder_id",
        "title",
        "authors_text",
        "year",
        "citation_key",
        "has_file",
        "metadata_status",
        "text_status",
        "page_count",
        "created_at",
    }
    assert by_id[in_folder["id"]]["folder_id"] == method["id"]
    assert by_id[in_folder["id"]]["has_file"] is True
    assert by_id[in_folder["id"]]["page_count"] == 3
    assert by_id[at_root["id"]]["folder_id"] is None
    assert by_id[at_root["id"]]["has_file"] is False
    assert by_id[at_root["id"]]["page_count"] is None


async def test_delete_project(client: httpx.AsyncClient, logged_in: User, db: AsyncSession) -> None:
    project = await create_project(client)
    pid = project["id"]
    parent = await create_folder(client, pid, "Parent")
    child = await create_folder(client, pid, "Child", parent["id"])
    await upload(client, pid, make_pdf(), folder_id=child["id"])
    source = (await upload(client, pid, title="Tagged")).json()
    await client.patch(f"/api/sources/{source['id']}", json={"tags": ["x"]})

    response = await client.delete(f"/api/projects/{pid}")
    assert response.status_code == 204
    assert_error(await client.get(f"/api/projects/{pid}"), 404, "project.not_found")
    assert await db.scalar(select(func.count()).select_from(Project)) == 0


async def test_roles(
    app: FastAPI, client: httpx.AsyncClient, logged_in: User, db: AsyncSession
) -> None:
    project = await create_project(client)
    pid = project["id"]
    editor = await add_member(db, pid, ProjectRole.editor, "editor@example.org")
    viewer = await add_member(db, pid, ProjectRole.viewer, "viewer@example.org")
    outsider = User(email="out@example.org", password_hash=editor.password_hash)
    db.add(outsider)
    await db.commit()

    async with client_for(app, viewer.email) as v:
        got = await v.get(f"/api/projects/{pid}")
        assert got.status_code == 200
        assert got.json()["role"] == "viewer"
        assert [p["id"] for p in (await v.get("/api/projects")).json()] == [pid]
        assert (await v.get(f"/api/projects/{pid}/readme")).status_code == 200
        assert (await v.get(f"/api/projects/{pid}/tree")).status_code == 200
        assert_error(
            await v.put(f"/api/projects/{pid}/readme", json={"readme_md": "x"}),
            403,
            "auth.forbidden",
        )
        assert_error(
            await v.post(f"/api/projects/{pid}/folders", json={"name": "F"}),
            403,
            "auth.forbidden",
        )
        assert_error(await upload(v, pid, make_pdf()), 403, "auth.forbidden")
        assert_error(await upload(v, pid, title="Book"), 403, "auth.forbidden")
        assert_error(
            await v.patch(f"/api/projects/{pid}", json={"name": "x"}), 403, "auth.forbidden"
        )
        assert_error(await v.delete(f"/api/projects/{pid}"), 403, "auth.forbidden")

    async with client_for(app, editor.email) as e:
        assert (await e.get(f"/api/projects/{pid}")).json()["role"] == "editor"
        put = await e.put(f"/api/projects/{pid}/readme", json={"readme_md": "edited"})
        assert put.status_code == 200
        assert (await e.post(f"/api/projects/{pid}/folders", json={"name": "F"})).status_code == 201
        assert (await upload(e, pid, make_pdf())).status_code == 201
        assert_error(
            await e.patch(f"/api/projects/{pid}", json={"archived": True}), 403, "auth.forbidden"
        )
        assert_error(await e.delete(f"/api/projects/{pid}"), 403, "auth.forbidden")

    async with client_for(app, outsider.email) as o:
        assert (await o.get("/api/projects")).json() == []
        for response in (
            await o.get(f"/api/projects/{pid}"),
            await o.get(f"/api/projects/{pid}/readme"),
            await o.get(f"/api/projects/{pid}/tree"),
            await o.patch(f"/api/projects/{pid}", json={"name": "x"}),
            await o.delete(f"/api/projects/{pid}"),
            await o.post(f"/api/projects/{pid}/folders", json={"name": "F"}),
            await upload(o, pid, make_pdf()),
        ):
            assert_error(response, 404, "project.not_found")

    assert (await client.get(f"/api/projects/{pid}")).json()["source_count"] == 1


async def test_unknown_project(client: httpx.AsyncClient, logged_in: User) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(await client.get(f"/api/projects/{missing}"), 404, "project.not_found")
    assert_error(await client.get("/api/projects/not-a-uuid"), 422, "validation.invalid")
