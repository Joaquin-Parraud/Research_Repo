import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedSaver } from "./pageSave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createDebouncedSaver", () => {
  it("saves only the last page after the quiet period (no request spam)", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1, 1000);
    for (const page of [2, 3, 4, 5]) {
      saver.schedule(page);
      vi.advanceTimersByTime(300);
    }
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(5);
  });

  it("does not save the page the source opened at, nor the same page twice", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 7, 1000);
    saver.schedule(7);
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();

    saver.schedule(9);
    vi.advanceTimersByTime(1000);
    saver.schedule(9);
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("scrolling away and back before the delay results in no request", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 3, 1000);
    saver.schedule(10);
    vi.advanceTimersByTime(200);
    saver.schedule(3);
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it("flush saves the pending page immediately, once", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1, 1000);
    saver.schedule(4);
    saver.flush();
    expect(save).toHaveBeenCalledWith(4);
    vi.advanceTimersByTime(5000);
    saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending save", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1, 1000);
    saver.schedule(4);
    saver.cancel();
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
