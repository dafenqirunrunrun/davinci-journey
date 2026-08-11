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

/**
 * Given a candidate slug and the set of slugs already in use, return a slug
 * that does not collide: keep the candidate when it is free, otherwise append
 * `-2`, `-3`, ... until a free one is found. Comparison is case-insensitive
 * and trimmed, matching how the website build resolves note URLs.
 */
export function ensureUniqueSlug(candidate: string, existing: readonly string[]): string {
  const used = new Set(existing.map((value) => value.trim().toLowerCase()));
  const base = candidate.trim().toLowerCase() || "untitled-note";
  if (!used.has(base)) {
    return base;
  }
  let suffix = 2;
  let next = `${base}-${suffix}`;
  while (used.has(next)) {
    suffix += 1;
    next = `${base}-${suffix}`;
  }
  return next;
}

export function toArchiveProfileId(categorySlug: string, topicSlug: string): string {
  return `${categorySlug}-${topicSlug}`;
}
