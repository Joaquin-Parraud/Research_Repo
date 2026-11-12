/** Adds `raw` to `tags` (trimmed, case-insensitive duplicates ignored). Returns the same array if nothing changed. */
export function addTag(tags: readonly string[], raw: string): readonly string[] {
  const tag = raw.trim().replace(/\s+/g, " ");
  if (!tag) return tags;
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((existing) => existing !== tag);
}
