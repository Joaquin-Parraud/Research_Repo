"use strict";
/**
 * The official APA 7 style and CSL locales (vendored, unmodified, in ../data), parsed once.
 *
 * Two style trees are used (the processor itself is set up in citeproc.js):
 *  - "reference": apa.csl exactly as published. Reference list and parenthetical citations.
 *  - "narrative": apa.csl with only its in-text citation layout changed, built in memory:
 *    the layout prints `author-short` followed by `(date-short)`, and in that macro the names
 *    are joined with the locale's word for "and" ("and" / "y") instead of "&". Everything else
 *    (names, et al., disambiguation, sorting, year suffixes) is the official style's.
 *
 * Why not citeproc-js's own author-only / suppress-author modes: author-only renders the same
 * `author-short` macro, so it gives "García & Smith", and it drops the formatting of a title used
 * in place of the author (`“Anonymous Article”` becomes `Anonymous Article`). citeproc-js's
 * `cs:intext` hook does not inherit the citation's name options, so it prints all three authors
 * instead of "et al." and "J Smith" instead of "J. Smith".
 */

const fs = require("node:fs");
const path = require("node:path");
const { CSL, installArticleSortFix } = require("./citeproc");

const DATA_DIR = path.join(__dirname, "..", "data");

/** Project citation locale → CSL locale. `es` is neutral Spanish: CSL's primary es-ES. */
const LOCALES = Object.freeze({ "en-US": "en-US", es: "es-ES" });

const localeXml = new Map();
for (const csl of new Set(Object.values(LOCALES))) {
  localeXml.set(csl, fs.readFileSync(path.join(DATA_DIR, `locales-${csl}.xml`), "utf8"));
}

/** For citeproc-js's `sys.retrieveLocale`. Anything we do not ship is "not available". */
function retrieveLocale(lang) {
  return localeXml.get(lang) ?? false;
}

const referenceTree = CSL.parseXml(fs.readFileSync(path.join(DATA_DIR, "apa.csl"), "utf8"));

function findChild(node, name, attrs = {}) {
  return (node.children || []).find(
    (child) =>
      typeof child === "object" &&
      child.name === name &&
      Object.entries(attrs).every(([key, value]) => child.attrs?.[key] === value),
  );
}

function element(name, attrs, children = []) {
  return { name, attrs, children };
}

function buildNarrativeTree(reference) {
  const tree = structuredClone(reference);
  const layout = findChild(findChild(tree, "citation") ?? {}, "layout");
  const macro = findChild(tree, "macro", { name: "author-short" });
  if (!layout || !macro) {
    throw new Error("apa.csl does not have the expected citation layout");
  }
  delete layout.attrs.prefix;
  delete layout.attrs.suffix;
  layout.children = [
    element("group", { delimiter: " " }, [
      element("text", { macro: "author-short" }),
      element("group", { prefix: "(", suffix: ")", delimiter: ", " }, [
        element("text", { macro: "date-short" }),
        element("text", { macro: "label-locator" }),
      ]),
    ]),
  ];
  const visit = (node) => {
    if (node.name === "name" && node.attrs?.and === "symbol") node.attrs.and = "text";
    for (const child of node.children || []) if (typeof child === "object") visit(child);
  };
  visit(macro);
  return tree;
}

const narrativeTree = buildNarrativeTree(referenceTree);

function bibliographySortPositions(tree) {
  const sort = findChild(findChild(tree, "bibliography") ?? {}, "sort");
  const keys = (sort?.children ?? []).filter((c) => typeof c === "object" && c.name === "key");
  const author = keys.findIndex((key) => key.attrs.macro === "author-sort");
  const title = keys.findIndex((key) => key.attrs.macro === "title");
  if (author === -1 || title === -1) {
    throw new Error("apa.csl does not have the expected bibliography sort keys");
  }
  return { author, title };
}

installArticleSortFix(bibliographySortPositions(referenceTree));

/** A fresh copy of a style tree (citeproc-js may annotate the object it is given). */
function styleTree(kind) {
  if (kind === "reference") return structuredClone(referenceTree);
  if (kind === "narrative") return structuredClone(narrativeTree);
  throw new Error(`unknown style kind: ${kind}`);
}

module.exports = { CSL, LOCALES, retrieveLocale, styleTree };
