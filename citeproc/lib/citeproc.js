"use strict";
/**
 * citeproc-js, with two narrowly scoped adjustments. Neither touches the style or the locales,
 * and neither edits rendered output.
 *
 * 1. Output format "rrhtml": citeproc-js's own "html" format, except that text is escaped
 *    without turning Unicode superscript characters into <sup> markup. The stock format rewrites
 *    "ª", "²", "™" … as "<sup>a</sup>", "<sup>2</sup>", "<sup>TM</sup>", so the Spanish edition
 *    "6.ª ed." would read "6.a ed." as plain text and "E = mc²" would become "E = mc2".
 *
 * 2. Leading articles in bibliography sort keys. citeproc-js means to ignore a leading "A", "An"
 *    or "The" when sorting (`CSL.Util.Sort.strip_prepositions`), but its sort keys separate words
 *    with "|", which that function's /^(the)\s+/ never matches, so it has no effect. APA 7 sorts
 *    works by the same author and year by title ignoring those articles (9.47), and a work whose
 *    title stands in for the author by the first significant word (9.46). The fix strips the
 *    article from the key of the style's `title` sort macro, and from the author key only when
 *    that key is the title (title in the author position), never from personal or group names.
 */

const CSL = require("citeproc");

const OUTPUT_FORMAT = "rrhtml";
const LEADING_ARTICLE = /^(?:a|an|the)\|/i;

if (!CSL.Output.Formats[OUTPUT_FORMAT]) {
  CSL.Output.Formats[OUTPUT_FORMAT] = {
    ...CSL.Output.Formats.html,
    text_escape(text) {
      return (text || "").replace(/&/g, "&#38;").replace(/</g, "&#60;").replace(/>/g, "&#62;");
    },
  };
}

let sortKeyPositions = null;

/** `positions`: indexes of the author-sort and title keys in the style's bibliography sort. */
function installArticleSortFix(positions) {
  if (sortKeyPositions) {
    sortKeyPositions = positions;
    return;
  }
  sortKeyPositions = positions;
  const original = CSL.getSortKeys;
  CSL.getSortKeys = function getSortKeys(Item, keyType) {
    const keys = original.call(this, Item, keyType);
    if (keyType !== "bibliography_sort" || !Array.isArray(keys)) return keys;
    const { author, title } = sortKeyPositions;
    const titleKey = typeof keys[title] === "string" ? keys[title] : "";
    if (!LEADING_ARTICLE.test(titleKey)) return keys;
    if (typeof keys[author] === "string" && keys[author].startsWith(titleKey)) {
      keys[author] = keys[author].replace(LEADING_ARTICLE, "");
    }
    keys[title] = titleKey.replace(LEADING_ARTICLE, "");
    return keys;
  };
}

module.exports = { CSL, OUTPUT_FORMAT, installArticleSortFix };
