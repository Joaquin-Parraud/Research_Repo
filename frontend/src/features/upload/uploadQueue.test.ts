import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import { createUploadQueue, partitionPdfs, type SendArgs } from "./uploadQueue";

const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });

interface Pending {
  args: SendArgs;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function setup(concurrency?: number) {
  const calls: Pending[] = [];
  const done = vi.fn();
  const queue = createUploadQueue({
    concurrency,
    onItemDone: done,
    send: (args) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ args, resolve, reject });
      }),
  });
  const status = () => queue.getSnapshot().map((item) => `${item.file.name}:${item.status}`);
  return { queue, calls, done, status };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("partitionPdfs", () => {
  it("accepts PDFs by MIME type or extension and rejects the rest", () => {
    const { accepted, rejected } = partitionPdfs([
      pdf("a.pdf"),
      new File(["x"], "B.PDF"),
      new File(["x"], "notes.txt", { type: "text/plain" }),
      new File(["x"], "image.png", { type: "image/png" }),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf", "B.PDF"]);
    expect(rejected.map((f) => f.name)).toEqual(["notes.txt", "image.png"]);
  });
});

describe("upload queue", () => {
  it("runs at most `concurrency` uploads and starts the next when one finishes", async () => {
    const { queue, calls, status, done } = setup(2);
    queue.add("p1", "f1", [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);
    expect(status()).toEqual(["a.pdf:uploading", "b.pdf:uploading", "c.pdf:queued"]);

    calls[0]?.resolve();
    await flush();
    expect(status()).toEqual(["a.pdf:done", "b.pdf:uploading", "c.pdf:uploading"]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]?.[0]).toMatchObject({ projectId: "p1", folderId: "f1" });
  });

  it("tracks progress per file", () => {
    const { queue, calls } = setup();
    queue.add("p1", null, [pdf("a.pdf")]);
    calls[0]?.args.onProgress(0.42);
    expect(queue.getSnapshot()[0]?.progress).toBeCloseTo(0.42);
    calls[0]?.args.onProgress(7);
    expect(queue.getSnapshot()[0]?.progress).toBe(1);
  });

  it("marks failures, keeps the other uploads going, and retries", async () => {
    const { queue, calls, status } = setup(2);
    queue.add("p1", null, [pdf("a.pdf"), pdf("b.pdf")]);

    calls[0]?.reject(new ApiError("source.invalid_pdf", 422, "bad"));
    await flush();
    expect(status()).toEqual(["a.pdf:failed", "b.pdf:uploading"]);
    expect((queue.getSnapshot()[0]?.error as ApiError).code).toBe("source.invalid_pdf");

    const id = queue.getSnapshot()[0]?.id ?? "";
    queue.retry(id);
    expect(status()).toEqual(["a.pdf:uploading", "b.pdf:uploading"]);
    expect(calls).toHaveLength(3);
    calls[2]?.resolve();
    await flush();
    expect(status()[0]).toBe("a.pdf:done");
  });

  it("offers the duplicate flow: add anyway re-sends with allowDuplicate, skip removes", async () => {
    const { queue, calls, status } = setup();
    queue.add("p1", null, [pdf("a.pdf"), pdf("b.pdf")]);
    const duplicate = new ApiError("source.duplicate_file", 409, "dup", { existing_source_id: "s9" });
    calls[0]?.reject(duplicate);
    calls[1]?.reject(duplicate);
    await flush();
    expect(status()).toEqual(["a.pdf:duplicate", "b.pdf:duplicate"]);
    expect(queue.getSnapshot()[0]?.existingSourceId).toBe("s9");
    expect(calls[0]?.args.item.allowDuplicate).toBe(false);

    const [first, second] = queue.getSnapshot();
    queue.addAnyway(first?.id ?? "");
    queue.dismiss(second?.id ?? "");
    expect(calls).toHaveLength(3);
    expect(calls[2]?.args.item.allowDuplicate).toBe(true);
    expect(status()).toEqual(["a.pdf:uploading"]);
  });

  it("aborts an upload that is dismissed while running", async () => {
    const { queue, calls, status } = setup();
    queue.add("p1", null, [pdf("a.pdf")]);
    const id = queue.getSnapshot()[0]?.id ?? "";
    queue.dismiss(id);
    expect(calls[0]?.args.signal.aborted).toBe(true);
    calls[0]?.reject(new ApiError("aborted", 0, "x"));
    await flush();
    expect(status()).toEqual([]);
  });

  it("clears finished items but keeps active ones", async () => {
    const { queue, calls, status } = setup(1);
    queue.add("p1", null, [pdf("a.pdf"), pdf("b.pdf")]);
    calls[0]?.resolve();
    await flush();
    queue.clearFinished();
    expect(status()).toEqual(["b.pdf:uploading"]);
  });
});
