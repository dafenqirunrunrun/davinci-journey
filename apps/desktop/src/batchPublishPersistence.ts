import type { DesktopBridge } from "./desktopBridge";
import type { BatchPublishPersistedState, BatchPublishState } from "./batchPublishTypes";

/**
 * Serialize a batch for local persistence. This is the hard safety boundary:
 * it must NEVER include Markdown body, GitHub tokens or image binaries — only
 * queue metadata and commit/transaction references (AGENTS.md §14).
 */
export function stripBatchForPersistence(state: BatchPublishState): BatchPublishPersistedState {
  return {
    batchId: state.batchId,
    status: state.status,
    items: state.items.map((item) => ({
      id: item.id,
      sourcePath: item.sourcePath,
      displayName: item.displayName,
      status: item.status,
      selected: item.selected,
      order: item.order,
      workspaceId: item.workspaceId,
      transactionId: item.transactionId,
      commitHash: item.commitHash,
      failedStage: item.failedStage,
      warnings: item.warnings,
      errors: item.errors.map((error) => ({
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        affectedPath: error.affectedPath
      })),
      title: item.draft?.article.title,
      slug: item.draft?.article.slug,
      archiveProfileId: item.draft?.archive.selectedProfileId
    })),
    currentItemId: state.currentItemId,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
    skippedCount: state.skippedCount,
    batchCommitHashes: state.batchCommitHashes,
    pushCommitRange: state.pushCommitRange,
    savedAt: new Date().toISOString()
  };
}

export interface BatchPublishPersistence {
  save(state: BatchPublishState): Promise<void>;
  load(batchId: string): Promise<BatchPublishPersistedState | undefined>;
  list(): Promise<BatchPublishPersistedState[]>;
  remove(batchId: string): Promise<void>;
}

/** Persistence backed by the desktop bridge (Tauri app-data dir or localStorage). */
export function createBatchPublishPersistence(bridge: DesktopBridge): BatchPublishPersistence {
  return {
    save(state) {
      return bridge.saveBatchPublishState(state.batchId, stripBatchForPersistence(state));
    },
    load(batchId) {
      return bridge.loadBatchPublishState(batchId);
    },
    list() {
      return bridge.listBatchPublishStates();
    },
    remove(batchId) {
      return bridge.deleteBatchPublishState(batchId);
    }
  };
}
