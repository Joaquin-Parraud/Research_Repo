"use strict";
// Pure functions: HTML cleaning and request validation (no processor engines needed).

const test = require("node:test");
const assert = require("node:assert/strict");
const { clean } = require("../lib/html");
const { parseRenderRequest, normalizeItem, BadRequest } = require("../lib/validate");

test("clean keeps i, b, sup, sub and drops every other tag", () => {
  const out = clean(
    '  <div class="csl-entry">Kim, A. (2020). CO<sub>2</sub> and <em>Homo</em> <b>bold</b> ' +
      '<span style="font-variant:small-caps;">caps</span> <a href="x">link</a>.</div>\n',
  );
  assert.equal(out.html, "Kim, A. (2020). CO<sub>2</sub> and <i>Homo</i> <b>bold</b> caps link.");
  assert.equal(out.text, "Kim, A. (2020). CO2 and Homo bold caps link.");
});

test("clean escapes text and unescapes it for the plain form", () => {
  const out = clean("García, M., &#38; Smith, J. Things &#60;script&#62;alert(1)&#60;/script&#62; &amp; more");
  assert.equal(
    out.html,
    "García, M., &amp; Smith, J. Things &lt;script&gt;alert(1)&lt;/script&gt; &amp; more",
  );
  assert.equal(out.text, "García, M., & Smith, J. Things <script>alert(1)</script> & more");
});

test("clean turns reverse italics into closed and reopened <i>", () => {
  const out = clean(
    '<i>The <span style="font-style:normal;">Homo sapiens</span> book</i>. (2020). <i>J</i>, <i>1</i>.',
  );
  assert.equal(out.html, "<i>The </i>Homo sapiens<i> book</i>. (2020). <i>J</i>, <i>1</i>.");
  assert.equal(out.text, "The Homo sapiens book. (2020). J, 1.");
});

test("clean keeps nesting minimal and well formed", () => {
  assert.equal(clean("<i>A <b>B</b> C</i>").html, "<i>A <b>B</b> C</i>");
  assert.equal(clean("<b><i>x</i></b>").html, "<i><b>x</b></i>");
  assert.equal(clean("<i>a</i><i>b</i>").html, "<i>ab</i>");
});

test("clean collapses whitespace (including no-break spaces) and trims", () => {
  const out = clean("  <i> A </i>  &#160;B\n\n<b> </b> C  ");
  assert.equal(out.text, "A B C");
  assert.equal(out.html, "<i>A </i>B C");
});

test("clean leaves unknown entities and stray brackets as text", () => {
  const out = clean("x &bogus; 3 < 4 &#x41;");
  assert.equal(out.text, "x &bogus; 3 < 4 A");
  assert.equal(out.html, "x &amp;bogus; 3 &lt; 4 A");
});

test("normalizeItem makes numbers strings and drops non-variables", () => {
  const item = normalizeItem({
    id: "k",
    type: "article-journal",
    title: "T",
    volume: 12,
    page: 45,
    flag: true,
    note: { a: 1 },
    custom: [1, 2],
    author: [{ family: "Q" }, "junk"],
    issued: { "date-parts": [[2020]] },
    accessed: "2020",
  });
  assert.deepEqual(item, {
    type: "article-journal",
    title: "T",
    volume: "12",
    page: "45",
    author: [{ family: "Q" }],
    issued: { "date-parts": [[2020]] },
    id: "k",
  });
});

test("parseRenderRequest accepts the documented shape", () => {
  const request = parseRenderRequest({
    locale: "es",
    items: [
      { id: "a", type: "book", title: "A" },
      { id: "b", type: "book", title: "B" },
    ],
    bibliography: { ids: ["b", "b"] },
    citations: [{ id: "a", mode: "narrative" }],
  });
  assert.equal(request.cslLocale, "es-ES");
  assert.deepEqual([...request.items.keys()], ["a", "b"]);
  assert.deepEqual(request.bibliography, { ids: ["b"] });
  assert.deepEqual(request.citations, [{ id: "a", mode: "narrative" }]);
  assert.equal(parseRenderRequest({ locale: "en-US", items: [] }).bibliography, null);
  assert.deepEqual(
    parseRenderRequest({ locale: "en-US", items: [], bibliography: {} }).bibliography,
    { ids: null },
  );
});

test("parseRenderRequest rejects invalid bodies with a reason", () => {
  const item = { id: "a", type: "book", title: "A" };
  const cases = [
    [[], /JSON object/],
    [{ locale: "fr", items: [] }, /locale/],
    [{ locale: "en-US" }, /items/],
    [{ locale: "en-US", items: [item], extra: 1 }, /unknown field: extra/],
    [{ locale: "en-US", items: ["x"] }, /items\[0\] must be an object/],
    [{ locale: "en-US", items: [{ type: "book" }] }, /items\[0\]\.id/],
    [{ locale: "en-US", items: [{ id: "a" }] }, /items\[0\]\.type/],
    [{ locale: "en-US", items: [item, item] }, /duplicate item id: a/],
    [{ locale: "en-US", items: [item], bibliography: [] }, /bibliography must be an object/],
    [{ locale: "en-US", items: [item], bibliography: { ids: "a" } }, /bibliography\.ids/],
    [{ locale: "en-US", items: [item], bibliography: { ids: ["z"] } }, /not one of the items: z/],
    [{ locale: "en-US", items: [item], bibliography: { sort: 1 } }, /bibliography\.sort/],
    [{ locale: "en-US", items: [item], citations: {} }, /citations must be an array/],
    [{ locale: "en-US", items: [item], citations: [{ id: "a", mode: "x" }] }, /mode/],
    [{ locale: "en-US", items: [item], citations: [{ id: "z", mode: "narrative" }] }, /not one of/],
    [{ locale: "en-US", items: [item], citations: [{ id: "a", mode: "narrative", x: 1 }] }, /citations\[0\]\.x/],
  ];
  for (const [body, message] of cases) {
    assert.throws(() => parseRenderRequest(body), (error) => {
      assert.ok(error instanceof BadRequest, `${JSON.stringify(body)}: ${error}`);
      assert.match(error.message, message);
      return true;
    });
  }
});
