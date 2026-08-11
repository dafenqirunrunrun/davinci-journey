import { describe, expect, it } from "vitest";
import { ensureUniqueSlug, isSafeSlug, slugify } from "../src";

describe("slugify", () => {
  it("drops Chinese, lowercases and hyphenates", () => {
    expect(slugify("每日学习 8.11 Agent 状态")).toBe("8-11-agent");
  });
});

describe("isSafeSlug", () => {
  it("accepts hyphenated lowercase slugs and rejects reserved segments", () => {
    expect(isSafeSlug("daily-learning-8-11")).toBe(true);
    expect(isSafeSlug("public")).toBe(false);
    expect(isSafeSlug("a b")).toBe(false);
  });
});

describe("ensureUniqueSlug", () => {
  it("keeps a free slug unchanged", () => {
    expect(ensureUniqueSlug("8", ["7", "9"])).toBe("8");
  });

  it("appends -2 to the first collision", () => {
    expect(ensureUniqueSlug("8", ["8", "7"])).toBe("8-2");
  });

  it("keeps incrementing past later collisions", () => {
    expect(ensureUniqueSlug("8", ["8", "8-2", "8-3"])).toBe("8-4");
  });

  it("compares case-insensitively", () => {
    expect(ensureUniqueSlug("Agent", ["agent"])).toBe("agent-2");
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(ensureUniqueSlug("  8  ", ["8"])).toBe("8-2");
  });

  it("falls back to untitled-note for an empty candidate", () => {
    expect(ensureUniqueSlug("   ", [])).toBe("untitled-note");
  });

  it("dedupes the untitled-note fallback too", () => {
    expect(ensureUniqueSlug("   ", ["untitled-note"])).toBe("untitled-note-2");
  });
});
