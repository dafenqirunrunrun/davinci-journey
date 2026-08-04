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

  it("uses explicit Tauri repository target commands", async () => {
    const target = {
      repositoryRoot: "D:/site",
      displayPath: "D:/site",
      branch: "main",
      head: "abc123",
      valid: true,
      errors: []
    };
    const invoke = vi.fn().mockResolvedValue(target);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const bridge = createTauriBridge();

    await bridge.selectRepositoryRoot();
    await bridge.validateRepositoryRoot("D:/site");
    await bridge.loadRepositoryTargetSettings();
    await bridge.discardPublishWorkspace("workspace-id", "D:/site");

    expect(invoke).toHaveBeenCalledWith("select_repository_root", undefined);
    expect(invoke).toHaveBeenCalledWith("validate_repository_root_command", { repositoryRoot: "D:/site" });
    expect(invoke).toHaveBeenCalledWith("load_repository_target_settings", undefined);
    expect(invoke).toHaveBeenCalledWith("discard_publish_workspace", { workspaceId: "workspace-id", repositoryRoot: "D:/site" });
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("reload markdown updates draft source through new selection", async () => {
    const picker = vi.fn().mockResolvedValueOnce(markdownFile("# A")).mockResolvedValueOnce(markdownFile("# B"));
    const bridge = createBrowserBridge(picker);
    expect((await bridge.selectMarkdownFile()).content).toBe("# A");
    expect((await bridge.selectMarkdownFile()).content).toBe("# B");
  });

  it("browser batch selection returns metadata and filters non-markdown", async () => {
    const multiPicker = () =>
      Promise.resolve([
        new File(["# A"], "a.md", { type: "text/markdown" }),
        new File(["# B"], "b.markdown", { type: "text/markdown" }),
        new File(["skip"], "c.txt", { type: "text/plain" })
      ]);
    const bridge = createBrowserBridge(() => Promise.resolve(undefined), multiPicker);
    const selected = await bridge.selectMarkdownFiles();
    expect(selected.map((item) => item.displayName)).toEqual(["a.md", "b.markdown"]);
    expect(selected[0]?.size).toBeGreaterThan(0);
  });

  it("browser batch selection returns empty array when nothing is picked", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(undefined), () => Promise.resolve([]));
    await expect(bridge.selectMarkdownFiles()).resolves.toEqual([]);
  });

  it("browser batch readMarkdownPath is blocked in preview mode", async () => {
    const bridge = createBrowserBridge(() => Promise.resolve(undefined));
    await expect(bridge.readMarkdownPath({ path: "C:/notes/a.md" })).rejects.toMatchObject({
      code: "WORKSPACE_CREATE_FAILED"
    });
  });

  it("tauri batch commands are wired to the expected invoke calls", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const bridge = createTauriBridge();

    await bridge.selectMarkdownFiles();
    await bridge.readMarkdownPath({ path: "C:/notes/a.md", maxBytes: 1024 });
    const persisted = {
      batchId: "batch-1",
      status: "reviewing" as const,
      items: [],
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      batchCommitHashes: [],
      savedAt: "2026-08-04T00:00:00.000Z"
    };
    await bridge.saveBatchPublishState("batch-1", persisted);
    await bridge.loadBatchPublishState("batch-1");
    await bridge.listBatchPublishStates();
    await bridge.deleteBatchPublishState("batch-1");

    expect(invoke).toHaveBeenCalledWith("select_markdown_files", undefined);
    expect(invoke).toHaveBeenCalledWith("read_markdown_path", { request: { path: "C:/notes/a.md", maxBytes: 1024 } });
    expect(invoke).toHaveBeenCalledWith("save_batch_publish_state", { batchId: "batch-1", payload: persisted });
    expect(invoke).toHaveBeenCalledWith("load_batch_publish_state", { batchId: "batch-1" });
    expect(invoke).toHaveBeenCalledWith("list_batch_publish_states", undefined);
    expect(invoke).toHaveBeenCalledWith("delete_batch_publish_state", { batchId: "batch-1" });
    vi.doUnmock("@tauri-apps/api/core");
  });
});
