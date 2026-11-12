"use strict";
/**
 * Validation of POST /render bodies, and the item normalisation the processor needs.
 *
 * Body:
 *   {
 *     "locale": "en-US" | "es",
 *     "items": [CSL-JSON item with a unique string "id", ...],
 *     "bibliography": {"ids": [id, ...]},           // optional; without "ids": every item
 *     "citations": [{"id": id, "mode": "parenthetical" | "narrative"}, ...]   // optional
 *   }
 *
 * Every item sent takes part in disambiguation (year suffixes, added names or initials), so the
 * caller controls the disambiguation scope by what it sends: a whole project for one source's
 * citation, the exported sources for a bibliography.
 */

const { LOCALES } = require("./style");

const MAX_ITEMS = 20_000;
const MAX_CITATIONS = 1_000;
const MAX_ID_LENGTH = 256;
const MODES = new Set(["parenthetical", "narrative"]);
const TOP_LEVEL = new Set(["locale", "items", "bibliography", "citations"]);

const NAME_VARIABLES = new Set([
  "author", "chair", "collection-editor", "compiler", "composer", "container-author",
  "contributor", "curator", "director", "editor", "editorial-director", "editor-translator",
  "executive-producer", "guest", "host", "illustrator", "interviewer", "narrator", "organizer",
  "original-author", "performer", "producer", "recipient", "reviewed-author", "script-writer",
  "series-creator", "translator",
]);
const DATE_VARIABLES = new Set([
  "accessed", "available-date", "event-date", "issued", "original-date", "submitted",
]);

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequest";
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function checkId(value, where) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new BadRequest(`${where} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}

/**
 * The item as citeproc-js can take it. CSL-JSON allows numbers for variables such as
 * `volume` or `page`, but citeproc-js 2.4 throws on them ("num.match is not a function"), so
 * numbers become strings. Values that are not CSL variables at all (booleans, objects, arrays
 * outside name and date variables) are dropped: citeproc-js ignores most of them but throws on
 * some. Names and dates are passed through; the processor reads them as they are.
 */
function normalizeItem(item) {
  const out = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "id") continue;
    if (NAME_VARIABLES.has(key)) {
      if (Array.isArray(value)) out[key] = value.filter(isPlainObject);
    } else if (DATE_VARIABLES.has(key)) {
      if (isPlainObject(value)) out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = String(value);
    }
  }
  out.id = item.id;
  return out;
}

/** {locale, cslLocale, items: Map(id → item), bibliography: null | {ids: null | [id]}, citations} */
function parseRenderRequest(body) {
  if (!isPlainObject(body)) throw new BadRequest("the body must be a JSON object");
  for (const key of Object.keys(body)) {
    if (!TOP_LEVEL.has(key)) throw new BadRequest(`unknown field: ${key}`);
  }
  if (!Object.hasOwn(LOCALES, body.locale)) {
    throw new BadRequest(`locale must be one of: ${Object.keys(LOCALES).join(", ")}`);
  }
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) {
    throw new BadRequest(`items must be an array of at most ${MAX_ITEMS} CSL-JSON items`);
  }
  const items = new Map();
  body.items.forEach((item, index) => {
    if (!isPlainObject(item)) throw new BadRequest(`items[${index}] must be an object`);
    const id = checkId(item.id, `items[${index}].id`);
    if (items.has(id)) throw new BadRequest(`duplicate item id: ${id}`);
    if (typeof item.type !== "string" || !item.type) {
      throw new BadRequest(`items[${index}].type must be a CSL item type`);
    }
    items.set(id, normalizeItem(item));
  });
  const known = (id, where) => {
    checkId(id, where);
    if (!items.has(id)) throw new BadRequest(`${where} is not one of the items: ${id}`);
    return id;
  };

  let bibliography = null;
  if (body.bibliography !== undefined) {
    if (!isPlainObject(body.bibliography)) throw new BadRequest("bibliography must be an object");
    for (const key of Object.keys(body.bibliography)) {
      if (key !== "ids") throw new BadRequest(`unknown field: bibliography.${key}`);
    }
    const { ids } = body.bibliography;
    if (ids === undefined) {
      bibliography = { ids: null };
    } else if (Array.isArray(ids)) {
      bibliography = {
        ids: [...new Set(ids.map((id, i) => known(id, `bibliography.ids[${i}]`)))],
      };
    } else {
      throw new BadRequest("bibliography.ids must be an array of item ids");
    }
  }

  const citations = [];
  if (body.citations !== undefined) {
    if (!Array.isArray(body.citations) || body.citations.length > MAX_CITATIONS) {
      throw new BadRequest(`citations must be an array of at most ${MAX_CITATIONS} entries`);
    }
    body.citations.forEach((citation, index) => {
      if (!isPlainObject(citation)) throw new BadRequest(`citations[${index}] must be an object`);
      for (const key of Object.keys(citation)) {
        if (key !== "id" && key !== "mode") {
          throw new BadRequest(`unknown field: citations[${index}].${key}`);
        }
      }
      const id = known(citation.id, `citations[${index}].id`);
      if (!MODES.has(citation.mode)) {
        throw new BadRequest(`citations[${index}].mode must be "parenthetical" or "narrative"`);
      }
      citations.push({ id, mode: citation.mode });
    });
  }

  return {
    locale: body.locale,
    cslLocale: LOCALES[body.locale],
    items,
    bibliography,
    citations,
  };
}

module.exports = { BadRequest, parseRenderRequest, normalizeItem, MAX_ITEMS };
