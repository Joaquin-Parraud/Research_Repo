import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseSafeHtml, SafeHtml, safeText, serializeSafeHtml } from "./safeHtml";

function renderHtml(html: string) {
  const { container } = render(<p>{<SafeHtml html={html} />}</p>);
  return container.querySelector("p") as HTMLElement;
}

describe("SafeHtml", () => {
  it("renders italics, bold, superscript and subscript as elements", () => {
    const p = renderHtml("Doe (2020). <i>Title</i>, <b>bold</b>, H<sub>2</sub>O, x<sup>2</sup>.");
    expect(p.innerHTML).toBe("Doe (2020). <i>Title</i>, <b>bold</b>, H<sub>2</sub>O, x<sup>2</sup>.");
    expect(p.querySelector("i")).toHaveTextContent("Title");
  });

  it("maps em/strong to i/b and nests tags", () => {
    expect(renderHtml("<em>a <strong>b</strong></em>").innerHTML).toBe("<i>a <b>b</b></i>");
  });

  it("never renders a <script> element or runs it, and drops its content", () => {
    const p = renderHtml('Before<script>window.__pwned = true</script> after');
    expect(p.querySelector("script")).toBeNull();
    expect(p.textContent).toBe("Before after");
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("never renders an <img> (or its onerror handler)", () => {
    const p = renderHtml('Hello <img src="x" onerror="window.__pwned = true"> world');
    expect(p.querySelector("img")).toBeNull();
    expect(p.innerHTML).not.toMatch(/onerror/);
    expect(p.textContent).toBe("Hello  world");
  });

  it("drops attributes from allowed tags", () => {
    const p = renderHtml('<i onclick="alert(1)" style="color:red" class="x">t</i>');
    expect(p.innerHTML).toBe("<i>t</i>");
  });

  it("drops links, iframes and other tags but keeps their visible text", () => {
    const p = renderHtml('<a href="javascript:alert(1)">link</a> <iframe src="//evil"></iframe><span>kept</span>');
    expect(p.querySelector("a")).toBeNull();
    expect(p.querySelector("iframe")).toBeNull();
    expect(p.querySelector("span")).toBeNull();
    expect(p.textContent).toBe("link kept");
  });

  it("shows markup that was escaped in the source as literal text, not as elements", () => {
    const p = renderHtml("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#8211; &quot;x&quot;");
    expect(p.querySelector("script")).toBeNull();
    expect(p.textContent).toBe('<script>alert(1)</script> & – "x"');
  });

  it("copes with unbalanced and malformed markup", () => {
    expect(renderHtml("<i>open <b>never closed").innerHTML).toBe("<i>open <b>never closed</b></i>");
    expect(renderHtml("stray </i> close").textContent).toBe("stray  close");
    expect(renderHtml("1 < 2 and 3 > 2").textContent).toBe("1 < 2 and 3 > 2");
    expect(renderHtml("<!-- hidden --><i>shown</i>").innerHTML).toBe("<i>shown</i>");
  });
});

describe("parseSafeHtml helpers", () => {
  it("serialises to clean, escaped HTML for the clipboard", () => {
    const nodes = parseSafeHtml('<i onclick="x">A &amp; B</i> <script>bad()</script>&lt;b&gt;');
    expect(serializeSafeHtml(nodes)).toBe("<i>A &amp; B</i> &lt;b&gt;");
  });

  it("gives the plain text", () => {
    expect(safeText(parseSafeHtml("Doe (2020). <i>Title</i>."))).toBe("Doe (2020). Title.");
  });
});
