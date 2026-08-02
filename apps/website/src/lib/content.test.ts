import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractDescription,
  renderNoteHtml,
  resolveDescription,
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

describe("auto excerpt generation (empty description)", () => {
  it("extracts from the first blockquote and excludes TOC links", () => {
    const body = [
      "> **核心思想：将“模型能想”转化为“系统能做”，让模型输出变成可控、可追踪、可恢复的系统动作。**",
      "",
      "## 目录",
      "",
      "- [一、可靠执行](#一可靠执行)",
      "- [二、异步流式](#二异步流式)",
      "- [三、Agent Runtime](#三agent-runtime)",
      "- [四、Structured Outputs](#四structured-outputs)",
      "- [五、MCP](#五mcp)",
      "- [六、Correlation ID](#六correlation-id)",
      "- [七、分层](#七分层)",
      "- [八、术语](#八术语)",
      "",
      "---",
      "",
      "## 一、可靠执行",
      "",
      "重试不能单独使用。"
    ].join("\n");

    const description = extractDescription(body, "Agent Runtime");

    expect(description).toContain("核心思想");
    expect(description).not.toContain("目录");
    expect(description).not.toContain("$1");
    expect(description).not.toContain("一、可靠执行");
    expect(description).not.toContain("可靠执行");
    expect(description).not.toContain("#");
  });

  it("extracts from the first paragraph when no blockquote exists", () => {
    const body = "## 简介\n\n这是一段有意义的正文，用于自动摘要。\n\n## 后续\n\n第二段。";
    const description = extractDescription(body, "测试");
    expect(description).toContain("这是一段有意义的正文");
    expect(description).not.toContain("简介");
    expect(description).not.toContain("$1");
  });

  it("skips TOC before any paragraph", () => {
    const body = [
      "## 目录",
      "",
      "- [一](#一)",
      "- [二](#二)",
      "",
      "## 一、正文",
      "",
      "真正的内容从这里开始。"
    ].join("\n");
    const description = extractDescription(body, "测试");
    expect(description).toContain("真正的内容");
    expect(description).not.toContain("目录");
    expect(description).not.toContain("$1");
  });

  it("skips code blocks, tables and headings", () => {
    const body = [
      "| 状态 | 含义 |",
      "|---|---|",
      "| `PENDING` | 等待 |",
      "",
      "```ts",
      "const value = true;",
      "```",
      "",
      "## 小节",
      "",
      "> 引用内容保留。",
      "",
      "```ts",
      "const second = 2;",
      "```"
    ].join("\n");
    const description = extractDescription(body, "测试");
    expect(description).toContain("引用内容");
    expect(description).not.toContain("PENDING");
    expect(description).not.toContain("const value");
    expect(description).not.toContain("小节");
    expect(description).not.toContain("$1");
  });

  it("converts link labels to plain text without leaking $1", () => {
    const body = "参考 [LangGraph 文档](https://example.com) 了解更多。";
    const description = extractDescription(body, "测试");
    expect(description).toContain("LangGraph 文档");
    expect(description).not.toContain("$1");
    expect(description).not.toContain("https://");
  });

  it("truncates long Chinese text to a readable length", () => {
    const longText = "这是".repeat(200);
    const description = extractDescription(`> ${longText}`, "测试");
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.length).toBeGreaterThan(0);
  });

  it("returns a concise empty state when nothing is extractable", () => {
    const description = extractDescription("```ts\n代码\n```\n\n| a | b |\n|---|---|", "测试");
    expect(description).toBe("暂无摘要。");
    expect(description).not.toContain("$1");
  });

  it("uses a non-empty front matter description directly", () => {
    const result = resolveDescription("手写摘要。", "> 自动摘要\n\n正文", "测试");
    expect(result).toBe("手写摘要。");
  });

  it("triggers auto-excerpt for empty-string description", () => {
    const result = resolveDescription("", "> 自动摘要内容", "测试");
    expect(result).toContain("自动摘要内容");
    expect(result).not.toBe("");
  });

  it("triggers auto-excerpt for whitespace-only description", () => {
    const result = resolveDescription("   ", "> 自动摘要内容", "测试");
    expect(result).toContain("自动摘要内容");
    expect(result).not.toBe("   ");
  });

  it("triggers auto-excerpt for null/undefined description", () => {
    const result = resolveDescription(undefined, "> 自动摘要内容", "测试");
    expect(result).toContain("自动摘要内容");
  });

  it("produces the correct excerpt for the current article body", () => {
    const body = [
      "> **核心思想：将“模型能想”转化为“系统能做”，让模型输出变成可控、可追踪、可恢复的系统动作。**",
      "",
      "## 目录",
      "",
      "- [一、可靠执行：重试、幂等与补偿](#一可靠执行重试幂等与补偿)",
      "- [二、异步、流式、取消与恢复](#二异步流式取消与恢复)",
      "- [三、Agent Runtime](#三agent-runtime)",
      "- [四、Structured Outputs、Function Calling 与 JSON Mode](#四structured-outputsfunction-calling-与-json-mode)",
      "- [五、MCP 与工具服务](#五mcp-与工具服务)",
      "- [六、Correlation ID](#六correlation-id)",
      "- [七、Agent Runtime 分层](#七agent-runtime-分层)",
      "- [八、常见术语](#八常见术语)",
      "",
      "---",
      "",
      "## 一、可靠执行：重试、幂等与补偿"
    ].join("\n");

    const description = extractDescription(body, "Agent Runtime 与工具学习笔记");
    expect(description).toContain("核心思想");
    expect(description).not.toContain("目录");
    expect(description).not.toContain("$1");
    expect(description).not.toContain("可靠执行");
  });
});
