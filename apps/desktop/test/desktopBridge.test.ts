import { describe, expect, it, vi } from "vitest";
import { createBrowserBridge, createTauriBridge, desktopErrorMessage, isCancelError } from "../src/desktopBridge";

function markdownFile(content = "# LangGraph\n\n![图](./a.png)") {
  return new File([content], "note.md", { type: "text/markdown", lastModified: Date.UTC(2026, 6, 30) });
}

describe("DesktopBridge", () => {
  it("browser fallback reads markdown and fingerprints it", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(markdownFile()));
    const selected = await bridge.selectMarkdownFile();
    expect(selected.fileName).toBe("note.md");
    expect(selected.sourceFingerprint).toHaveLength(64);
  });

  it("cancel does not become a red error", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(undefined));
    await expect(bridge.selectMarkdownFile()).rejects.toMatchObject({ code: "FILE_SELECTION_CANCELLED" });
    try {
      await bridge.selectMarkdownFile();
    } catch (error) {
      expect(isCancelError(error)).toBe(true);
    }
  });

  it("maps error codes to Chinese messages", () => {
    expect(desktopErrorMessage({ code: "IMAGE_NOT_FOUND", message: "", recoverable: true })).toContain("找不到");
  });

  it("browser fallback marks local images as missing", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(markdownFile()));
    const result = await bridge.resolveImageDependencies({
      markdownFile: await bridge.selectMarkdownFile(),
      references: [{ id: "image-001", raw: "./a.png", source: "./a.png", type: "markdown", pathKind: "relative" }]
    });
    expect(result[0]?.status).toBe("missing");
  });

  it("browser fallback keeps remote image status", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(markdownFile()));
    const result = await bridge.resolveImageDependencies({
      markdownFile: await bridge.selectMarkdownFile(),
      references: [{ id: "image-001", raw: "https://example.com/a.png", source: "https://example.com/a.png", type: "remote", pathKind: "remote" }]
    });
    expect(result[0]?.status).toBe("remote");
  });

  it("browser fallback blocks workspace generation", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(markdownFile()));
    await expect(
      bridge.generatePublishWorkspace({
        repositoryRoot: "",
        sourceMarkdownPath: "",
        sourceFingerprint: "",
        markdownContent: "",
        article: { title: "", description: "", slug: "note", tags: [], date: "2026-07-30", updated: "2026-07-30", draft: false, featured: false },
        archiveProfile: { id: "uncategorized", name: "Other", category: "Other", topic: "Uncategorized", directory: "content/other/uncategorized", defaultTags: [] },
        imageReferences: [],
        dependencies: [],
        pendingArchiveProfiles: []
      })
    ).rejects.toMatchObject({ code: "WORKSPACE_CREATE_FAILED" });
  });

  it("uses the stable Tauri reveal_publish_workspace command", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const bridge = createTauriBridge();
    await bridge.revealPublishWorkspace("C:/tmp/workspace");
    expect(invoke).toHaveBeenCalledWith("reveal_publish_workspace", { path: "C:/tmp/workspace" });
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("reload markdown updates draft source through new selection", async () => {
    const picker = vi.fn().mockResolvedValueOnce(markdownFile("# A")).mockResolvedValueOnce(markdownFile("# B"));
    const bridge = createBrowserBridge(picker);
    expect((await bridge.selectMarkdownFile()).content).toBe("# A");
    expect((await bridge.selectMarkdownFile()).content).toBe("# B");
  });
});
