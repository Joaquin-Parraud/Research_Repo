/** Copies plain text. Uses the async Clipboard API, falling back to a hidden textarea. Returns success. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or insecure context: try the legacy path.
  }
  return legacyCopy(value);
}

/**
 * Copies a reference as rich text: `text/html` (italics survive pasting into a word processor) and
 * `text/plain` together. Falls back to plain text when rich clipboard writes are unavailable.
 */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Fall through to plain text.
  }
  return copyText(plain);
}

function legacyCopy(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
