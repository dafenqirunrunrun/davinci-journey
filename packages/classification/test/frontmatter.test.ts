import { describe, expect, it } from "vitest";
import { buildArchiveFrontMatter, writeArchiveFrontMatter } from "../src";

const profile = {
  id: "ai-agent-langgraph",
  name: "AI Agent / LangGraph",
  category: "AI Agent",
  topic: "LangGraph",
  directory: "content/ai-agent/langgraph",
  defaultTags: ["AI Agent", "LangGraph"]
};

const article = {
  title: "LangGraph Checkpoint",
  description: "State recovery",
  slug: "langgraph-checkpoint",
  tags: ["LangGraph"],
  date: "2026-07-30",
  updated: "2026-07-30",
  draft: false,
  featured: false
};

describe("archive front matter", () => {
  it("writes archiveProfile", () => {
    expect(writeArchiveFrontMatter("# Title", article, profile)).toContain("archiveProfile: ai-agent-langgraph");
  });

  it("does not duplicate front matter", () => {
    const output = writeArchiveFrontMatter("---\ntitle: Old\n---\n# Title", article, profile);
    expect(output.match(/---/g)).toHaveLength(2);
  });

  it("preserves custom fields", () => {
    const output = writeArchiveFrontMatter("---\nsource: obsidian\n---\n# Title", article, profile);
    expect(output).toContain("source: obsidian");
  });

  it("system fields override draft", () => {
    const output = writeArchiveFrontMatter("---\ncategory: Old\n---\n# Title", article, profile);
    expect(output).toContain("category: AI Agent");
  });

  it("preserves original date", () => {
    const output = writeArchiveFrontMatter("---\ndate: 2025-01-01\n---\n# Title", article, profile);
    expect(output).toContain("date: 2025-01-01");
  });

  it("filters null custom fields", () => {
    const result = buildArchiveFrontMatter({ old: null }, article, profile);
    expect(result.frontMatter.old).toBeUndefined();
  });

  it("warns invalid dates", () => {
    const result = buildArchiveFrontMatter({}, { ...article, updated: "today" }, profile);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not stringify undefined topic", () => {
    const output = writeArchiveFrontMatter("# Title", article, { ...profile, topic: undefined });
    expect(output).not.toContain("topic: undefined");
  });
});
