import { describe, expect, it } from "vitest";
import { normalizeLeadingTitleHeading } from "../src/normalize";

describe("normalizeLeadingTitleHeading", () => {
  it("removes the leading H1 when Front Matter title exists", () => {
    const input = "# Agent Runtime 与工具调用笔记（7.30）\n\n> 核心思想\n\n## 一、可靠执行";
    const result = normalizeLeadingTitleHeading(input, true);
    expect(result).not.toContain("# Agent Runtime 与工具调用笔记（7.30）");
    expect(result).toContain("> 核心思想");
    expect(result).toContain("## 一、可靠执行");
  });

  it("does nothing when there is no Front Matter title", () => {
    const input = "# Agent Runtime\n\n正文";
    expect(normalizeLeadingTitleHeading(input, false)).toBe(input);
  });

  it("does not modify content when the first node is not an H1", () => {
    const input = "> 引用开头\n\n# 后面的标题";
    expect(normalizeLeadingTitleHeading(input, true)).toBe(input);
  });

  it("does not touch # inside a leading code block", () => {
    const input = "```ts\n# not a heading\n```\n\n正文";
    const result = normalizeLeadingTitleHeading(input, true);
    expect(result).toBe(input);
  });

  it("does not remove a later H1", () => {
    const input = "## 开头不是 H1\n\n# 后面的 H1";
    const result = normalizeLeadingTitleHeading(input, true);
    expect(result).toBe(input);
  });

  it("handles leading blank lines before the H1", () => {
    const input = "\n\n# 标题\n\n正文";
    const result = normalizeLeadingTitleHeading(input, true);
    expect(result).not.toContain("# 标题");
    expect(result).toContain("正文");
  });

  it("is safe to run on agent-runtime-7 output", () => {
    // The published article's body begins with an H1 that duplicates the title.
    const input = [
      "# Agent Runtime 与工具调用笔记（7.30）",
      "",
      "> **核心思想：将“模型能想”转化为“系统能做”。**",
      "",
      "## 目录",
      "",
      "- [一、可靠执行](#一可靠执行)"
    ].join("\n");

    const result = normalizeLeadingTitleHeading(input, true);
    expect(result).not.toContain("# Agent Runtime 与工具调用笔记（7.30）");
    expect(result).toContain("> **核心思想");
    expect(result).toContain("## 目录");
    expect(result).toContain("- [一、可靠执行]");
  });
});
