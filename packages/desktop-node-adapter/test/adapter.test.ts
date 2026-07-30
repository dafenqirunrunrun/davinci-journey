import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@davinci-journey/markdown-core";
import { readSelectedMarkdownFile, resolveImageDependencies } from "../src";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function fixture() {
  const root = path.join(os.tmpdir(), `davinci-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}

describe("desktop node adapter", () => {
  it("选择真实 Markdown 后生成文件结构", async () => {
    const root = await fixture();
    const file = path.join(root, "note.md");
    await writeFile(file, "# 标题\n");
    const selected = await readSelectedMarkdownFile(file);
    expect(selected.fileName).toBe("note.md");
    expect(selected.content).toContain("# 标题");
  });

  it("解析 Markdown 同级图片", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "a.png"), png);
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![图](./a.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]).toMatchObject({ status: "resolved", mimeType: "image/png" });
  });

  it("解析子目录图片", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "images"));
    await writeFile(path.join(root, "images", "a.png"), png);
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![图](images/a.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("resolved");
  });

  it("解析上级目录图片", async () => {
    const root = await fixture();
    const sub = path.join(root, "notes");
    await mkdir(sub);
    await writeFile(path.join(root, "a.png"), png);
    const markdown = path.join(sub, "note.md");
    await writeFile(markdown, "![图](../a.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("resolved");
  });

  it("支持中文和空格路径", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "我的 图片"));
    await writeFile(path.join(root, "我的 图片", "图.png"), png);
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![图](./我的%20图片/图.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("resolved");
  });

  it("文件缺失返回 missing", async () => {
    const root = await fixture();
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![图](missing.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("missing");
  });

  it("多个 Obsidian 同名候选返回 ambiguous", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "images"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "images", "a.png"), png);
    await writeFile(path.join(root, "assets", "a.png"), png);
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![[a.png]]");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("ambiguous");
  });

  it("非图片伪装扩展名返回 unsupported", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "a.png"), "not an image");
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![图](a.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("unsupported");
  });

  it("明显路径穿越返回 unsafe", async () => {
    const root = await fixture();
    const markdown = path.join(root, "note.md");
    await writeFile(markdown, "![图](../../../secret.png)");
    const selected = await readSelectedMarkdownFile(markdown);
    const parsed = parseMarkdown({ fileName: selected.fileName, content: selected.content });
    const deps = await resolveImageDependencies({ markdownFile: selected, references: parsed.imageReferences });
    expect(deps[0]?.status).toBe("unsafe");
  });
});
