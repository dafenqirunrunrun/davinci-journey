import { describe, expect, it } from "vitest";
import { rewriteMarkdownImages } from "../src";

describe("rewriteMarkdownImages", () => {
  it("rewrites markdown image source", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: "![图](./a.png)", rewrites: [{ referenceId: "image-001", nextSource: "/assets/notes/a/01-a.webp" }] });
    expect(output).toBe("![图](/assets/notes/a/01-a.webp)");
  });

  it("preserves title", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: '![图](./a.png "标题")', rewrites: [{ referenceId: "image-001", nextSource: "/assets/a.webp" }] });
    expect(output).toContain('"标题"');
  });

  it("rewrites html img src", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: '<img src="./a.png" alt="图">', rewrites: [{ referenceId: "image-001", nextSource: "/assets/a.webp" }] });
    expect(output).toContain('src="/assets/a.webp"');
  });

  it("rewrites obsidian image to markdown", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: "![[a.png]]", rewrites: [{ referenceId: "image-001", nextSource: "/assets/a.webp" }] });
    expect(output).toBe("![a.png](/assets/a.webp)");
  });

  it("keeps remote images", () => {
    const input = "![图](https://example.com/a.png)";
    expect(rewriteMarkdownImages({ fileName: "a.md", content: input, rewrites: [] })).toBe(input);
  });

  it("does not rewrite fenced code", () => {
    const input = "```markdown\n![图](./a.png)\n```\n![图](./a.png)";
    const output = rewriteMarkdownImages({ fileName: "a.md", content: input, rewrites: [{ referenceId: "image-001", nextSource: "/assets/a.webp" }] });
    expect(output).toContain("```markdown\n![图](./a.png)\n```");
  });

  it("rewrites only selected reference", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: "![a](./a.png)\n![b](./b.png)", rewrites: [{ referenceId: "image-002", nextSource: "/assets/b.webp" }] });
    expect(output).toContain("![a](./a.png)");
    expect(output).toContain("![b](/assets/b.webp)");
  });

  it("preserves alt text", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: "![architecture](./a.png)", rewrites: [{ referenceId: "image-001", nextSource: "/assets/a.webp" }] });
    expect(output).toContain("![architecture]");
  });

  it("keeps content without matching rewrite unchanged", () => {
    const input = "No image";
    expect(rewriteMarkdownImages({ fileName: "a.md", content: input, rewrites: [{ referenceId: "image-001", nextSource: "/assets/a.webp" }] })).toBe(input);
  });

  it("handles encoded spaces in source", () => {
    const output = rewriteMarkdownImages({ fileName: "a.md", content: "![图](./my%20image.png)", rewrites: [{ referenceId: "image-001", nextSource: "/assets/my-image.webp" }] });
    expect(output).toContain("/assets/my-image.webp");
  });
});
