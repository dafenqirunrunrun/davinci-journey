import { describe, expect, it } from "vitest";
import type { PublishDraft } from "./publishState";
import type { PlannedFileChange } from "./publishState";
import type { BatchPublishPersistedState } from "./batchPublishTypes";
import {
  addItemsToBatch,
  advanceToNextItem,
  attachDraft,
  beginExecution,
  computeBatchSummary,
  computePreflight,
  createEmptyBatchState,
  failItemAndPause,
  getExecutionGate,
  markItemReady,
  markPushReady,
  moveItemInBatch,
  nextPendingItem,
  recordItemCommitted,
  removeItemFromBatch,
  restoreBatchState,
  restoreSkippedItem,
  resumeAfterSkip,
  retryFailedItem,
  setItemSelected,
  skipItem,
  MAX_BATCH_ITEMS
} from "./batchPublishEngine";

function makeDraft(title: string, slug: string, plannedFiles: PlannedFileChange[] = []): PublishDraft {
  return {
    id: `draft-${slug}`,
    source: {},
    assets: { dependencies: [], userResolutions: {} },
    article: { title, description: "", slug, tags: [], date: "2026-07-30", updated: "2026-07-30", draft: false, featured: false },
    archive: { selectedProfileId: "uncategorized", recommendedProfileIds: [], pendingProfileChanges: [] },
    preview: {
      workspacePlan: {
        workspaceId: `ws-${slug}`,
        sourceMarkdownPath: `src/${slug}.md`,
        outputMarkdownPath: `content/other/uncategorized/${slug}.md`,
        outputAssetDirectory: `public/assets/notes/${slug}`,
        plannedFiles
      }
    },
    repository: {},
    remote: { status: "idle", repositoryRoot: "", remoteName: "origin", branch: "master", localCommitHash: "" },
    status: "ready"
  };
}

function draftInput(title: string, slug: string) {
  return {
    sourcePath: `C:/notes/${slug}.md`,
    displayName: `${title}.md`
  };
}

let sequence = 0;
function deterministicId(): () => string {
  return () => `id-${(sequence += 1)}`;
}

describe("batchPublishEngine", () => {
  it("creates an idle empty batch", () => {
    const state = createEmptyBatchState(() => "batch-1");
    expect(state.status).toBe("idle");
    expect(state.items).toHaveLength(0);
    expect(state.batchCommitHashes).toEqual([]);
  });

  it("adds multiple files to the queue preserving order", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b"), draftInput("C", "c")], deterministicId());
    expect(state.items).toHaveLength(3);
    expect(state.items.map((item) => item.displayName)).toEqual(["A.md", "B.md", "C.md"]);
    expect(state.items.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(state.items.every((item) => item.selected)).toBe(true);
    expect(state.status).toBe("reviewing");
  });

  it("deduplicates by source path", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    expect(state.items).toHaveLength(2);
    expect(state.items.map((item) => item.displayName)).toEqual(["A.md", "B.md"]);
  });

  it("caps the queue at 10 items", () => {
    let state = createEmptyBatchState(() => "batch-1");
    const selections = Array.from({ length: 15 }, (_unused, index) => draftInput(`N${index}`, `n${index}`));
    state = addItemsToBatch(state, selections, deterministicId());
    expect(state.items).toHaveLength(MAX_BATCH_ITEMS);
  });

  it("does not add items beyond an existing queue's room", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, Array.from({ length: 9 }, (_unused, index) => draftInput(`N${index}`, `n${index}`)), deterministicId());
    state = addItemsToBatch(state, [draftInput("TEN", "ten"), draftInput("ELEVEN", "eleven")], deterministicId());
    expect(state.items).toHaveLength(MAX_BATCH_ITEMS);
    expect(state.items.some((item) => item.displayName === "ELEVEN.md")).toBe(false);
  });

  it("moves items up and down", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b"), draftInput("C", "c")], deterministicId());
    const c = state.items[2]!;
    state = moveItemInBatch(state, c.id, "up");
    expect(state.items.map((item) => item.displayName)).toEqual(["A.md", "C.md", "B.md"]);
    state = moveItemInBatch(state, c.id, "up");
    expect(state.items.map((item) => item.displayName)).toEqual(["C.md", "A.md", "B.md"]);
    state = moveItemInBatch(state, c.id, "up");
    expect(state.items.map((item) => item.displayName)).toEqual(["C.md", "A.md", "B.md"]);
  });

  it("removes an item from the queue and reindexes", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b"), draftInput("C", "c")], deterministicId());
    state = removeItemFromBatch(state, state.items[1]!.id);
    expect(state.items.map((item) => item.displayName)).toEqual(["A.md", "C.md"]);
    expect(state.items.map((item) => item.order)).toEqual([0, 1]);
  });

  it("attaches a parsed draft and flags the item for review", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a")], deterministicId());
    const itemId = state.items[0]!.id;
    state = attachDraft(state, itemId, makeDraft("Title A", "a"));
    expect(state.items[0]!.draft?.article.title).toBe("Title A");
    expect(state.items[0]!.status).toBe("needs_review");
  });

  it("computes the ready summary", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const first = state.items[0]!.id;
    state = attachDraft(state, first, makeDraft("Title A", "a"));
    state = markItemReady(state, first);
    const summary = computeBatchSummary(state);
    expect(summary.readyCount).toBe(1);
    expect(summary.needsReviewCount).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("computes the batch preflight summary", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const a = state.items[0]!.id;
    const b = state.items[1]!.id;
    state = attachDraft(state, a, makeDraft("New A", "a", [
      { type: "create", path: "content/other/uncategorized/a.md" },
      { type: "create", path: "public/assets/notes/a/diagram.png" }
    ]));
    state = attachDraft(state, b, makeDraft("Update B", "b", [
      { type: "update", path: "content/other/uncategorized/b.md" }
    ]));
    state = markItemReady(state, a);
    state = markItemReady(state, b);
    const preflight = computePreflight(state);
    expect(preflight.total).toBe(2);
    expect(preflight.newCount).toBe(1);
    expect(preflight.updateCount).toBe(1);
    expect(preflight.imageCount).toBe(1);
    expect(preflight.commitCount).toBe(2);
    expect(preflight.pushCount).toBe(1);
    expect(preflight.readyCount).toBe(2);
    expect(preflight.blocked).toBe(false);
  });

  it("blocks execution while an item is not ready", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const gate = getExecutionGate(state);
    expect(gate.allowed).toBe(false);
    const blocked = beginExecution(state);
    expect(blocked.status).toBe("paused");
    expect(blocked.error?.code).toBe("BATCH_NOT_READY");
  });

  it("fails the queue and pauses when an item fails", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const a = state.items[0]!.id;
    const b = state.items[1]!.id;
    state = attachDraft(state, a, makeDraft("A", "a"));
    state = attachDraft(state, b, makeDraft("B", "b"));
    state = markItemReady(state, a);
    state = markItemReady(state, b);
    state = beginExecution(state);
    expect(state.status).toBe("executing");
    state = failItemAndPause(state, a, { code: "GIT_COMMIT_FAILED", message: "提交失败", recoverable: true });
    expect(state.status).toBe("paused");
    expect(state.failedCount).toBe(1);
    expect(state.currentItemId).toBe(a);
    expect(state.error?.code).toBe("GIT_COMMIT_FAILED");
  });

  it("skips a failed item on explicit user confirmation and resumes the queue", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const a = state.items[0]!.id;
    const b = state.items[1]!.id;
    state = attachDraft(state, a, makeDraft("A", "a"));
    state = attachDraft(state, b, makeDraft("B", "b"));
    state = markItemReady(state, a);
    state = markItemReady(state, b);
    state = beginExecution(state);
    state = failItemAndPause(state, a, { code: "GIT_COMMIT_FAILED", message: "提交失败", recoverable: true });
    state = resumeAfterSkip(state, a);
    expect(state.items.find((item) => item.id === a)?.status).toBe("skipped");
    expect(state.items.find((item) => item.id === a)?.selected).toBe(false);
    expect(state.status).toBe("executing");
    expect(state.currentItemId).toBe(b);
  });

  it("retries only the failed item, clearing its commit references", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const a = state.items[0]!.id;
    const b = state.items[1]!.id;
    state = attachDraft(state, a, makeDraft("A", "a"));
    state = attachDraft(state, b, makeDraft("B", "b"));
    state = markItemReady(state, a);
    state = markItemReady(state, b);
    state = recordItemCommitted(state, b, "hash-b");
    state = failItemAndPause(state, a, { code: "GIT_COMMIT_FAILED", message: "提交失败", recoverable: true });
    state = retryFailedItem(state, a);
    expect(state.items.find((item) => item.id === a)?.status).toBe("needs_review");
    expect(state.items.find((item) => item.id === a)?.draft).toBeUndefined();
    // Already committed items are untouched.
    expect(state.items.find((item) => item.id === b)?.commitHash).toBe("hash-b");
  });

  it("executes items strictly in order", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b"), draftInput("C", "c")], deterministicId());
    const a = state.items[0]!;
    const b = state.items[1]!;
    const c = state.items[2]!;
    state = attachDraft(state, a.id, makeDraft("A", "a"));
    state = attachDraft(state, b.id, makeDraft("B", "b"));
    state = attachDraft(state, c.id, makeDraft("C", "c"));
    state = markItemReady(state, a.id);
    state = markItemReady(state, b.id);
    state = markItemReady(state, c.id);
    state = beginExecution(state);
    expect(state.currentItemId).toBe(a.id);
    state = recordItemCommitted(state, a.id, "hash-a");
    state = advanceToNextItem(state);
    expect(state.currentItemId).toBe(b.id);
    state = recordItemCommitted(state, b.id, "hash-b");
    state = advanceToNextItem(state);
    expect(state.currentItemId).toBe(c.id);
    state = recordItemCommitted(state, c.id, "hash-c");
    state = advanceToNextItem(state);
    expect(state.status).toBe("committed");
    expect(state.batchCommitHashes).toEqual(["hash-a", "hash-b", "hash-c"]);
    expect(state.completedCount).toBe(3);
  });

  it("excludes deselected items from the run", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a"), draftInput("B", "b")], deterministicId());
    const a = state.items[0]!.id;
    state = setItemSelected(state, a, false);
    const next = nextPendingItem(state);
    expect(next?.id).not.toBe(a);
  });

  it("skips an item only after explicit action", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a")], deterministicId());
    const a = state.items[0]!.id;
    state = skipItem(state, a);
    expect(state.items[0]!.status).toBe("skipped");
    expect(state.skippedCount).toBe(1);
    state = restoreSkippedItem(state, a);
    expect(state.items[0]!.status).toBe("needs_review");
  });

  it("restores a persisted snapshot, downgrading in-flight statuses but keeping ready", () => {
    const persisted: BatchPublishPersistedState = {
      batchId: "batch-1",
      status: "paused",
      items: [
        { id: "id-1", sourcePath: "C:/a.md", displayName: "a.md", status: "committed", selected: true, order: 0, commitHash: "hash-a", warnings: [], errors: [] },
        { id: "id-2", sourcePath: "C:/b.md", displayName: "b.md", status: "ready", selected: true, order: 1, warnings: [], errors: [] },
        { id: "id-3", sourcePath: "C:/c.md", displayName: "c.md", status: "failed", selected: true, order: 2, warnings: [], errors: [] },
        { id: "id-4", sourcePath: "C:/d.md", displayName: "d.md", status: "writing", selected: true, order: 3, warnings: [], errors: [] }
      ],
      currentItemId: "id-3",
      completedCount: 1,
      failedCount: 1,
      skippedCount: 0,
      batchCommitHashes: ["hash-a"],
      savedAt: "2026-08-04T00:00:00.000Z"
    };
    const state = restoreBatchState(persisted);
    // Terminal statuses survive; `ready` is durable review approval; in-flight
    // statuses downgrade to `queued` so the UI re-parses by path.
    expect(state.items.find((item) => item.id === "id-1")?.status).toBe("committed");
    expect(state.items.find((item) => item.id === "id-2")?.status).toBe("ready");
    expect(state.items.find((item) => item.id === "id-3")?.status).toBe("failed");
    expect(state.items.find((item) => item.id === "id-4")?.status).toBe("queued");
    expect(state.batchCommitHashes).toEqual(["hash-a"]);
    expect(state.items.every((item) => item.draft === undefined)).toBe(true);
  });

  it("tracks the push range after all commits", () => {
    let state = createEmptyBatchState(() => "batch-1");
    state = addItemsToBatch(state, [draftInput("A", "a")], deterministicId());
    const a = state.items[0]!.id;
    state = attachDraft(state, a, makeDraft("A", "a"));
    state = markItemReady(state, a);
    state = beginExecution(state);
    state = recordItemCommitted(state, a, "hash-a");
    state = advanceToNextItem(state);
    state = markPushReady(state, "hash-a..hash-a");
    expect(state.status).toBe("push_ready");
    expect(state.pushCommitRange).toBe("hash-a..hash-a");
  });
});
