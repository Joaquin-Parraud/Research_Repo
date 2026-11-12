/** Saves text as a file through a temporary object URL. */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
