"use strict";
// The HTTP contract against real citeproc-js engines (one warm renderer for the whole file).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp, createLogger } = require("../lib/app");
const { Renderer } = require("../lib/render");

const logger = createLogger({ silent: true });
const renderer = new Renderer({ logger });
renderer.warm();

async function start(options = {}) {
  const server = createApp({ renderer, logger, maxBodyBytes: 1024 * 1024, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

let app;
test.before(async () => {
  app = await start();
});
test.after(async () => {
  app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
});

async function call(path, { method = "GET", body, type = "application/json", base } = {}) {
  const response = await fetch(`${base ?? app.base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": type },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, json: await response.json() };
}

const render = (body) => call("/render", { method: "POST", body });

function article(id, family, year, title, extra = {}) {
  return {
    id,
    type: "article-journal",
    title,
    "container-title": "Journal of Tests",
    volume: "1",
    page: "1-2",
    issued: { "date-parts": [[year]] },
    author: [{ family, given: "Ann" }],
    ...extra,
  };
}

test("GET /health", async () => {
  const response = await call("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { status: "ok" });
});

test("one call returns a sorted bibliography and both in-text forms", async () => {
  const response = await render({
    locale: "en-US",
    items: [
      article("zhou", "Zhou", 2019, "Root paper"),
      {
        ...article("garcia", "García", 2021, "The effect of things"),
        author: [
          { family: "García", given: "María" },
          { family: "Smith", given: "John" },
        ],
      },
    ],
    bibliography: {},
    citations: [
      { id: "garcia", mode: "parenthetical" },
      { id: "garcia", mode: "narrative" },
      { id: "zhou", mode: "narrative" },
    ],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    bibliography: [
      {
        id: "garcia",
        html: "García, M., &amp; Smith, J. (2021). The effect of things. <i>Journal of Tests</i>, <i>1</i>, 1–2.",
        text: "García, M., & Smith, J. (2021). The effect of things. Journal of Tests, 1, 1–2.",
      },
      {
        id: "zhou",
        html: "Zhou, A. (2019). Root paper. <i>Journal of Tests</i>, <i>1</i>, 1–2.",
        text: "Zhou, A. (2019). Root paper. Journal of Tests, 1, 1–2.",
      },
    ],
    citations: [
      { id: "garcia", mode: "parenthetical", text: "(García & Smith, 2021)" },
      { id: "garcia", mode: "narrative", text: "García and Smith (2021)" },
      { id: "zhou", mode: "narrative", text: "Zhou (2019)" },
    ],
    excluded_ids: [],
  });
});

test("Spanish: & in references and parenthetical citations, y in narrative ones", async () => {
  const response = await render({
    locale: "es",
    items: [
      {
        ...article("g", "García", 2021, "Efecto"),
        author: [
          { family: "García", given: "María" },
          { family: "Smith", given: "John" },
        ],
      },
    ],
    bibliography: {},
    citations: [
      { id: "g", mode: "parenthetical" },
      { id: "g", mode: "narrative" },
    ],
  });
  assert.equal(response.json.bibliography[0].text, "García, M., & Smith, J. (2021). Efecto. Journal of Tests, 1, 1-2.");
  assert.deepEqual(
    response.json.citations.map((c) => c.text),
    ["(García & Smith, 2021)", "García y Smith (2021)"],
  );
});

test("the items sent are the disambiguation scope", async () => {
  const beta = article("beta", "Lee", 2020, "Beta");
  const alpha = article("alpha", "Lee", 2020, "Alpha");
  const other = article("other", "Kim", 2020, "Other");

  // Whole scope: suffixes by title order, and a bibliography subset keeps them.
  const scoped = await render({
    locale: "en-US",
    items: [beta, other, alpha],
    bibliography: { ids: ["beta"] },
    citations: [
      { id: "beta", mode: "parenthetical" },
      { id: "beta", mode: "narrative" },
    ],
  });
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.json.bibliography.map((e) => e.id), ["beta"]);
  assert.match(scoped.json.bibliography[0].text, /^Lee, A\. \(2020b\)\. Beta\./);
  assert.deepEqual(scoped.json.citations.map((c) => c.text), ["(Lee, 2020b)", "Lee (2020b)"]);

  // The same item alone: no suffix, and nothing left over from the previous request.
  const alone = await render({
    locale: "en-US",
    items: [beta],
    bibliography: {},
    citations: [{ id: "beta", mode: "parenthetical" }],
  });
  assert.match(alone.json.bibliography[0].text, /^Lee, A\. \(2020\)\. Beta\./);
  assert.equal(alone.json.citations[0].text, "(Lee, 2020)");

  // Back to the full scope: same answer as the first time (the cached registration is right).
  const again = await render({
    locale: "en-US",
    items: [beta, other, alpha],
    bibliography: { ids: ["beta"] },
    citations: [
      { id: "beta", mode: "parenthetical" },
      { id: "beta", mode: "narrative" },
    ],
  });
  assert.deepEqual(again.json, scoped.json);
});

test("names are disambiguated with initials across the scope", async () => {
  const response = await render({
    locale: "en-US",
    items: [
      { ...article("j", "Smith", 2020, "One"), author: [{ family: "Smith", given: "John" }] },
      { ...article("a", "Smith", 2018, "Two"), author: [{ family: "Smith", given: "Anne" }] },
    ],
    citations: [
      { id: "j", mode: "parenthetical" },
      { id: "j", mode: "narrative" },
    ],
  });
  assert.deepEqual(response.json.citations.map((c) => c.text), ["(J. Smith, 2020)", "J. Smith (2020)"]);
  assert.deepEqual(response.json.bibliography, []);
});

test("an id reused with other data renders the new data", async () => {
  const first = await render({ locale: "en-US", items: [article("k", "Lee", 2020, "First")], bibliography: {} });
  const second = await render({ locale: "en-US", items: [article("k", "Lee", 2020, "Second")], bibliography: {} });
  assert.match(first.json.bibliography[0].text, /First/);
  assert.match(second.json.bibliography[0].text, /Second/);
});

test("leading articles are ignored when ordering same-author, same-year works", async () => {
  const book = (id, title) => ({
    id,
    type: "book",
    title,
    publisher: "Sage",
    issued: { "date-parts": [[2020]] },
    author: [{ family: "An", given: "Ji" }],
  });
  const response = await render({
    locale: "en-US",
    items: [book("banana", "Banana methods"), book("apple", "The apple study")],
    bibliography: {},
  });
  assert.deepEqual(response.json.bibliography.map((e) => e.text), [
    "An, J. (2020a). The apple study. Sage.",
    "An, J. (2020b). Banana methods. Sage.",
  ]);
});

test("numbers, superscript characters and user markup are handled", async () => {
  const response = await render({
    locale: "es",
    items: [
      {
        id: "b",
        type: "book",
        title: "E = mc² y <script>x</script> <i>Homo</i>",
        edition: 6,
        publisher: "McGraw-Hill",
        issued: { "date-parts": [[2014]] },
        author: [{ family: "Hernández", given: "Roberto" }],
      },
    ],
    bibliography: {},
  });
  assert.equal(response.status, 200);
  const [entry] = response.json.bibliography;
  assert.equal(
    entry.html,
    "Hernández, R. (2014). <i>E = mc² y &lt;script&gt;x&lt;/script&gt; </i>Homo (6.ª ed.). McGraw-Hill.",
  );
  assert.equal(entry.text, "Hernández, R. (2014). E = mc² y <script>x</script> Homo (6.ª ed.). McGraw-Hill.");
});

test("an item the processor cannot render", async () => {
  const bad = { id: "bad", type: "book", title: "Bad", author: [{ family: 5, given: "x" }] };
  const good = article("good", "Lee", 2020, "Good");

  // Not asked for: the rest is rendered and the bad item reported.
  const ok = await render({
    locale: "en-US",
    items: [good, bad],
    citations: [{ id: "good", mode: "parenthetical" }],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.citations, [{ id: "good", mode: "parenthetical", text: "(Lee, 2020)" }]);
  assert.deepEqual(ok.json.excluded_ids, ["bad"]);

  // Asked for (here as part of the whole bibliography): 422 with its id.
  const failed = await render({ locale: "en-US", items: [good, bad], bibliography: {} });
  assert.equal(failed.status, 422);
  assert.equal(failed.json.error.code, "render_failed");
  assert.deepEqual(failed.json.error.ids, ["bad"]);

  // The process is fine and the next requests render normally.
  const after = await render({ locale: "en-US", items: [good], bibliography: {} });
  assert.equal(after.status, 200);
  assert.match(after.json.bibliography[0].text, /^Lee, A\. \(2020\)\. Good\./);
  assert.equal((await call("/health")).status, 200);
});

test("request errors", async () => {
  const invalid = await call("/render", { method: "POST", body: "{nope" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.json, { error: { code: "invalid_request", message: "the body is not valid JSON" } });

  const validation = await render({ locale: "en-US", items: [{ id: "a", type: "book" }, { id: "a", type: "book" }] });
  assert.equal(validation.status, 400);
  assert.equal(validation.json.error.code, "invalid_request");
  assert.match(validation.json.error.message, /duplicate item id: a/);

  const media = await call("/render", { method: "POST", body: "x", type: "text/plain" });
  assert.equal(media.status, 415);
  assert.equal(media.json.error.code, "unsupported_media_type");

  const missing = await call("/nope");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "not_found");

  const method = await call("/render");
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  assert.equal((await call("/health", { method: "POST", body: {} })).status, 405);
});

test("bodies over the limit get 413", async () => {
  const small = await start({ maxBodyBytes: 200 });
  try {
    const items = Array.from({ length: 10 }, (_, i) => article(`k${i}`, "Lee", 2020, "Title"));
    const response = await call("/render", { method: "POST", body: { locale: "en-US", items }, base: small.base });
    assert.equal(response.status, 413);
    assert.equal(response.json.error.code, "body_too_large");

    // Without a Content-Length header (chunked), the limit applies while reading.
    const chunked = await new Promise((resolve, reject) => {
      const req = http.request(`${small.base}/render`, {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
      });
      req.on("response", (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
      });
      req.on("error", reject);
      req.write("[");
      req.write(`"${"x".repeat(300)}"`);
      req.end("]");
    });
    assert.equal(chunked.status, 413);
  } finally {
    small.server.closeAllConnections();
    await new Promise((resolve) => small.server.close(resolve));
  }
});
