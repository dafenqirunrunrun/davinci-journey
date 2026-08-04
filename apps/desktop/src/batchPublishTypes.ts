import type { PublishDraft } from "./publishState";
import type { DesktopCommandError } from "./desktopBridge";

/** User-facing error info attached to a batch item or the whole batch. */
export type DesktopError = DesktopCommandError;

export type BatchItemStatus =
  | "queued"
  | "parsing"
  | "needs_review"
  | "ready"
  | "writing"
  | "written"
  | "committing"
  | "committed"
  | "failed"
  | "skipped";

/** Execution phase where a failed item stopped, surfaced in the paused panel. */
export type BatchItemStage =
  | "precheck"
  | "workspace"
  | "writing"
  | "staging"
  | "committing"
  | "committed";

export interface BatchPublishItem {
  id: string;
  sourcePath: string;
  displayName: string;

  draft?: PublishDraft;
  workspaceId?: string;
  transactionId?: string;
  commitHash?: string;
  failedStage?: BatchItemStage;

  status: BatchItemStatus;
  errors: DesktopError[];
  warnings: string[];

  selected: boolean;
  order: number;
}

export type BatchPublishStatus =
  | "idle"
  | "importing"
  | "reviewing"
  | "ready"
  | "executing"
  | "paused"
  | "committed"
  | "push_checking"
  | "push_ready"
  | "pushing"
  | "deploying"
  | "published"
  | "failed";

export interface BatchPublishState {
  batchId: string;
  status: BatchPublishStatus;
  items: BatchPublishItem[];
  currentItemId?: string;

  completedCount: number;
  failedCount: number;
  skippedCount: number;

  batchCommitHashes: string[];
  pushCommitRange?: string;

  error?: DesktopError;
}

/**
 * Persisted subset of a batch — must never contain Markdown body, GitHub
 * tokens or image binaries (see AGENTS.md §14 and batch persistence rules).
 */
export interface BatchPublishPersistedItem {
  id: string;
  sourcePath: string;
  displayName: string;
  status: BatchItemStatus;
  selected: boolean;
  order: number;
  workspaceId?: string;
  transactionId?: string;
  commitHash?: string;
  failedStage?: BatchItemStage;
  warnings: string[];
  errors: Pick<DesktopError, "code" | "message" | "recoverable" | "affectedPath">[];
  /** Review metadata that survives a restart without re-reading the file. */
  title?: string;
  slug?: string;
  archiveProfileId?: string;
}

export interface BatchPublishPersistedState {
  batchId: string;
  status: BatchPublishStatus;
  items: BatchPublishPersistedItem[];
  currentItemId?: string;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  batchCommitHashes: string[];
  pushCommitRange?: string;
  savedAt: string;
}
