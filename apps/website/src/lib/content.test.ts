import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractDescription,
  renderNoteHtml,
  stripDuplicateTitleHeading
} from "./content";

const fixturePath = fileURLToPath(new URL("../../../../fixtures/website/render-test.md", import.meta.url));
const fixture = readFileSync(fixturePath, "utf8");

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

  it("renders the tracked fixture with exactly one h1 and correct elements", async () => {
    // Real flow passes note.body (front matter already stripped by getNotes).
    const body = fixture.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const html = await renderNoteHtml(body, "测试文章");

    // 1. Page must have exactly one <h1> (the Front Matter title), and the
    //    leading H1 from the body must be removed.
    expect((html.match(/<h1/g) ?? []).length).toBe(0);
    expect(html).not.toContain("<h1>测试文章</h1>");

    // 2. Blockquote must render as <blockquote>, not raw ">"
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<strong>引用内容</strong>");

    // 3. Table must render with thead + tbody and no raw "|" markers
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<th>状态</th>");
    expect(html).toContain("<td><code>PENDING</code></td>");
    expect(html).not.toContain("| 状态 | 含义 |");
    expect(html).not.toContain("| `PENDING` | 等待处理 |");

    // 4. Bold, inline code, fenced code, strikethrough
    expect(html).toContain("<strong>引用内容</strong>");
    expect(html).toContain("<code>PENDING</code>");
    expect(html).toContain("<pre><code");
    expect(html).toContain("<del>删除线</del>");

    // 5. hr from ---
    expect(html).toContain("<hr>");

    // 6. Lists
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>列表一</li>");

    // 7. No raw markdown markers
    expect(html).not.toContain("> **引用内容**");
    expect(html).not.toContain("~~删除线~~");
  });

  it("does not remove later H1 headings or H2/H3", async () => {
    const markdown = "# 页面标题\n\n## 第一章\n\n# 备用标题\n\n### 小节";
    const html = await renderNoteHtml(markdown, "页面标题");

    // The leading H1 is removed, but the later H1 and H2/H3 remain.
    expect(html).not.toContain("<h1>页面标题</h1>");
    expect(html).toContain("<h1>备用标题</h1>");
    expect(html).toContain("<h2>第一章</h2>");
    expect(html).toContain("<h3>小节</h3>");
  });

  it("keeps leading code blocks intact (no regex false positive)", async () => {
    const markdown = "```js\n# not a heading\n```\n\n正文内容";
    const html = await renderNoteHtml(markdown, "测试");
    expect(html).toContain("# not a heading");
    expect(html).toContain("<pre><code");
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
