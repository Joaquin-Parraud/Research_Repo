"""Folder tree: create, rename, move, reorder, cycles, name conflicts and delete-with-move-up."""

from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

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


async def _tree(client: httpx.AsyncClient, pid: str) -> dict[str, Any]:
    response = await client.get(f"/api/projects/{pid}/tree")
    assert response.status_code == 200
    return response.json()


async def _children(client: httpx.AsyncClient, pid: str, parent_id: str | None) -> list[str]:
    """Names of a folder's children in position order, checking positions are dense."""
    folders = [f for f in (await _tree(client, pid))["folders"] if f["parent_id"] == parent_id]
    folders.sort(key=lambda f: f["position"])
    assert [f["position"] for f in folders] == list(range(len(folders)))
    return [f["name"] for f in folders]


@pytest.fixture
async def pid(client: httpx.AsyncClient, logged_in: User) -> str:
    return (await create_project(client))["id"]


async def test_create(client: httpx.AsyncClient, pid: str) -> None:
    a = await create_folder(client, pid, "  Theory  ")
    assert set(a) == {"id", "project_id", "parent_id", "name", "position"}
    assert (a["name"], a["parent_id"], a["position"], a["project_id"]) == ("Theory", None, 0, pid)
    b = await create_folder(client, pid, "Method")
    assert b["position"] == 1
    child = await create_folder(client, pid, "Sub", a["id"])
    assert (child["parent_id"], child["position"]) == (a["id"], 0)
    assert await _children(client, pid, None) == ["Theory", "Method"]


@pytest.mark.parametrize("name", ["", "   ", "a/b", "x" * 256])
async def test_invalid_names(client: httpx.AsyncClient, pid: str, name: str) -> None:
    response = await client.post(f"/api/projects/{pid}/folders", json={"name": name})
    assert_error(response, 422, "validation.invalid")


async def test_name_conflicts(client: httpx.AsyncClient, pid: str) -> None:
    theory = await create_folder(client, pid, "Theory")
    response = await client.post(f"/api/projects/{pid}/folders", json={"name": " theory "})
    assert_error(response, 409, "folder.name_conflict")
    # Same name under a different parent is fine.
    await create_folder(client, pid, "Theory", theory["id"])
    other = await create_folder(client, pid, "Other")
    rename = await client.patch(f"/api/folders/{other['id']}", json={"name": "THEORY"})
    assert_error(rename, 409, "folder.name_conflict")
    # Renaming a folder to a different case of its own name is allowed.
    own = await client.patch(f"/api/folders/{theory['id']}", json={"name": "THEORY"})
    assert own.status_code == 200
    assert own.json()["name"] == "THEORY"
    # Moving into a parent that has a same-named child conflicts.
    nested = await create_folder(client, pid, "Other", theory["id"])
    move = await client.patch(f"/api/folders/{nested['id']}", json={"parent_id": None})
    assert_error(move, 409, "folder.name_conflict")


async def test_unknown_parent(client: httpx.AsyncClient, pid: str, logged_in: User) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    response = await client.post(
        f"/api/projects/{pid}/folders", json={"name": "X", "parent_id": missing}
    )
    assert_error(response, 404, "folder.not_found")
    # A folder of another project is not a valid parent either.
    other = (await create_project(client, "Other"))["id"]
    foreign = await create_folder(client, other, "Foreign")
    response = await client.post(
        f"/api/projects/{pid}/folders", json={"name": "X", "parent_id": foreign["id"]}
    )
    assert_error(response, 404, "folder.not_found")
    mine = await create_folder(client, pid, "Mine")
    move = await client.patch(f"/api/folders/{mine['id']}", json={"parent_id": foreign["id"]})
    assert_error(move, 404, "folder.not_found")
    assert_error(
        await client.patch(f"/api/folders/{missing}", json={"name": "x"}), 404, "folder.not_found"
    )
    assert_error(await client.delete(f"/api/folders/{missing}"), 404, "folder.not_found")


async def test_move_and_null_parent(client: httpx.AsyncClient, pid: str) -> None:
    a = await create_folder(client, pid, "A")
    b = await create_folder(client, pid, "B")
    c = await create_folder(client, pid, "C")

    moved = await client.patch(f"/api/folders/{b['id']}", json={"parent_id": a["id"]})
    assert moved.status_code == 200
    assert (moved.json()["parent_id"], moved.json()["position"]) == (a["id"], 0)
    assert await _children(client, pid, None) == ["A", "C"]

    # Renaming without parent_id keeps the parent.
    renamed = await client.patch(f"/api/folders/{b['id']}", json={"name": "B2"})
    assert renamed.json()["parent_id"] == a["id"]

    # An explicit null moves to the root, appended last.
    root = await client.patch(f"/api/folders/{b['id']}", json={"parent_id": None})
    assert (root.json()["parent_id"], root.json()["position"]) == (None, 2)
    assert await _children(client, pid, None) == ["A", "C", "B2"]
    assert await _children(client, pid, a["id"]) == []

    # Move with a position.
    placed = await client.patch(
        f"/api/folders/{c['id']}", json={"parent_id": a["id"], "position": 5}
    )
    assert placed.json()["position"] == 0
    assert await _children(client, pid, None) == ["A", "B2"]


async def test_reorder(client: httpx.AsyncClient, pid: str) -> None:
    folders = [await create_folder(client, pid, name) for name in "ABCD"]
    a, _, _, d = folders

    response = await client.patch(f"/api/folders/{d['id']}", json={"position": 0})
    assert response.json()["position"] == 0
    assert await _children(client, pid, None) == ["D", "A", "B", "C"]

    await client.patch(f"/api/folders/{a['id']}", json={"position": 2})
    assert await _children(client, pid, None) == ["D", "B", "A", "C"]

    await client.patch(f"/api/folders/{a['id']}", json={"position": 99})
    assert await _children(client, pid, None) == ["D", "B", "C", "A"]

    negative = await client.patch(f"/api/folders/{a['id']}", json={"position": -1})
    assert_error(negative, 422, "validation.invalid")
    null = await client.patch(f"/api/folders/{a['id']}", json={"position": None})
    assert_error(null, 422, "validation.invalid")
    null_name = await client.patch(f"/api/folders/{a['id']}", json={"name": None})
    assert_error(null_name, 422, "validation.invalid")


async def test_cycles(client: httpx.AsyncClient, pid: str) -> None:
    a = await create_folder(client, pid, "A")
    b = await create_folder(client, pid, "B", a["id"])
    c = await create_folder(client, pid, "C", b["id"])
    for target in (a, b, c):
        response = await client.patch(f"/api/folders/{a['id']}", json={"parent_id": target["id"]})
        assert_error(response, 409, "folder.cycle")
    # Moving down a branch that does not contain the folder is fine.
    ok = await client.patch(f"/api/folders/{c['id']}", json={"parent_id": a["id"]})
    assert ok.status_code == 200


async def test_delete_moves_contents_up(client: httpx.AsyncClient, pid: str) -> None:
    first = await create_folder(client, pid, "First")
    doomed = await create_folder(client, pid, "Doomed")
    last = await create_folder(client, pid, "Last")
    x = await create_folder(client, pid, "X", doomed["id"])
    y = await create_folder(client, pid, "Y", doomed["id"])
    grandchild = await create_folder(client, pid, "G", x["id"])
    source = (await upload(client, pid, make_pdf(), folder_id=doomed["id"])).json()
    deep = (await upload(client, pid, title="Deep", folder_id=x["id"])).json()

    assert (await client.delete(f"/api/folders/{doomed['id']}")).status_code == 204

    tree = await _tree(client, pid)
    by_id = {f["id"]: f for f in tree["folders"]}
    assert doomed["id"] not in by_id
    assert by_id[x["id"]]["parent_id"] is None
    assert by_id[y["id"]]["parent_id"] is None
    assert by_id[grandchild["id"]]["parent_id"] == x["id"]
    # The children take the deleted folder's place in the order.
    assert await _children(client, pid, None) == ["First", "X", "Y", "Last"]
    assert first["id"] in by_id
    assert last["id"] in by_id
    sources = {s["id"]: s["folder_id"] for s in tree["sources"]}
    assert sources == {source["id"]: None, deep["id"]: x["id"]}


async def test_delete_renames_colliding_children(client: httpx.AsyncClient, pid: str) -> None:
    parent = await create_folder(client, pid, "Parent")
    await create_folder(client, pid, "Data", parent["id"])
    await create_folder(client, pid, "data (2)", parent["id"])
    doomed = await create_folder(client, pid, "Doomed", parent["id"])
    await create_folder(client, pid, "DATA", doomed["id"])
    await create_folder(client, pid, "Doomed", doomed["id"])  # same name as the deleted one
    await create_folder(client, pid, "Notes", doomed["id"])

    assert (await client.delete(f"/api/folders/{doomed['id']}")).status_code == 204
    names = await _children(client, pid, parent["id"])
    assert names == ["Data", "data (2)", "DATA (3)", "Doomed", "Notes"]


async def test_delete_nested_folder_moves_to_its_parent(
    client: httpx.AsyncClient, pid: str
) -> None:
    a = await create_folder(client, pid, "A")
    b = await create_folder(client, pid, "B", a["id"])
    c = await create_folder(client, pid, "C", b["id"])
    source = (await upload(client, pid, title="S", folder_id=b["id"])).json()
    assert (await client.delete(f"/api/folders/{b['id']}")).status_code == 204
    tree = await _tree(client, pid)
    assert {f["id"]: f["parent_id"] for f in tree["folders"]} == {a["id"]: None, c["id"]: a["id"]}
    assert tree["sources"][0]["id"] == source["id"]
    assert tree["sources"][0]["folder_id"] == a["id"]


async def test_roles(app: FastAPI, client: httpx.AsyncClient, pid: str, db: AsyncSession) -> None:
    folder = await create_folder(client, pid, "F")
    viewer = await add_member(db, pid, ProjectRole.viewer, "viewer@example.org")
    editor = await add_member(db, pid, ProjectRole.editor, "editor@example.org")
    outsider = await add_member(
        db, (await create_project(client, "Elsewhere"))["id"], ProjectRole.owner, "o@example.org"
    )
    url = f"/api/folders/{folder['id']}"

    async with client_for(app, viewer.email) as v:
        assert_error(await v.patch(url, json={"name": "G"}), 403, "auth.forbidden")
        assert_error(await v.delete(url), 403, "auth.forbidden")
    async with client_for(app, outsider.email) as o:
        assert_error(await o.patch(url, json={"name": "G"}), 404, "folder.not_found")
        assert_error(await o.delete(url), 404, "folder.not_found")
    async with client_for(app, editor.email) as e:
        assert (await e.patch(url, json={"name": "G"})).status_code == 200
        assert (await e.delete(url)).status_code == 204
