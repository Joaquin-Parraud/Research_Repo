"use strict";
/**
 * citeproc-js HTML output → safe inline HTML and plain text.
 *
 * The output keeps only <i>, <b>, <sup> and <sub> (no attributes), which is all the backend and
 * the web client accept. citeproc-js's own formatting spans are honoured rather than dropped:
 * `font-style:normal` inside italics (APA's reverse italics, e.g. a species name inside a book
 * title) closes and reopens <i> around the roman text, `font-weight:normal` does the same for
 * <b>. Every other tag is removed and its text kept. Whitespace runs collapse to one space and
 * the result is trimmed. Text is HTML-escaped (&, <, >); `text` is the same content unescaped.
 */

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const ORDER = ["i", "b", "sup", "sub"];

function decodeEntities(value) {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The formatting a tag sets: {italic, bold, vert}; undefined fields are inherited. */
function effectOf(name, attrs) {
  switch (name) {
    case "i":
    case "em":
      return { italic: true };
    case "b":
    case "strong":
      return { bold: true };
    case "sup":
      return { vert: "sup" };
    case "sub":
      return { vert: "sub" };
    case "span": {
      const style = (/style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "").replace(/\s+/g, "");
      const effect = {};
      if (/font-style:normal/i.test(style)) effect.italic = false;
      if (/font-weight:normal/i.test(style)) effect.bold = false;
      if (/vertical-align:baseline|^baseline;?$/i.test(style)) effect.vert = null;
      return effect;
    }
    default:
      return {};
  }
}

/** Text runs with their effective formatting, whitespace collapsed and trimmed. */
function runsOf(markup) {
  const stack = [];
  const runs = [];
  const current = () => {
    const style = { italic: false, bold: false, vert: null };
    for (const frame of stack) {
      for (const key of Object.keys(frame.effect)) style[key] = frame.effect[key];
    }
    return style;
  };
  const pushText = (raw) => {
    if (raw) runs.push({ text: decodeEntities(raw), style: current() });
  };
  let last = 0;
  for (const match of markup.matchAll(TAG)) {
    pushText(markup.slice(last, match.index));
    last = match.index + match[0].length;
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      const index = stack.map((frame) => frame.name).lastIndexOf(name);
      if (index !== -1) stack.length = index;
    } else if (!attrs.trimEnd().endsWith("/") && name !== "br") {
      stack.push({ name, effect: effectOf(name, attrs) });
    }
  }
  pushText(markup.slice(last));

  // Collapse whitespace across run boundaries, then trim both ends.
  let previousSpace = true;
  for (const run of runs) {
    let text = run.text.replace(/\s+/g, " ");
    if (previousSpace && text.startsWith(" ")) text = text.slice(1);
    if (text) previousSpace = text.endsWith(" ");
    run.text = text;
  }
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    if (!runs[i].text) continue;
    runs[i].text = runs[i].text.replace(/ $/, "");
    if (runs[i].text) break;
  }
  return runs.filter((run) => run.text);
}

function tagsFor(style) {
  const tags = [];
  if (style.italic) tags.push("i");
  if (style.bold) tags.push("b");
  if (style.vert) tags.push(style.vert);
  return tags.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

/** {html, text} for one piece of citeproc-js HTML output. */
function clean(markup) {
  const runs = runsOf(String(markup));
  const open = [];
  let html = "";
  let text = "";
  for (const run of runs) {
    const wanted = tagsFor(run.style);
    let keep = 0;
    while (keep < open.length && keep < wanted.length && open[keep] === wanted[keep]) keep += 1;
    while (open.length > keep) html += `</${open.pop()}>`;
    for (const tag of wanted.slice(keep)) {
      html += `<${tag}>`;
      open.push(tag);
    }
    html += escapeHtml(run.text);
    text += run.text;
  }
  while (open.length) html += `</${open.pop()}>`;
  return { html, text };
}

module.exports = { clean, decodeEntities };
