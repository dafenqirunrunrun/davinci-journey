import type { PublishDraft } from "./publishState";
import type {
  BatchItemStage,
  BatchItemStatus,
  BatchPublishItem,
  BatchPublishState,
  BatchPublishPersistedState,
  DesktopError
} from "./batchPublishTypes";

/** First version caps each batch at 10 notes (AGENTS.md batch spec). */
export const MAX_BATCH_ITEMS = 10;

export interface BatchSelectionInput {
  sourcePath: string;
  displayName: string;
}

export function newBatchId(): string {
  return crypto.randomUUID();
}

export function createEmptyBatchState(idGenerator: () => string = newBatchId): BatchPublishState {
  return {
    batchId: idGenerator(),
    status: "idle",
    items: [],
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    batchCommitHashes: []
  };
}

/** Recompute aggregate counters from item statuses to avoid drift. */
function recount(state: BatchPublishState): BatchPublishState {
  return {
    ...state,
    completedCount: state.items.filter((item) => item.status === "committed").length,
    failedCount: state.items.filter((item) => item.status === "failed").length,
    skippedCount: state.items.filter((item) => item.status === "skipped").length
  };
}

function reindex(items: BatchPublishItem[]): BatchPublishItem[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

function withItems(state: BatchPublishState): BatchPublishState {
  return recount({ ...state, items: reindex(state.items) });
}

function patchItem(
  state: BatchPublishState,
  itemId: string,
  patch: Partial<BatchPublishItem>
): BatchPublishState {
  return withItems({
    ...state,
    items: state.items.map((item) => (item.id === itemId ? { ...item, ...patch, id: item.id } : item))
  });
}

/**
 * Add newly selected files to the queue. Preserves selection order, dedupes by
 * source path and enforces the 10-item cap. Rejects additions that exceed the cap.
 */
export function addItemsToBatch(
  state: BatchPublishState,
  selections: BatchSelectionInput[],
  idGenerator: () => string = newBatchId
): BatchPublishState {
  const existing = new Set(state.items.map((item) => item.sourcePath));
  const room = MAX_BATCH_ITEMS - state.items.length;
  const accepted: BatchPublishItem[] = [];
  for (const selection of selections) {
    if (accepted.length >= room) break;
    if (existing.has(selection.sourcePath)) continue;
    existing.add(selection.sourcePath);
    accepted.push({
      id: idGenerator(),
      sourcePath: selection.sourcePath,
      displayName: selection.displayName,
      status: "queued",
      errors: [],
      warnings: [],
      selected: true,
      order: state.items.length + accepted.length
    });
  }
  if (accepted.length === 0) return state;
  const next = { ...state, items: [...state.items, ...accepted] };
  if (next.status === "idle") next.status = "reviewing";
  return withItems(next);
}

export function removeItemFromBatch(state: BatchPublishState, itemId: string): BatchPublishState {
  const items = state.items.filter((item) => item.id !== itemId);
  const next = { ...state, items };
  if (items.length === 0 && ["idle", "reviewing"].includes(state.status)) next.status = "idle";
  return withItems(next);
}

export type ReorderDirection = "up" | "down";

/** Move an item one position up or down within the queue. */
export function moveItemInBatch(
  state: BatchPublishState,
  itemId: string,
  direction: ReorderDirection
): BatchPublishState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index < 0) return state;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.items.length) return state;
  const items = [...state.items];
  const current = items[index]!;
  const neighbour = items[target]!;
  items[index] = neighbour;
  items[target] = current;
  return withItems({ ...state, items });
}

export function setItemSelected(
  state: BatchPublishState,
  itemId: string,
  selected: boolean
): BatchPublishState {
  return patchItem(state, itemId, { selected });
}

/** Exclude an item from this run without deleting it. Requires UI confirmation. */
export function skipItem(state: BatchPublishState, itemId: string): BatchPublishState {
  return patchItem(state, itemId, { status: "skipped", selected: false });
}

/** Re-include a skipped item (back to review). */
export function restoreSkippedItem(state: BatchPublishState, itemId: string): BatchPublishState {
  return patchItem(state, itemId, { status: "needs_review", selected: true });
}

export function setItemStatus(state: BatchPublishState, itemId: string, status: BatchItemStatus): BatchPublishState {
  return patchItem(state, itemId, { status });
}

/** Attach the parsed publish draft after item parsing. */
export function attachDraft(
  state: BatchPublishState,
  itemId: string,
  draft: PublishDraft
): BatchPublishState {
  return patchItem(state, itemId, { draft, status: "needs_review" });
}

/** Update a reviewed item's draft in place (keeps the item's current status). */
export function updateItemDraft(
  state: BatchPublishState,
  itemId: string,
  draft: PublishDraft
): BatchPublishState {
  return patchItem(state, itemId, { draft });
}

/** Mark an item as passing all review gates (title, slug, archive, images...). */
export function markItemReady(state: BatchPublishState, itemId: string): BatchPublishState {
  return patchItem(state, itemId, { status: "ready", errors: [] });
}

/** Record that a publish workspace was generated (status stays unchanged). */
export function markItemWorkspaceGenerated(
  state: BatchPublishState,
  itemId: string,
  workspaceId: string
): BatchPublishState {
  return patchItem(state, itemId, { workspaceId });
}

export function recordItemWorkspace(
  state: BatchPublishState,
  itemId: string,
  workspaceId: string,
  transactionId: string
): BatchPublishState {
  return patchItem(state, itemId, { workspaceId, transactionId, status: "written" });
}

export function recordItemCommitted(
  state: BatchPublishState,
  itemId: string,
  commitHash: string
): BatchPublishState {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item || item.commitHash) return state;
  return withItems({
    ...state,
    items: state.items.map((candidate) =>
      candidate.id === itemId ? { ...candidate, commitHash, status: "committed" } : candidate
    ),
    batchCommitHashes: [...state.batchCommitHashes, commitHash]
  });
}

/** Mark a single item as failed without pausing the whole batch (used during review/parse). */
export function failItem(
  state: BatchPublishState,
  itemId: string,
  error: DesktopError,
  stage?: BatchItemStage
): BatchPublishState {
  const existingErrors = state.items.find((item) => item.id === itemId)?.errors ?? [];
  return patchItem(state, itemId, {
    status: "failed",
    failedStage: stage,
    errors: [...existingErrors, error]
  });
}

/** Default failure policy: any write/commit failure pauses the whole queue. */
export function failItemAndPause(
  state: BatchPublishState,
  itemId: string,
  error: DesktopError,
  stage?: BatchItemStage
): BatchPublishState {
  return withItems({
    ...state,
    status: "paused",
    currentItemId: itemId,
    error,
    items: state.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: "failed" as const,
            failedStage: stage,
            errors: [...item.errors, error]
          }
        : item
    )
  });
}

/** User chose "跳过当前项继续": skip the failed item and resume the queue. */
export function resumeAfterSkip(state: BatchPublishState, itemId: string): BatchPublishState {
  const skipped = skipItem(state, itemId);
  const next = nextPendingItem(skipped);
  if (!next) {
    const hasCommitted = skipped.items.some((item) => item.status === "committed");
    return recount({
      ...skipped,
      status: hasCommitted ? "committed" : "paused",
      currentItemId: undefined,
      error: undefined
    });
  }
  return recount({
    ...skipped,
    status: "executing",
    currentItemId: next.id,
    error: undefined
  });
}

/** User chose "返回编辑当前项": failed item goes back to review so it can be regenerated. */
export function retryFailedItem(state: BatchPublishState, itemId: string): BatchPublishState {
  return withItems({
    ...state,
    status: "reviewing",
    currentItemId: itemId,
    error: undefined,
    items: state.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: "needs_review" as const,
            errors: [],
            failedStage: undefined,
            workspaceId: undefined,
            transactionId: undefined,
            commitHash: undefined,
            draft: undefined
          }
        : item
    )
  });
}

/**
 * User chose "重试当前项": re-run the failed item's write/commit pipeline
 * keeping the already-approved draft, clearing stale transaction references.
 * Never re-commits items that already succeeded.
 */
export function retryItem(state: BatchPublishState, itemId: string): BatchPublishState {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return state;
  return withItems({
    ...state,
    status: "executing",
    currentItemId: itemId,
    error: undefined,
    items: state.items.map((candidate) =>
      candidate.id === itemId
        ? {
            ...candidate,
            status: "ready" as const,
            errors: [],
            failedStage: undefined,
            workspaceId: undefined,
            transactionId: undefined,
            commitHash: undefined
          }
        : candidate
    )
  });
}

export interface BatchExecutionGate {
  allowed: boolean;
  reasons: string[];
}

/**
 * Validate that every selected, non-skipped item is ready before executing.
 * Failed items always block execution — the UI must offer "返回修复" or
 * "排除失败项后继续", never silently skip.
 */
export function getExecutionGate(state: BatchPublishState): BatchExecutionGate {
  const reasons: string[] = [];
  const participating = state.items.filter((item) => item.selected && item.status !== "skipped");
  if (participating.length === 0) {
    reasons.push("队列中没有已选中的笔记。");
  }
  const failed = state.items.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    reasons.push(`${failed.length} 篇笔记存在失败项，需要修复或明确排除后才能执行。`);
  }
  const notReady = participating.filter(
    (item) => !["ready", "committed"].includes(item.status)
  );
  if (notReady.length > 0) {
    reasons.push(`${notReady.length} 篇笔记尚未通过审核，不能执行。`);
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Mark the batch as executing and select the first pending item. */
export function beginExecution(state: BatchPublishState): BatchPublishState {
  const gate = getExecutionGate(state);
  if (!gate.allowed) {
    return { ...state, status: "paused", error: { code: "BATCH_NOT_READY", message: gate.reasons.join(" "), recoverable: true } };
  }
  const next = nextPendingItem(state);
  if (!next) return state;
  return { ...state, status: "executing", currentItemId: next.id, error: undefined };
}

/** First selected, non-done item in queue order. */
export function nextPendingItem(state: BatchPublishState): BatchPublishItem | undefined {
  return state.items.find(
    (item) =>
      item.selected &&
      !["committed", "skipped", "failed", "writing", "written", "committing"].includes(item.status)
  );
}

/** Advance to the next item after a write/commit step completes. */
export function advanceToNextItem(state: BatchPublishState): BatchPublishState {
  const next = nextPendingItem(state);
  if (!next) {
    return { ...state, status: "committed", currentItemId: undefined };
  }
  return { ...state, status: "executing", currentItemId: next.id };
}

export function markPushReady(
  state: BatchPublishState,
  commitRange: string
): BatchPublishState {
  return { ...state, status: "push_ready", pushCommitRange: commitRange };
}

export function markBatchPublished(state: BatchPublishState): BatchPublishState {
  return { ...state, status: "published" };
}

export interface BatchPreflight {
  total: number;
  newCount: number;
  updateCount: number;
  imageCount: number;
  commitCount: number;
  pushCount: number;
  readyCount: number;
  warningCount: number;
  failedCount: number;
  skippedCount: number;
  /** Items excluded from the run (skipped or deselected). */
  excludedCount: number;
  /** True when a failed item exists — must be handled explicitly. */
  blocked: boolean;
}

function countPlannedFiles(item: BatchPublishItem, predicate: (path: string, type: string) => boolean): number {
  const plan = item.draft?.preview.workspacePlan;
  if (!plan?.plannedFiles) return 0;
  return plan.plannedFiles.filter((file) => predicate(file.path, file.type)).length;
}

/** Aggregate the "准备发布 N 篇笔记" summary shown before execution. */
export function computePreflight(state: BatchPublishState): BatchPreflight {
  const participating = state.items.filter((item) => item.selected && item.status !== "skipped");
  const ready = participating.filter((item) => item.status === "ready");
  const newCount = participating.filter((item) => countPlannedFiles(item, (_path, type) => type === "create") > 0).length;
  const updateCount = participating.filter((item) => countPlannedFiles(item, (_path, type) => type === "update") > 0).length;
  const imageCount = participating.reduce(
    (sum, item) => sum + countPlannedFiles(item, (path, _type) => path.startsWith("public/")),
    0
  );
  return {
    total: participating.length,
    newCount,
    updateCount,
    imageCount,
    commitCount: participating.length,
    pushCount: participating.length > 0 ? 1 : 0,
    readyCount: ready.length,
    warningCount: participating.filter((item) => item.warnings.length > 0).length,
    failedCount: state.items.filter((item) => item.status === "failed").length,
    skippedCount: state.items.filter((item) => item.status === "skipped").length,
    excludedCount: state.items.filter((item) => item.status === "skipped" || !item.selected).length,
    blocked: state.items.some((item) => item.status === "failed")
  };
}

/**
 * Restore rules:
 * - `committed` / `failed` / `skipped` are terminal and survive unchanged.
 * - `ready` is durable review approval; content is re-read by path when the
 *   batch executes (prepare step), so it also survives unchanged.
 * - in-flight statuses (queued / parsing / needs_review / writing / written /
 *   committing) downgrade to `queued` — the UI re-parses by path on demand.
 */
function restoreItemStatus(status: BatchItemStatus): BatchItemStatus {
  switch (status) {
    case "committed":
    case "failed":
    case "skipped":
    case "ready":
      return status;
    default:
      return "queued";
  }
}

/** Rebuild a working batch state from the persisted (content-free) snapshot. */
export function restoreBatchState(persisted: BatchPublishPersistedState): BatchPublishState {
  const items: BatchPublishItem[] = persisted.items.map((item) => ({
    id: item.id,
    sourcePath: item.sourcePath,
    displayName: item.displayName,
    status: restoreItemStatus(item.status),
    selected: item.selected,
    order: item.order,
    workspaceId: item.workspaceId,
    transactionId: item.transactionId,
    commitHash: item.commitHash,
    failedStage: item.failedStage,
    warnings: item.warnings,
    errors: [],
    draft: undefined
  }));
  return {
    batchId: persisted.batchId,
    status: persisted.status,
    items,
    currentItemId: persisted.currentItemId,
    completedCount: persisted.completedCount,
    failedCount: persisted.failedCount,
    skippedCount: persisted.skippedCount,
    batchCommitHashes: persisted.batchCommitHashes,
    pushCommitRange: persisted.pushCommitRange
  };
}

export interface BatchSummary {
  total: number;
  readyCount: number;
  needsReviewCount: number;
  failedCount: number;
  skippedCount: number;
  committedCount: number;
  queuedCount: number;
}

export function computeBatchSummary(state: BatchPublishState): BatchSummary {
  return {
    total: state.items.length,
    readyCount: state.items.filter((item) => item.status === "ready").length,
    needsReviewCount: state.items.filter((item) =>
      ["queued", "parsing", "needs_review"].includes(item.status)
    ).length,
    failedCount: state.items.filter((item) => item.status === "failed").length,
    skippedCount: state.items.filter((item) => item.status === "skipped").length,
    committedCount: state.items.filter((item) => item.status === "committed").length,
    queuedCount: state.items.filter((item) => item.status === "queued").length
  };
}
