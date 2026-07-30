import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src";

describe("parseMarkdown", () => {
  it("解析标准 Markdown 图片", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "![架构图](./images/architecture.png)" });
    expect(doc.imageReferences[0]).toMatchObject({ type: "markdown", pathKind: "relative", source: "./images/architecture.png", alt: "架构图" });
  });

  it("解析带标题图片", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: '![架构图](./images/architecture.png "系统架构")' });
    expect(doc.imageReferences[0]?.title).toBe("系统架构");
  });

  it("解析 HTML img", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: '<img src="./images/architecture.png" alt="架构图">' });
    expect(doc.imageReferences[0]).toMatchObject({ type: "html", source: "./images/architecture.png", alt: "架构图" });
  });

  it("解析 Obsidian 图片", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "![[architecture.png]]" });
    expect(doc.imageReferences[0]).toMatchObject({ type: "obsidian", source: "architecture.png" });
  });

  it("解析 Obsidian 宽度参数", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "![[architecture.png|800]]" });
    expect(doc.imageReferences[0]?.obsidianWidth).toBe(800);
  });

  it("识别网络图片", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "![示例](https://example.com/example.png)" });
    expect(doc.imageReferences[0]).toMatchObject({ type: "remote", pathKind: "remote" });
  });

  it("识别 Base64 图片", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "![示例](data:image/png;base64,AAAA)" });
    expect(doc.imageReferences[0]).toMatchObject({ type: "base64", pathKind: "embedded" });
  });

  it("识别绝对路径", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "![示例](D:/notes/images/example.png)" });
    expect(doc.imageReferences[0]?.pathKind).toBe("absolute");
  });

  it("代码块中的伪图片不会被识别", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "```markdown\n![这不是图片](./fake.png)\n```" });
    expect(doc.imageReferences).toHaveLength(0);
  });

  it("图片行号正确", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "# Title\n\n![图](./a.png)" });
    expect(doc.imageReferences[0]?.line).toBe(3);
  });

  it("Front Matter 正确解析", () => {
    const doc = parseMarkdown({ fileName: "a.md", content: "---\ntitle: Front Matter Title\ntags:\n  - A\n---\n# H1" });
    expect(doc.frontMatter.title).toBe("Front Matter Title");
  });

  it("标题优先级正确", () => {
    const frontMatterTitle = parseMarkdown({ fileName: "a.md", content: "---\ntitle: Front Matter Title\n---\n# H1" });
    const h1Title = parseMarkdown({ fileName: "a.md", content: "# H1" });
    expect(frontMatterTitle.title).toBe("Front Matter Title");
    expect(h1Title.title).toBe("H1");
  });
});
