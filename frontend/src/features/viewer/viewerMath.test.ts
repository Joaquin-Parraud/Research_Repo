import { describe, expect, it } from "vitest";
import { clampPage, clampScale, fitWidthScale, MAX_SCALE, MIN_SCALE, pageAtOffset, pdfErrorKind, zoomIn, zoomOut } from "./viewerMath";

describe("viewer math", () => {
  it("finds the page at a scroll offset", () => {
    const tops = [0, 800, 1600, 2400];
    expect(pageAtOffset(tops, 0)).toBe(1);
    expect(pageAtOffset(tops, 799)).toBe(1);
    expect(pageAtOffset(tops, 800)).toBe(2);
    expect(pageAtOffset(tops, 2000)).toBe(3);
    expect(pageAtOffset(tops, 99999)).toBe(4);
    expect(pageAtOffset(tops, -50)).toBe(1);
    expect(pageAtOffset([], 10)).toBe(1);
  });

  it("clamps pages and zoom", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(4.9, 10)).toBe(4);
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(zoomIn(1)).toBeGreaterThan(1);
    expect(zoomOut(1)).toBeLessThan(1);
    expect(zoomIn(MAX_SCALE)).toBe(MAX_SCALE);
    expect(zoomOut(MIN_SCALE)).toBe(MIN_SCALE);
  });

  it("computes fit-width scale with padding", () => {
    expect(fitWidthScale(632, 600)).toBeCloseTo(1);
    expect(fitWidthScale(0, 600)).toBe(1);
    expect(fitWidthScale(300, 0)).toBe(1);
  });

  it("classifies pdf.js loading errors", () => {
    expect(pdfErrorKind({ status: 404 })).toBe("noFile");
    expect(pdfErrorKind({ status: 403 })).toBe("forbidden");
    expect(pdfErrorKind({ name: "InvalidPDFException" })).toBe("invalid");
    expect(pdfErrorKind(new Error("x"))).toBe("generic");
    expect(pdfErrorKind(null)).toBe("generic");
  });
});
