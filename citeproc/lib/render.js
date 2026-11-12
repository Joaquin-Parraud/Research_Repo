"use strict";
/**
 * Rendering with citeproc-js engines that are built once and reused.
 *
 * Building an engine (parsing the style into token lists) takes ~0.6 s, so there is one engine
 * per (locale, style tree) and requests reuse it. citeproc-js engines are stateful: the
 * registered items, disambiguation results and year suffixes live in the engine. Each request
 * therefore starts from an empty document state (`restoreProcessorState()`) and registers exactly
 * the items it sent, unless the engine already holds exactly that set (same items, same data,
 * same order: compared by a SHA-256 of the normalised items), which makes repeated citations
 * from one project cheap. Requests are handled one at a time (rendering is synchronous and
 * Node is single-threaded), so no state is shared between two requests in flight.
 *
 * If the processor throws, the engines involved are thrown away (rebuilt on next use), because
 * an exception can leave citeproc-js's output queues half-filled. The items are then tried one
 * by one to find the ones the processor cannot handle. If none of them was asked for, the
 * request is answered without them (reported in `excluded_ids`) so one broken source does not
 * break the citations of a whole project; otherwise the request fails with their ids.
 */

const crypto = require("node:crypto");
const { CSL, OUTPUT_FORMAT } = require("./citeproc");
const { retrieveLocale, styleTree, LOCALES } = require("./style");
const { clean } = require("./html");

class RenderFailed extends Error {
  constructor(ids, cause) {
    super(`the processor could not render: ${ids.length ? ids.join(", ") : "(no single item)"}`);
    this.name = "RenderFailed";
    this.ids = ids;
    this.cause = cause;
  }
}

class EngineSlot {
  constructor(cslLocale, kind) {
    this.cslLocale = cslLocale;
    this.kind = kind;
    this.engine = null;
    this.scopeKey = null;
    this.items = new Map();
  }

  build() {
    const sys = {
      retrieveLocale,
      retrieveItem: (id) => this.items.get(String(id)),
    };
    const engine = new CSL.Engine(sys, styleTree(this.kind), this.cslLocale, true);
    engine.setOutputFormat(OUTPUT_FORMAT);
    this.engine = engine;
    this.scopeKey = null;
  }

  /** The engine with exactly `items` registered. `scopeKey` null: always register again. */
  prepare(items, scopeKey) {
    if (!this.engine) this.build();
    this.items = items;
    if (scopeKey === null || this.scopeKey !== scopeKey) {
      this.scopeKey = null;
      this.engine.restoreProcessorState();
      this.engine.updateItems([...items.keys()]);
      this.scopeKey = scopeKey;
    }
    return this.engine;
  }

  discard() {
    this.engine = null;
    this.scopeKey = null;
    this.items = new Map();
  }
}

function scopeKeyOf(items) {
  const hash = crypto.createHash("sha256");
  for (const item of items.values()) hash.update(JSON.stringify(item)).update("\u0000");
  return hash.digest("hex");
}

function bibliographyFor(engine, ids, itemCount) {
  let result;
  if (ids === null || ids.length === itemCount) {
    result = engine.makeBibliography();
  } else if (ids.length === 0) {
    return [];
  } else {
    result = engine.makeBibliography({ include: ids.map((id) => ({ field: "id", value: id })) });
  }
  if (!result) throw new Error("the style has no bibliography");
  const [meta, entries] = result;
  return entries.map((markup, index) => {
    const { html, text } = clean(markup);
    return { id: String(meta.entry_ids[index][0]), html, text };
  });
}

class Renderer {
  constructor({ logger = null, failureMemo = 32 } = {}) {
    this.logger = logger;
    this.slots = new Map();
    this.failureMemoSize = failureMemo;
    this.knownFailures = new Map(); // scope key → ids the processor cannot render
  }

  slot(cslLocale, kind) {
    const key = `${cslLocale}/${kind}`;
    let slot = this.slots.get(key);
    if (!slot) {
      slot = new EngineSlot(cslLocale, kind);
      this.slots.set(key, slot);
    }
    return slot;
  }

  /** Build every engine now, so the first requests do not pay for it. */
  warm() {
    for (const cslLocale of new Set(Object.values(LOCALES))) {
      for (const kind of ["reference", "narrative"]) {
        const slot = this.slot(cslLocale, kind);
        if (!slot.engine) slot.build();
      }
    }
  }

  slotsFor(request) {
    const needReference =
      request.bibliography !== null || request.citations.some((c) => c.mode === "parenthetical");
    const needNarrative = request.citations.some((c) => c.mode === "narrative");
    return {
      reference: needReference ? this.slot(request.cslLocale, "reference") : null,
      narrative: needNarrative ? this.slot(request.cslLocale, "narrative") : null,
    };
  }

  renderOnce(request, items, scopeKey) {
    const slots = this.slotsFor(request);
    try {
      const engines = {};
      for (const [kind, slot] of Object.entries(slots)) {
        if (slot) engines[kind] = slot.prepare(items, scopeKey);
      }
      const citations = request.citations.map(({ id, mode }) => {
        const engine = mode === "narrative" ? engines.narrative : engines.reference;
        return { id, mode, text: clean(engine.makeCitationCluster([{ id }])).text };
      });
      const bibliography =
        request.bibliography === null
          ? []
          : bibliographyFor(engines.reference, request.bibliography.ids, items.size);
      return { bibliography, citations };
    } catch (error) {
      for (const slot of Object.values(slots)) slot?.discard();
      throw error;
    }
  }

  /** Ids of the items that make the processor throw when rendered on their own. */
  findFailing(request, items) {
    const slots = Object.values(this.slotsFor(request)).filter(Boolean);
    const failing = [];
    for (const [id, item] of items) {
      for (const slot of slots) {
        try {
          const engine = slot.prepare(new Map([[id, item]]), null);
          engine.makeCitationCluster([{ id }]);
          if (slot.kind === "reference") engine.makeBibliography();
        } catch {
          slot.discard();
          failing.push(id);
          break;
        }
      }
    }
    for (const slot of slots) slot.scopeKey = null;
    return failing;
  }

  remember(scopeKey, failing) {
    this.knownFailures.delete(scopeKey);
    this.knownFailures.set(scopeKey, failing);
    while (this.knownFailures.size > this.failureMemoSize) {
      this.knownFailures.delete(this.knownFailures.keys().next().value);
    }
  }

  /** {bibliography: [{id, html, text}], citations: [{id, mode, text}], excluded_ids: [id]} */
  render(request) {
    const fullKey = scopeKeyOf(request.items);
    const requested = new Set([
      ...(request.bibliography === null
        ? []
        : (request.bibliography.ids ?? [...request.items.keys()])),
      ...request.citations.map((c) => c.id),
    ]);

    let failing = this.knownFailures.get(fullKey);
    if (!failing) {
      try {
        return { ...this.renderOnce(request, request.items, fullKey), excluded_ids: [] };
      } catch (error) {
        this.logger?.warn("render_error", { error: String(error?.message ?? error) });
        failing = this.findFailing(request, request.items);
        if (failing.length === 0) throw new RenderFailed([], error);
        this.remember(fullKey, failing);
      }
    }
    const blocking = failing.filter((id) => requested.has(id));
    if (blocking.length) throw new RenderFailed(blocking);

    const rest = new Map([...request.items].filter(([id]) => !failing.includes(id)));
    const narrowed = {
      ...request,
      bibliography:
        request.bibliography === null
          ? null
          : { ids: request.bibliography.ids ?? [...rest.keys()] },
    };
    try {
      return { ...this.renderOnce(narrowed, rest, scopeKeyOf(rest)), excluded_ids: failing };
    } catch (error) {
      throw new RenderFailed([], error);
    }
  }
}

module.exports = { Renderer, RenderFailed };
