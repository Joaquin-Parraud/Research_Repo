import { describe, expect, it } from "vitest";
import { makeFolder, makeSummary, sampleTree } from "../../test/fixtures";
import {
  ancestorIds,
  buildTree,
  canMoveFolder,
  descendantIds,
  flattenForPicker,
  folderDropId,
  moveFolderInList,
  moveSourcesInList,
  parseDropTarget,
  resolveDrop,
  ROOT_DROP_ID,
} from "./tree";

describe("buildTree", () => {
  it("nests folders from the flat lists, ordered by position, with direct source counts", () => {
    const { folders, sources } = sampleTree();
    const { roots, rootSourceCount } = buildTree([...folders].reverse(), sources);

    expect(roots.map((node) => node.folder.name)).toEqual(["Theory", "Data"]);
    const theory = roots[0];
    expect(theory?.children.map((node) => node.folder.name)).toEqual(["Method"]);
    expect(theory?.sourceCount).toBe(1);
    expect(theory?.children[0]?.sourceCount).toBe(1);
    expect(roots[1]?.sourceCount).toBe(0);
    expect(rootSourceCount).toBe(2);
  });

  it("orders siblings by position, then name", () => {
    const folders = [
      makeFolder("a", "Zed", null, 0),
      makeFolder("b", "Alpha", null, 1),
      makeFolder("c", "Beta", null, 1),
    ];
    expect(buildTree(folders, []).roots.map((n) => n.folder.id)).toEqual(["a", "b", "c"]);
  });

  it("shows a folder with an unknown parent at the root instead of losing it", () => {
    const { roots } = buildTree([makeFolder("x", "Orphan", "missing")], []);
    expect(roots.map((n) => n.folder.id)).toEqual(["x"]);
  });
});

describe("descendantIds / ancestorIds / flattenForPicker", () => {
  const folders = [
    makeFolder("a", "A"),
    makeFolder("b", "B", "a"),
    makeFolder("c", "C", "b"),
    makeFolder("d", "D"),
  ];

  it("finds all descendants, not the folder itself", () => {
    expect([...descendantIds(folders, "a")].sort()).toEqual(["b", "c"]);
    expect([...descendantIds(folders, "d")]).toEqual([]);
  });

  it("lists ancestors from the top down", () => {
    expect(ancestorIds(folders, "c")).toEqual(["a", "b"]);
    expect(ancestorIds(folders, "a")).toEqual([]);
  });

  it("flattens depth-first with depths", () => {
    const entries = flattenForPicker(buildTree(folders, []).roots);
    expect(entries.map((e) => `${e.depth}:${e.folder.id}`)).toEqual(["0:a", "1:b", "2:c", "0:d"]);
  });
});

describe("canMoveFolder (cycle prevention)", () => {
  const folders = [makeFolder("a", "A"), makeFolder("b", "B", "a"), makeFolder("c", "C", "b"), makeFolder("d", "D")];

  it("rejects moving a folder into itself", () => {
    expect(canMoveFolder(folders, "a", "a")).toEqual({ ok: false, reason: "self" });
  });

  it("rejects moving a folder into any descendant, however deep", () => {
    expect(canMoveFolder(folders, "a", "b")).toEqual({ ok: false, reason: "descendant" });
    expect(canMoveFolder(folders, "a", "c")).toEqual({ ok: false, reason: "descendant" });
  });

  it("rejects a no-op move to the current parent (root or folder)", () => {
    expect(canMoveFolder(folders, "a", null)).toEqual({ ok: false, reason: "same_parent" });
    expect(canMoveFolder(folders, "b", "a")).toEqual({ ok: false, reason: "same_parent" });
  });

  it("allows valid moves, including to the root and into unrelated folders", () => {
    expect(canMoveFolder(folders, "c", null)).toEqual({ ok: true });
    expect(canMoveFolder(folders, "b", "d")).toEqual({ ok: true });
    expect(canMoveFolder(folders, "d", "c")).toEqual({ ok: true });
  });
});

describe("optimistic list updates", () => {
  it("moves a folder to the end of its new siblings", () => {
    const folders = [makeFolder("a", "A", null, 0), makeFolder("b", "B", "a", 0), makeFolder("c", "C", "a", 1)];
    const next = moveFolderInList(folders, "b", null);
    expect(next.find((f) => f.id === "b")).toMatchObject({ parent_id: null, position: 1 });
    expect(folders[1]?.parent_id).toBe("a"); // input untouched
  });

  it("moves only the given sources", () => {
    const sources = [makeSummary("s1", "One", null), makeSummary("s2", "Two", null)];
    const next = moveSourcesInList(sources, ["s2"], "f1");
    expect(next.map((s) => s.folder_id)).toEqual([null, "f1"]);
  });
});

describe("resolveDrop", () => {
  const { folders, sources } = sampleTree();

  it("parses drop target ids", () => {
    expect(parseDropTarget(ROOT_DROP_ID)).toBeNull();
    expect(parseDropTarget(folderDropId("f1"))).toBe("f1");
    expect(parseDropTarget("something-else")).toBeUndefined();
    expect(parseDropTarget(null)).toBeUndefined();
  });

  it("re-parents a folder dropped on another folder or on the root", () => {
    expect(resolveDrop({ type: "folder", id: "f3" }, folderDropId("f1"), folders, sources)).toEqual({
      kind: "moveFolder",
      folderId: "f3",
      parentId: "f1",
    });
    expect(resolveDrop({ type: "folder", id: "f2" }, ROOT_DROP_ID, folders, sources)).toEqual({
      kind: "moveFolder",
      folderId: "f2",
      parentId: null,
    });
  });

  it("rejects dropping a folder into itself or a descendant", () => {
    expect(resolveDrop({ type: "folder", id: "f1" }, folderDropId("f1"), folders, sources)).toEqual({
      kind: "rejected",
      reason: "self",
    });
    expect(resolveDrop({ type: "folder", id: "f1" }, folderDropId("f2"), folders, sources)).toEqual({
      kind: "rejected",
      reason: "descendant",
    });
  });

  it("ignores drops outside targets and no-op drops", () => {
    expect(resolveDrop({ type: "folder", id: "f1" }, null, folders, sources)).toBeNull();
    expect(resolveDrop({ type: "folder", id: "f1" }, ROOT_DROP_ID, folders, sources)).toBeNull();
    expect(resolveDrop({ type: "sources", ids: ["s2"] }, folderDropId("f1"), folders, sources)).toBeNull();
  });

  it("moves several dragged sources, skipping those already in the target", () => {
    expect(
      resolveDrop({ type: "sources", ids: ["s1", "s2", "s3"] }, folderDropId("f1"), folders, sources),
    ).toEqual({ kind: "moveSources", ids: ["s1", "s3"], folderId: "f1" });
    expect(resolveDrop({ type: "sources", ids: ["s2"] }, ROOT_DROP_ID, folders, sources)).toEqual({
      kind: "moveSources",
      ids: ["s2"],
      folderId: null,
    });
  });
});
