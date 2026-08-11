import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "./desktopBridge";
import type { BatchPublishPersistedState, BatchPublishState } from "./batchPublishTypes";
import type { PublishDraft } from "./publishState";
import { addItemsToBatch, attachDraft, createEmptyBatchState, markItemReady } from "./batchPublishEngine";
import { createBatchPublishPersistence, stripBatchForPersistence } from "./batchPublishPersistence";

function stateWithSensitiveDraft(): BatchPublishState {
  const draft: PublishDraft = {
    id: "draft-a",
    source: {
      markdownFile: {
        absolutePath: "C:/notes/a.md",
        fileName: "a.md",
        directoryPath: "C:/notes",
        size: 100,
        content: "# 私人正文 SECRET_CONTENT_BODY"
      }
    },
    assets: { dependencies: [], userResolutions: {} },
    article: { title: "Title A", description: "", slug: "a", tags: [], date: "2026-07-30", updated: "2026-07-30", draft: false, featured: false },
    archive: { selectedProfileId: "uncategorized", recommendedProfileIds: [], pendingProfileChanges: [] },
    preview: {},
    repository: {},
    remote: { status: "idle", repositoryRoot: "", remoteName: "origin", branch: "master", localCommitHash: "" },
    status: "ready"
  };
  let state = createEmptyBatchState(() => "batch-1");
  state = addItemsToBatch(state, [{ sourcePath: "C:/notes/a.md", displayName: "a.md" }], () => "id-a");
  state = attachDraft(state, "id-a", draft);
  state = markItemReady(state, "id-a");
  return state;
}

function stubBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    mode: "browser",
    selectMarkdownFile: vi.fn(),
    selectMarkdownFiles: vi.fn(),
    readMarkdownPath: vi.fn(),
    saveBatchPublishState: vi.fn(),
    loadBatchPublishState: vi.fn(),
    listBatchPublishStates: vi.fn(),
    deleteBatchPublishState: vi.fn(),
    resolveImageDependencies: vi.fn(),
    generatePublishWorkspace: vi.fn(),
    discardPublishWorkspace: vi.fn(),
    revealPublishWorkspace: vi.fn(),
    inspectRepositoryPublish: vi.fn(),
    applyPublishWorkspace: vi.fn(),
    getPublishDiff: vi.fn(),
    stagePublishTransaction: vi.fn(),
    commitPublishTransaction: vi.fn(),
    rollbackRepositoryPublish: vi.fn(),
    inspectPublishLock: vi.fn(),
    cleanupStalePublishLock: vi.fn(),
    resolveRepositoryRoot: vi.fn(),
    selectRepositoryRoot: vi.fn(),
    validateRepositoryRoot: vi.fn(),
    loadRepositoryTargetSettings: vi.fn(),
    loadArchiveProfiles: vi.fn(),
    loadExistingNoteSlugs: vi.fn(),
    inspectRemotePublish: vi.fn(),
    pushPublishCommit: vi.fn(),
    checkGithubPagesDeployment: vi.fn(),
    waitGithubPagesDeployment: vi.fn(),
    verifyPublicArticle: vi.fn(),
    getPublicArticleUrl: vi.fn(),
    resetPublishFlow: vi.fn(),
    ...overrides
  };
}

describe("stripBatchForPersistence", () => {
  it("never persists markdown body", () => {
    const stripped = stripBatchForPersistence(stateWithSensitiveDraft());
    expect(JSON.stringify(stripped)).not.toContain("SECRET_CONTENT_BODY");
    expect(JSON.stringify(stripped)).not.toContain("# 私人正文");
  });

  it("keeps queue metadata and commit references", () => {
    const stripped = stripBatchForPersistence(stateWithSensitiveDraft());
    const first = stripped.items[0];
    expect(stripped.batchId).toBe("batch-1");
    expect(first?.sourcePath).toBe("C:/notes/a.md");
    expect(first?.displayName).toBe("a.md");
    expect(first?.title).toBe("Title A");
    expect(first?.slug).toBe("a");
    expect(first?.archiveProfileId).toBe("uncategorized");
  });
});

describe("createBatchPublishPersistence", () => {
  it("saves a stripped snapshot through the bridge", async () => {
    const save = vi.fn();
    const bridge = stubBridge({ saveBatchPublishState: save });
    const persistence = createBatchPublishPersistence(bridge);
    await persistence.save(stateWithSensitiveDraft());
    expect(save).toHaveBeenCalledTimes(1);
    const call = save.mock.calls[0] as unknown as [string, unknown];
    expect(call[0]).toBe("batch-1");
    expect(JSON.stringify(call[1])).not.toContain("SECRET_CONTENT_BODY");
  });

  it("loads a previously saved batch", async () => {
    const load = vi.fn(async (): Promise<BatchPublishPersistedState> => ({
      batchId: "batch-1",
      status: "paused",
      items: [],
      completedCount: 0,
      failedCount: 1,
      skippedCount: 0,
      batchCommitHashes: [],
      savedAt: "2026-08-04T00:00:00.000Z"
    }));
    const bridge = stubBridge({ loadBatchPublishState: load });
    const persistence = createBatchPublishPersistence(bridge);
    const loaded = await persistence.load("batch-1");
    expect(loaded?.batchId).toBe("batch-1");
    expect(load).toHaveBeenCalledWith("batch-1");
  });

  it("lists and removes batches through the bridge", async () => {
    const list = vi.fn(async (): Promise<BatchPublishPersistedState[]> => []);
    const remove = vi.fn(async () => undefined);
    const bridge = stubBridge({ listBatchPublishStates: list, deleteBatchPublishState: remove });
    const persistence = createBatchPublishPersistence(bridge);
    await persistence.list();
    await persistence.remove("batch-1");
    expect(list).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("batch-1");
  });
});
