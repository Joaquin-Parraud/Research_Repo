import { Fragment, type ReactNode } from "react";

/**
 * Tiny allowlist renderer for the server's `reference_html`. The HTML is never handed to the DOM:
 * it is tokenised here, only the inline tags below survive (without attributes), text becomes React
 * text nodes, and anything else (scripts, images, handlers, comments…) is dropped.
 */
const ALLOWED_TAGS = ["i", "b", "sup", "sub"] as const;
type AllowedTag = (typeof ALLOWED_TAGS)[number];

/** Tags whose whole content is dropped, not just the tag. */
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript"]);

/** Tags that are treated as the allowed one they stand for. */
const ALIASES: Record<string, AllowedTag> = { em: "i", strong: "b" };

export type SafeNode = string | { tag: AllowedTag; children: SafeNode[] };

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\/?>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function allowedTag(name: string): AllowedTag | null {
  const lower = name.toLowerCase();
  const resolved = ALIASES[lower] ?? lower;
  return (ALLOWED_TAGS as readonly string[]).includes(resolved) ? (resolved as AllowedTag) : null;
}

/** Parses `html` into a tree of text and allowed inline elements. */
export function parseSafeHtml(html: string): SafeNode[] {
  const root: SafeNode[] = [];
  const stack: { tag: AllowedTag; children: SafeNode[] }[] = [];
  const current = () => stack[stack.length - 1]?.children ?? root;
  let skipping: string | null = null;
  let last = 0;

  const pushText = (raw: string) => {
    if (!raw || skipping) return;
    current().push(decodeEntities(raw));
  };

  for (const match of html.matchAll(TOKEN)) {
    pushText(html.slice(last, match.index));
    last = match.index + match[0].length;
    const name = match[1]?.toLowerCase();
    if (name === undefined) continue; // a comment
    const closing = match[0].startsWith("</");

    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    if (DROP_CONTENT.has(name)) {
      if (!closing && !match[0].endsWith("/>")) skipping = name;
      continue;
    }
    const tag = allowedTag(name);
    if (!tag) continue; // unknown tag: drop the tag, keep its text
    if (closing) {
      const open = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (open !== -1) stack.length = open; // closes it and anything left open inside
    } else if (!match[0].endsWith("/>")) {
      const node = { tag, children: [] as SafeNode[] };
      current().push(node);
      stack.push(node);
    }
  }
  pushText(html.slice(last));
  return root;
}

/** Plain-text rendering of a parsed tree. */
export function safeText(nodes: readonly SafeNode[]): string {
  return nodes.map((node) => (typeof node === "string" ? node : safeText(node.children))).join("");
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Re-serialises a parsed tree as clean HTML (escaped text, bare allowed tags): safe for the clipboard. */
export function serializeSafeHtml(nodes: readonly SafeNode[]): string {
  return nodes
    .map((node) =>
      typeof node === "string"
        ? escapeHtml(node)
        : `<${node.tag}>${serializeSafeHtml(node.children)}</${node.tag}>`,
    )
    .join("");
}

function renderNodes(nodes: readonly SafeNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (typeof node === "string") return <Fragment key={index}>{node}</Fragment>;
    const Tag = node.tag;
    return <Tag key={index}>{renderNodes(node.children)}</Tag>;
  });
}

/** Renders server reference HTML as React nodes, allowing only italics, bold, super- and subscript. */
export function SafeHtml({ html }: { html: string }) {
  return <>{renderNodes(parseSafeHtml(html))}</>;
}
