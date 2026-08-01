import { describe, expect, it } from "vitest";
import { extractDescription, renderNoteHtml, stripDuplicateTitleHeading } from "./content";

describe("website markdown rendering", () => {
  it("renders GFM blockquotes and tables", async () => {
    const html = await renderNoteHtml(
      [
        "> 重要提示",
        "",
        "| 名称 | 说明 |",
        "| --- | --- |",
        "| Runtime | 工具调用 |"
      ].join("\n"),
      "Agent Runtime"
    );

    expect(html).toContain("<blockquote>");
    expect(html).toContain("<table>");
    expect(html).not.toContain("&gt; 重要提示");
    expect(html).not.toContain("| 名称 | 说明 |");
  });

  it("removes the first duplicated H1", async () => {
    const markdown = "# Agent Runtime 与工具调用笔记（7.30）\n\n正文内容";

    expect(stripDuplicateTitleHeading(markdown, "Agent Runtime 与工具学习笔记")).toBe("正文内容");
    await expect(renderNoteHtml(markdown, "Agent Runtime 与工具学习笔记")).resolves.not.toContain("<h1>");
  });

  it("extracts a fallback description from markdown body", () => {
    const description = extractDescription(
      "# Agent Runtime 与工具调用笔记（7.30）\n\n> 核心思想：让模型输出变成可控、可追踪、可恢复的系统动作。",
      "Agent Runtime 与工具学习笔记"
    );

    expect(description).toContain("核心思想");
    expect(description).not.toContain("这篇笔记尚未填写摘要");
  });
});
