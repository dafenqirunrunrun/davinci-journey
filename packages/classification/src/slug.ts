const RESERVED_SEGMENTS = new Set([".", "..", "public", "config", "node_modules"]);

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isSafeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !RESERVED_SEGMENTS.has(value);
}

export function toArchiveProfileId(categorySlug: string, topicSlug: string): string {
  return `${categorySlug}-${topicSlug}`;
}
