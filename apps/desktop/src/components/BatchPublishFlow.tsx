import { useEffect, useMemo, useRef, useState } from "react";
import { type ArchiveProfile } from "@davinci-journey/classification";
import { normalizeLeadingTitleHeading } from "@davinci-journey/markdown-core";
import {
  createDesktopBridge,
  desktopErrorMessage,
  isCancelError,
  isDesktopCommandError,
  type DesktopBridge,
  type InspectRemotePublishResult,
  type PublishLockStatus,
  type SelectedMarkdownFileDto
} from "../desktopBridge";
import { canContinueFromAssets, type PublishDraft } from "../publishState";
import {
  addItemsToBatch,
  advanceToNextItem,
  attachDraft,
  beginExecution,
  computeBatchSummary,
  computePreflight,
  createEmptyBatchState,
  failItem,
  failItemAndPause,
  getExecutionGate,
  markBatchPublished,
  markItemReady,
  markItemWorkspaceGenerated,
  markPushReady,
  moveItemInBatch,
  recordItemCommitted,
  recordItemWorkspace,
  removeItemFromBatch,
  restoreBatchState,
  restoreSkippedItem,
  resumeAfterSkip,
  retryFailedItem,
  retryItem,
  setItemSelected,
  setItemStatus,
  skipItem,
  updateItemDraft,
  MAX_BATCH_ITEMS
} from "../batchPublishEngine";
import { createBatchPublishPersistence } from "../batchPublishPersistence";
import type {
  BatchItemStage,
  BatchPublishItem,
  BatchPublishState,
  BatchPublishPersistedState,
  DesktopError
} from "../batchPublishTypes";
import { createDraftFromFile, updatePreview } from "./PublishFlow";

type BatchView = "queue" | "review" | "executing" | "push" | "results";

export interface BatchPublishFlowProps {
  profiles: ArchiveProfile[];
  repositoryRoot?: string;
  onClose: () => void;
}

/** Site and repo URLs follow the existing single-publish configuration. */
const SITE_HOME = "https://dafenqirunrunrun.github.io/davinci-journey/";
const REPO_OWNER = "dafenqirunrunrun";
const REPO_NAME = "davinci-journey";

function toDesktopError(error: unknown): DesktopError {
  if (isDesktopCommandError(error)) return error;
  return { code: "BATCH_EXECUTION_FAILED", message: desktopErrorMessage(error), recoverable: true };
}

function reviewGates(draft: PublishDraft): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!draft.article.title.trim()) reasons.push("缺少标题。");
  if (!draft.article.slug.trim()) reasons.push("缺少 Slug。");
  if (!draft.archive.selectedProfileId) reasons.push("尚未选择归档方案。");
  if (!canContinueFromAssets(draft.assets.dependencies)) reasons.push("存在缺失或不安全的图片。");
  return { passed: reasons.length === 0, reasons };
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    parsing: "解析中",
    needs_review: "待审核",
    ready: "已就绪",
    writing: "写入中",
    written: "已写入",
    committing: "提交中",
    committed: "已提交",
    failed: "失败",
    skipped: "已跳过"
  };
  return labels[status] ?? status;
}

function stageLabel(stage?: BatchItemStage): string {
  const labels: Record<string, string> = {
    precheck: "仓库预检",
    workspace: "生成工作区",
    writing: "写入正式文件",
    staging: "暂存文件",
    committing: "创建独立 Commit",
    committed: "已提交"
  };
  return stage ? (labels[stage] ?? stage) : "未知";
}

const WRITTEN_STATUSES = ["written", "committing", "committed"] as const;

export function BatchPublishFlow({ profiles, repositoryRoot, onClose }: BatchPublishFlowProps) {
  const [batch, setBatch] = useState<BatchPublishState>(() => createEmptyBatchState());
  const [view, setView] = useState<BatchView>("queue");
  const [reviewingId, setReviewingId] = useState<string | undefined>();
  const [resumeCandidates, setResumeCandidates] = useState<BatchPublishPersistedState[]>([]);
  const [publishLock, setPublishLock] = useState<PublishLockStatus | undefined>();
  const [remoteInspect, setRemoteInspect] = useState<InspectRemotePublishResult | undefined>();
  const [articleUrls, setArticleUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | undefined>();
  const multiInputRef = useRef<HTMLInputElement>(null);
  const pendingMultiPicker = useRef<((files?: File[]) => void) | undefined>();
  // Latest batch for effect callbacks that must not re-run on every batch change.
  const batchRef = useRef(batch);
  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  const batchBridge = useMemo<DesktopBridge>(
    () =>
      createDesktopBridge(
        () => Promise.resolve(undefined),
        () =>
          new Promise<File[]>((resolve) => {
            pendingMultiPicker.current = (files) => resolve(files ?? []);
            multiInputRef.current?.click();
          })
      ),
    []
  );
  const persistence = useMemo(() => createBatchPublishPersistence(batchBridge), [batchBridge]);

  const summary = useMemo(() => computeBatchSummary(batch), [batch]);
  const preflight = useMemo(() => computePreflight(batch), [batch]);
  const executionGate = useMemo(() => getExecutionGate(batch), [batch]);
  const reviewingItem = reviewingId ? batch.items.find((item) => item.id === reviewingId) : undefined;
  const currentItem = batch.currentItemId
    ? batch.items.find((item) => item.id === batch.currentItemId)
    : undefined;

  // Persist metadata-only snapshot on every change (crash recovery).
  useEffect(() => {
    if (batch.items.length === 0 || batch.status === "published") return;
    void persistence.save(batch).catch(() => undefined);
  }, [batch, persistence]);

  // Load unfinished batches + publish lock on mount.
  useEffect(() => {
    let active = true;
    void persistence
      .list()
      .then((states) => {
        if (!active) return;
        setResumeCandidates(states.filter((state) => !["published", "idle"].includes(state.status)));
      })
      .catch(() => undefined);
    if (repositoryRoot) {
      void batchBridge
        .inspectPublishLock(repositoryRoot)
        .then((lock) => {
          if (active) setPublishLock(lock);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [persistence, batchBridge, repositoryRoot]);

  // Parse an item by path the first time it is opened for review.
  useEffect(() => {
    if (view !== "review" || !reviewingId) return;
    const item = batchRef.current.items.find((candidate) => candidate.id === reviewingId);
    if (item?.draft || item?.status === "parsing") return;
    setBatch((current) => setItemStatus(current, reviewingId, "parsing"));
    let active = true;
    void (async () => {
      try {
        const dto = await batchBridge.readMarkdownPath({ path: item?.sourcePath ?? "" });
        const draft = await createDraftFromFile(dto, profiles, batchBridge);
        if (!active) return;
        setBatch((current) => attachDraft(current, reviewingId, draft));
      } catch (error) {
        if (!active) return;
        setBatch((current) => failItem(current, reviewingId, toDesktopError(error)));
      }
    })();
    return () => {
      active = false;
    };
    // Intentionally does NOT depend on `batch`: setting status to "parsing"
    // would otherwise tear down this effect and discard the in-flight parse.
  }, [view, reviewingId, batchBridge, profiles]);

  // Resolve public article URLs for committed items once the results page shows.
  useEffect(() => {
    if (view !== "results") return;
    let active = true;
    const committed = batch.items.filter(
      (item) => item.status === "committed" && Boolean(item.draft?.article.slug)
    );
    void Promise.all(
      committed.map(async (item) => {
        const slug = item.draft?.article.slug ?? "";
        if (!slug) return;
        try {
          const url = await batchBridge.getPublicArticleUrl(slug);
          if (active) setArticleUrls((current) => ({ ...current, [item.id]: url }));
        } catch {
          // A missing article link must not break the results page.
        }
      })
    );
    return () => {
      active = false;
    };
  }, [view, batch.items, batchBridge]);

  // ─── Import ────────────────────────────────────────────────────────────────

  async function importBatch() {
    setBusy(true);
    setBatchError(undefined);
    try {
      const selections = await batchBridge.selectMarkdownFiles();
      if (selections.length === 0) return;
      const next = addItemsToBatch(
        batch,
        selections.map((item) => ({ sourcePath: item.absolutePath, displayName: item.displayName }))
      );
      if (next.items.length === batch.items.length) {
        setBatchError(`没有可加入的新文件：队列已满（最多 ${MAX_BATCH_ITEMS} 篇）或所选文件已在队列中。`);
        return;
      }
      setBatch(next);
    } catch (error) {
      if (!isCancelError(error)) setBatchError(desktopErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function handleBrowserMultiFiles(files?: FileList | null) {
    const list = files ? Array.from(files) : [];
    pendingMultiPicker.current?.(list);
    pendingMultiPicker.current = undefined;
  }

  // ─── Queue management ──────────────────────────────────────────────────────

  function handleRemove(itemId: string) {
    setBatch((current) => removeItemFromBatch(current, itemId));
  }
  function handleMove(itemId: string, direction: "up" | "down") {
    setBatch((current) => moveItemInBatch(current, itemId, direction));
  }
  function handleToggleSelected(itemId: string, selected: boolean) {
    setBatch((current) => setItemSelected(current, itemId, selected));
  }
  function handleSkip(itemId: string) {
    if (!window.confirm("确定跳过这篇？跳过项不会写入、不会提交，也不会推送到远程。")) return;
    setBatch((current) => skipItem(current, itemId));
  }
  function handleRestore(itemId: string) {
    setBatch((current) => restoreSkippedItem(current, itemId));
  }
  function handleReparse(itemId: string) {
    const item = batch.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setBatch((current) => ({
      ...current,
      items: current.items.map((candidate) =>
        candidate.id === itemId
          ? { ...candidate, draft: undefined, status: "queued", errors: [], failedStage: undefined }
          : candidate
      )
    }));
    setReviewingId(itemId);
    setView("review");
  }

  // ─── Review ────────────────────────────────────────────────────────────────

  function openReview(itemId: string) {
    setReviewingId(itemId);
    setView("review");
  }

  function updateReview(patch: Partial<PublishDraft["article"]>) {
    if (!reviewingId) return;
    setBatch((current) => {
      const item = current.items.find((candidate) => candidate.id === reviewingId);
      if (!item?.draft) return current;
      const draft = updatePreview({ ...item.draft, article: { ...item.draft.article, ...patch } }, profiles);
      return updateItemDraft(current, reviewingId, draft);
    });
  }

  function selectReviewProfile(profileId: string) {
    if (!reviewingId) return;
    setBatch((current) => {
      const item = current.items.find((candidate) => candidate.id === reviewingId);
      if (!item?.draft) return current;
      const draft = updatePreview(
        { ...item.draft, archive: { ...item.draft.archive, selectedProfileId: profileId } },
        profiles
      );
      return updateItemDraft(current, reviewingId, draft);
    });
  }

  function orderedReviewItems(): BatchPublishItem[] {
    return [...batch.items].sort((a, b) => a.order - b.order);
  }

  function navigateReview(direction: "prev" | "next") {
    const ordered = orderedReviewItems();
    const index = ordered.findIndex((item) => item.id === reviewingId);
    const target = ordered[index + (direction === "next" ? 1 : -1)];
    if (target) openReview(target.id);
    else setView("queue");
  }

  function saveAndNext() {
    if (!reviewingId) return;
    setBatch((current) => {
      const item = current.items.find((candidate) => candidate.id === reviewingId);
      if (!item?.draft) return current;
      const gates = reviewGates(item.draft);
      return gates.passed ? markItemReady(current, reviewingId) : current;
    });
    navigateReview("next");
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  /**
   * Restored batches keep `ready` items but never persist Markdown bodies, so
   * re-read each ready item's content by path before executing. Keeps the item
   * `ready` (review approval is durable); the workspace precheck still detects
   * any source changes via fingerprint.
   */
  async function prepareDraftsForExecution(): Promise<boolean> {
    const missing = batch.items.filter(
      (item) => item.selected && item.status === "ready" && !item.draft
    );
    for (const item of missing) {
      try {
        const dto = await batchBridge.readMarkdownPath({ path: item.sourcePath });
        const draft = await createDraftFromFile(dto, profiles, batchBridge);
        setBatch((current) => updateItemDraft(current, item.id, draft));
      } catch (error) {
        setBatchError(`无法重新读取「${item.displayName}」：${desktopErrorMessage(error)}`);
        return false;
      }
    }
    return true;
  }

  async function startExecution() {
    setBatchError(undefined);
    if (!repositoryRoot) {
      setBatchError("尚未选择目标仓库。请返回主流程选择“达芬奇的奇妙之旅”所在的 Git 仓库。");
      return;
    }
    const gate = executionGate;
    if (!gate.allowed) {
      setBatchError(gate.reasons.join(" "));
      return;
    }
    const prepared = await prepareDraftsForExecution();
    if (!prepared) return;
    try {
      const verified = await batchBridge.validateRepositoryRoot(repositoryRoot);
      if (!verified.valid) {
        setBatchError(verified.message ?? verified.errors[0] ?? "目标仓库无效。");
        return;
      }
      const lock = await batchBridge.inspectPublishLock(verified.repositoryRoot);
      if (lock.state !== "missing") {
        setBatchError(lock.state === "active" ? "发布锁被占用，请等待其他发布流程完成。" : "检测到发布锁，请先清理后再发布。");
        return;
      }
      setPublishLock(lock);
      const started = beginExecution(batch);
      if (started.status !== "executing") {
        setBatchError(started.error?.message ?? "队列未就绪，不能开始发布。");
        return;
      }
      setBatch(started);
      setView("executing");
      await runQueue(started, verified.repositoryRoot);
    } catch (error) {
      setBatchError(desktopErrorMessage(error));
    }
  }

  async function runQueue(state: BatchPublishState, repoRoot: string) {
    let current = state;
    while (current.status === "executing") {
      const item = current.items.find((candidate) => candidate.id === current.currentItemId);
      if (!item) break;
      const outcome = await executeOneItem(current, item, repoRoot);
      if (outcome.error) {
        const paused = failItemAndPause(outcome.state, item.id, outcome.error, outcome.stage);
        setBatch(paused);
        return;
      }
      setBatch(outcome.state);
      current = outcome.state;
      const advanced = advanceToNextItem(current);
      setBatch(advanced);
      current = advanced;
      if (current.status === "committed") {
        await runPushChecks(current, repoRoot);
        return;
      }
    }
  }

  /**
   * Runs one item through the sequential write + commit pipeline, emitting
   * visible intermediate states (writing → written → committing) between the
   * awaited bridge calls so the UI timeline stays in sync.
   */
  async function executeOneItem(
    state: BatchPublishState,
    item: BatchPublishItem,
    repoRoot: string
  ): Promise<{ state: BatchPublishState; error?: DesktopError; stage?: BatchItemStage }> {
    const source = item.draft?.source.markdownFile;
    if (!item.draft || !source) {
      return {
        state,
        error: { code: "BATCH_NOT_READY", message: `「${item.displayName}」缺少解析结果，请重新审核。`, recoverable: true },
        stage: "precheck"
      };
    }
    const draft = item.draft;
    const profile = profiles.find((candidate) => candidate.id === draft.archive.selectedProfileId) ?? profiles[0]!;
    const dto = source as SelectedMarkdownFileDto;
    let current = state;
    let stage: BatchItemStage = "workspace";
    try {
      const hasTitle = Boolean(draft.article.title?.trim());
      const normalizedContent = normalizeLeadingTitleHeading(source.content, hasTitle);
      const workspace = await batchBridge.generatePublishWorkspace({
        repositoryRoot: repoRoot,
        sourceMarkdownPath: source.absolutePath,
        sourceFingerprint: dto.sourceFingerprint,
        markdownContent: normalizedContent,
        article: draft.article,
        archiveProfile: profile,
        imageReferences: draft.source.parsedDocument?.imageReferences ?? [],
        dependencies: draft.assets.dependencies,
        pendingArchiveProfiles: draft.archive.pendingProfileChanges
          .filter((change) => change.type === "create")
          .map((change) => change.profile)
      });
      current = markItemWorkspaceGenerated(current, item.id, workspace.workspaceId);
      setBatch(current);

      const preCheck = await batchBridge.inspectRepositoryPublish({
        repositoryRoot: repoRoot,
        workspaceId: workspace.workspaceId
      });

      stage = "writing";
      current = setItemStatus(current, item.id, "writing");
      setBatch(current);
      const operation = preCheck.targetConflicts.targetExists ? "update" : "create";
      const apply = await batchBridge.applyPublishWorkspace({
        repositoryRoot: repoRoot,
        workspaceId: workspace.workspaceId,
        operation,
        archiveProfileChanges: draft.archive.pendingProfileChanges
          .filter((change) => change.type === "create")
          .map((change) => change.profile)
      });
      current = recordItemWorkspace(current, item.id, workspace.workspaceId, apply.transactionId);
      setBatch(current);

      stage = "staging";
      const staged = await batchBridge.stagePublishTransaction({
        repositoryRoot: repoRoot,
        transactionId: apply.transactionId
      });
      if (!staged.canCommit) {
        return { state: current, error: { code: "GIT_STAGE_FAILED", message: staged.message ?? "暂存失败。", recoverable: true }, stage };
      }

      stage = "committing";
      current = setItemStatus(current, item.id, "committing");
      setBatch(current);
      const topic = profile.topic?.toLowerCase() ?? "note";
      const commit = await batchBridge.commitPublishTransaction({
        repositoryRoot: repoRoot,
        transactionId: apply.transactionId,
        message: `docs(${topic}): add ${draft.article.slug} with assets`
      });
      current = recordItemCommitted(current, item.id, commit.commitHash);
      return { state: current };
    } catch (error) {
      return { state: current, error: toDesktopError(error), stage };
    }
  }

  // ─── Failure handling (paused) ─────────────────────────────────────────────

  async function retryCurrent() {
    const failed = batch.items.find((item) => item.id === batch.currentItemId && item.status === "failed");
    if (!failed) return;
    const next = retryItem(batch, failed.id);
    setBatch(next);
    if (repositoryRoot) await runQueue(next, repositoryRoot);
  }

  function editCurrent() {
    const failed = batch.items.find((item) => item.id === batch.currentItemId && item.status === "failed");
    if (!failed) return;
    setBatch((current) => retryFailedItem(current, failed.id));
    setReviewingId(failed.id);
    setView("review");
  }

  async function skipCurrent() {
    const failed = batch.items.find((item) => item.id === batch.currentItemId && item.status === "failed");
    if (!failed) return;
    if (!window.confirm("跳过当前失败项继续？该项不会被写入或提交，其余队列继续执行。")) return;
    const next = resumeAfterSkip(batch, failed.id);
    setBatch(next);
    if (next.status === "executing" && repositoryRoot) {
      await runQueue(next, repositoryRoot);
    } else if (next.status === "committed" && repositoryRoot) {
      await runPushChecks(next, repositoryRoot);
    } else {
      setView("queue");
    }
  }

  function endBatch() {
    setBatch((current) => ({ ...current, status: "paused", currentItemId: undefined }));
    setView("queue");
  }

  // ─── Push + deployment ─────────────────────────────────────────────────────

  async function runPushChecks(state: BatchPublishState, repoRoot: string) {
    const hashes = state.batchCommitHashes;
    const commitHash = hashes[hashes.length - 1];
    if (!commitHash || hashes.length === 0) {
      setBatchError("没有可推送的 Commit。");
      return;
    }
    setBatch((current) => markPushReady(current, `${hashes[0]}..${commitHash}`));
    setView("push");
    try {
      const inspect = await batchBridge.inspectRemotePublish({
        repositoryRoot: repoRoot,
        commitHash,
        remoteName: "origin",
        branch: "master"
      });
      setRemoteInspect(inspect);
      if (inspect.pushedAlready) {
        await finishBatchSuccess(state.batchId);
        return;
      }
      if (!inspect.canPush) {
        setBatchError(inspect.message ?? "远程状态冲突，请先同步后重试。");
      }
    } catch (error) {
      setBatchError(desktopErrorMessage(error));
    }
  }

  async function confirmBatchPush() {
    const commitHash = batch.batchCommitHashes[batch.batchCommitHashes.length - 1];
    if (!commitHash || !repositoryRoot) return;
    setBatchError(undefined);
    setBatch((current) => ({ ...current, status: "pushing" }));
    try {
      await batchBridge.pushPublishCommit({
        repositoryRoot,
        commitHash,
        remoteName: "origin",
        branch: "master"
      });
      setBatch((current) => ({ ...current, status: "deploying" }));
      const first = await batchBridge.checkGithubPagesDeployment({
        repositoryRoot,
        commitHash,
        workflowName: "Deploy Pages",
        branch: "master"
      });
      if (!first.ghAvailable) {
        await finishBatchSuccess(batch.batchId);
        return;
      }
      const final = await batchBridge.waitGithubPagesDeployment({
        repositoryRoot,
        commitHash,
        workflowName: "Deploy Pages",
        branch: "master"
      });
      if (final.phase === "success") {
        await finishBatchSuccess(batch.batchId);
      } else {
        setBatch((current) => ({ ...current, status: "deploying" }));
        setBatchError(final.ghMessage ?? "网站部署未成功，文章已推送到 GitHub。");
      }
    } catch (error) {
      setBatch((current) => ({ ...current, status: "push_ready" }));
      setBatchError(desktopErrorMessage(error));
    }
  }

  async function finishBatchSuccess(batchId: string) {
    setBatch((current) => markBatchPublished(current));
    setView("results");
    await persistence.remove(batchId).catch(() => undefined);
  }

  function resumeBatch(candidate: BatchPublishPersistedState) {
    const restored = restoreBatchState(candidate);
    setBatch(restored);
    setResumeCandidates((current) => current.filter((item) => item.batchId !== candidate.batchId));
    setBatchError(undefined);
    if (["committed", "push_checking", "push_ready"].includes(restored.status)) {
      setView("push");
      if (repositoryRoot) void runPushChecks(restored, repositoryRoot);
    } else if (restored.status === "paused" && restored.items.some((item) => item.status === "failed")) {
      // A failed item blocks: show the paused panel so the user chooses an action.
      setView("executing");
    } else {
      // Crashed mid-flight (or still reviewing): go back to the queue so items
      // are re-parsed by path before continuing.
      setView("queue");
    }
  }

  async function abandonBatch(candidate: BatchPublishPersistedState) {
    if (!window.confirm("放弃该批次不会删除已经创建的 Commit。确定放弃？")) return;
    await persistence.remove(candidate.batchId).catch(() => undefined);
    setResumeCandidates((current) => current.filter((item) => item.batchId !== candidate.batchId));
  }

  // ─── Results actions ───────────────────────────────────────────────────────

  function commitsUrl(): string {
    const owner = remoteInspect?.remoteOwner ?? REPO_OWNER;
    const repo = remoteInspect?.remoteRepo ?? REPO_NAME;
    const last = batch.batchCommitHashes[batch.batchCommitHashes.length - 1];
    return last ? `https://github.com/${owner}/${repo}/commit/${last}` : `https://github.com/${owner}/${repo}/commits/master`;
  }

  function publishNextBatch() {
    setBatch(createEmptyBatchState());
    setView("queue");
    setReviewingId(undefined);
    setRemoteInspect(undefined);
    setArticleUrls({});
    setBatchError(undefined);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const failedItem = batch.items.find((item) => item.id === batch.currentItemId && item.status === "failed");
  const committedItems = orderedReviewItems().filter((item) => item.status === "committed");
  const notStartedCount = batch.items.length - batch.completedCount - batch.failedCount - batch.skippedCount;

  return (
    <section className="panel batch-panel">
      <input
        ref={multiInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".md,.markdown,text/markdown"
        onChange={(event) => handleBrowserMultiFiles(event.target.files)}
      />

      <div className="section-title">
        <div>
          <p className="eyebrow">批量发布</p>
          <h2>
            批量发布队列 {summary.readyCount}/{summary.total} 已就绪
          </h2>
        </div>
        <button className="ghost-button" type="button" onClick={onClose}>
          返回单篇发布
        </button>
      </div>

      {batchError && <p className="error-message">{batchError}</p>}
      {publishLock && publishLock.state !== "missing" && (
        <p className="warning-text">当前存在发布锁（{publishLock.state}），发布前需要先释放。</p>
      )}

      {view === "queue" && (
        <>
          {resumeCandidates.length > 0 && (
            <div className="panel warning-list">
              <p className="eyebrow">检测到未完成的批量发布</p>
              {resumeCandidates.map((candidate) => {
                const unpushed = ["committed", "push_checking", "push_ready"].includes(candidate.status);
                return (
                  <div className="profile-row" key={candidate.batchId}>
                    <span className="full">
                      <strong>{unpushed ? "尚未推送的批次" : `批次 ${candidate.batchId.slice(0, 8)}`}</strong>
                      <small>
                        {unpushed
                          ? `文章：${candidate.items.filter((item) => item.status === "committed").length} · Commits：${candidate.batchCommitHashes.length} · 状态：等待 Push`
                          : `已完成 ${candidate.completedCount}/${candidate.items.length} · 失败 ${candidate.failedCount}`}
                      </small>
                    </span>
                    <span className="actions">
                      <button className="secondary-button" type="button" onClick={() => resumeBatch(candidate)}>
                        {unpushed ? "继续推送" : "继续"}
                      </button>
                      <button className="ghost-button" type="button" onClick={() => void abandonBatch(candidate)}>
                        放弃
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {batch.items.length === 0 ? (
            <div className="upload-panel">
              <p className="muted-text">
                一次选择多篇 Markdown（最多 {MAX_BATCH_ITEMS} 篇）。系统不会自动读取仓库中的未跟踪私人文件，只有你明确选择的文件才会进入队列。
              </p>
              <div className="actions">
                <button className="primary-button" type="button" onClick={() => void importBatch()} disabled={busy}>
                  {busy ? "正在选择…" : "批量选择 Markdown"}
                </button>
              </div>
            </div>
          ) : (
            <div className="list-panel">
              {orderedReviewItems().map((item) => (
                <div className="profile-row" key={item.id}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(event) => handleToggleSelected(item.id, event.target.checked)}
                    />
                  </label>
                  <span className="full">
                    <strong>
                      {item.status === "committed" ? "✓ " : item.status === "failed" ? "✕ " : item.status === "skipped" ? "⊘ " : ""}
                      {item.displayName}
                    </strong>
                    <small>
                      {statusLabel(item.status)}
                      {item.warnings.length > 0 ? ` · ${item.warnings.length} 个警告` : ""}
                      {item.errors.length > 0 ? ` · ${item.errors[item.errors.length - 1]?.message}` : ""}
                      {item.draft?.preview.workspacePlan ? ` · ${item.draft.preview.workspacePlan.plannedFiles.filter((file) => file.path.startsWith("public/")).length} 张图片` : ""}
                    </small>
                  </span>
                  <span className="actions">
                    <button className="icon-button" type="button" title="上移" onClick={() => handleMove(item.id, "up")} aria-label={`上移 ${item.displayName}`}>
                      ↑
                    </button>
                    <button className="icon-button" type="button" title="下移" onClick={() => handleMove(item.id, "down")} aria-label={`下移 ${item.displayName}`}>
                      ↓
                    </button>
                    <button className="secondary-button" type="button" onClick={() => openReview(item.id)}>
                      查看
                    </button>
                    <button className="ghost-button" type="button" onClick={() => handleReparse(item.id)}>
                      重新解析
                    </button>
                    {item.status === "skipped" ? (
                      <button className="ghost-button" type="button" onClick={() => handleRestore(item.id)}>
                        恢复
                      </button>
                    ) : (
                      <button className="ghost-button" type="button" onClick={() => handleSkip(item.id)}>
                        跳过
                      </button>
                    )}
                    <button className="ghost-button" type="button" onClick={() => handleRemove(item.id)}>
                      移除
                    </button>
                  </span>
                </div>
              ))}

              <div className="actions">
                <button className="secondary-button" type="button" onClick={() => void importBatch()} disabled={busy}>
                  继续导入
                </button>
              </div>

              <div className="panel preflight-summary">
                <p className="eyebrow">准备发布 {preflight.total} 篇笔记</p>
                <div className="status-grid">
                  <span>新建：{preflight.newCount}</span>
                  <span>更新：{preflight.updateCount}</span>
                  <span>图片：{preflight.imageCount}</span>
                  <span>独立 Commit：{preflight.commitCount}</span>
                  <span>最终 Push：{preflight.pushCount} 次</span>
                  <span>已就绪：{preflight.readyCount}</span>
                  <span>有警告：{preflight.warningCount}</span>
                  <span>失败：{preflight.failedCount}</span>
                </div>
                <p className="muted-text">未跟踪私人文件不会被提交或推送，只有选中的队列项会进入本批次。</p>
                {!executionGate.allowed && <p className="warning-text">{executionGate.reasons.join(" ")}</p>}
                <div className="actions">
                  <button className="primary-button" type="button" onClick={() => void startExecution()} disabled={busy}>
                    开始批量发布
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {view === "review" && (
        <div className="form-panel">
          <p className="eyebrow">逐篇审核</p>
          <h3>{reviewingItem?.displayName ?? "审核中"}</h3>
          {reviewingItem?.status === "parsing" && <p className="muted-text">正在解析 Markdown…</p>}
          {reviewingItem?.status === "failed" && (
            <p className="error-message">
              {reviewingItem.errors[reviewingItem.errors.length - 1]?.message ?? "解析失败。"}
            </p>
          )}
          {reviewingItem?.draft && (
            <>
              <label className="search-label">
                标题
                <input value={reviewingItem.draft.article.title} onChange={(event) => updateReview({ title: event.target.value })} />
              </label>
              <label className="search-label">
                摘要
                <textarea
                  rows={3}
                  value={reviewingItem.draft.article.description}
                  onChange={(event) => updateReview({ description: event.target.value })}
                />
              </label>
              <label className="search-label">
                Slug
                <input value={reviewingItem.draft.article.slug} onChange={(event) => updateReview({ slug: event.target.value })} />
              </label>
              <label className="search-label">
                标签（逗号分隔）
                <input
                  value={reviewingItem.draft.article.tags.join(", ")}
                  onChange={(event) =>
                    updateReview({
                      tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean)
                    })
                  }
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={reviewingItem.draft.article.draft}
                  onChange={(event) => updateReview({ draft: event.target.checked })}
                />{" "}
                草稿
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={reviewingItem.draft.article.featured}
                  onChange={(event) => updateReview({ featured: event.target.checked })}
                />{" "}
                精选
              </label>

              <div className="profile-group">
                <h3>归档方案</h3>
                {profiles.map((profile) => (
                  <button
                    className={`profile-row ${reviewingItem.draft?.archive.selectedProfileId === profile.id ? "selected" : ""}`}
                    key={profile.id}
                    type="button"
                    onClick={() => selectReviewProfile(profile.id)}
                  >
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.directory}</small>
                    </span>
                    <span aria-hidden="true">{reviewingItem.draft?.archive.selectedProfileId === profile.id ? "●" : "○"}</span>
                  </button>
                ))}
              </div>

              <p className="muted-text">
                图片：{reviewingItem.draft.assets.dependencies.length} 张 · 检测状态：
                {canContinueFromAssets(reviewingItem.draft.assets.dependencies) ? "可继续" : "需处理"}
              </p>
              {reviewGates(reviewingItem.draft).reasons.map((reason) => (
                <p className="warning-text" key={reason}>
                  {reason}
                </p>
              ))}

              <div className="actions">
                <button className="ghost-button" type="button" onClick={() => navigateReview("prev")}>
                  上一篇
                </button>
                <button className="primary-button" type="button" onClick={saveAndNext}>
                  保存并审核下一篇
                </button>
                <button className="secondary-button" type="button" onClick={() => setView("queue")}>
                  返回队列
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view === "executing" && (
        <div className="panel write-section">
          <p className="eyebrow">队列执行</p>
          <p className="muted-text">
            已完成：{batch.completedCount} · 失败：{batch.failedCount} · 未开始：{notStartedCount}
          </p>

          {currentItem && (
            <div className="workspace-card" aria-live="polite">
              <p className="eyebrow">
                第 {currentItem.order + 1}/{batch.items.length} 篇
              </p>
              <h3>{currentItem.draft?.article.title || currentItem.displayName}</h3>
              <ul className="validation-list">
                <li className={currentItem.workspaceId ? "check-pass" : ""}>
                  {currentItem.workspaceId ? "✓ 工作区已生成" : "○ 生成工作区"}
                </li>
                <li
                  className={
                    currentItem.status === "writing"
                      ? "check-fail"
                      : (WRITTEN_STATUSES as readonly string[]).includes(currentItem.status)
                        ? "check-pass"
                        : ""
                  }
                >
                  {currentItem.status === "writing"
                    ? "● 正在写入正式文件"
                    : (WRITTEN_STATUSES as readonly string[]).includes(currentItem.status)
                      ? "✓ 正式文件已写入"
                      : "○ 写入正式文件"}
                </li>
                <li
                  className={
                    currentItem.status === "committing"
                      ? "check-fail"
                      : currentItem.status === "committed"
                        ? "check-pass"
                        : ""
                  }
                >
                  {currentItem.status === "committing"
                    ? "● 正在创建独立 Commit"
                    : currentItem.status === "committed"
                      ? "✓ 独立 Commit 已创建"
                      : "○ 等待创建 Commit"}
                </li>
                {currentItem.status === "committed" && <li>○ 等待下一篇</li>}
              </ul>
            </div>
          )}

          {orderedReviewItems().map((item) => (
            <div className="profile-row" key={item.id}>
              <span className="full">
                <strong>
                  {item.status === "committed" ? "✓ " : item.status === "failed" ? "✕ " : ""}
                  {item.displayName}
                </strong>
                <small>{statusLabel(item.status)}</small>
              </span>
            </div>
          ))}

          {failedItem && (
            <div className="panel warning-list" role="alert">
              <p className="eyebrow">批量发布已暂停</p>
              <p>
                第 {failedItem.order + 1}/{batch.items.length} 篇失败
              </p>
              <p>
                文章：<strong>{failedItem.displayName}</strong>
              </p>
              <p>阶段：{stageLabel(failedItem.failedStage)}</p>
              <p className="error-message">{failedItem.errors[failedItem.errors.length - 1]?.message ?? "未知错误。"}</p>
              <p className="muted-text">
                已完成：{batch.completedCount} · 未开始：{notStartedCount}
              </p>
              <div className="actions">
                <button className="primary-button" type="button" onClick={() => void retryCurrent()}>
                  重试当前项
                </button>
                <button className="secondary-button" type="button" onClick={() => void skipCurrent()}>
                  跳过当前项并继续
                </button>
                <button className="secondary-button" type="button" onClick={editCurrent}>
                  返回编辑当前项
                </button>
                <button className="ghost-button" type="button" onClick={endBatch}>
                  结束本批次
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === "push" && (
        <div className="panel push-confirmation">
          <p className="eyebrow">整批推送确认</p>
          <h3>准备推送本批次</h3>
          <p>文章：{batch.items.filter((item) => item.status === "committed").length} 篇</p>
          <p>Commits：{batch.batchCommitHashes.length} 个</p>
          <p>Commit 范围：{batch.pushCommitRange ?? "—"}</p>
          {remoteInspect && (
            <>
              <p>
                远程：{remoteInspect.remoteOwner}/{remoteInspect.remoteRepo}
              </p>
              <p>分支：{remoteInspect.branch ?? "master"}</p>
              <p>未跟踪文件：{remoteInspect.untrackedFiles ?? 0} 个，不会被推送</p>
            </>
          )}
          {batchError && <p className="error-message">{batchError}</p>}
          <div className="actions">
            {remoteInspect?.canPush && (
              <button className="primary-button" type="button" onClick={() => void confirmBatchPush()}>
                确认推送到 GitHub（仅 1 次）
              </button>
            )}
            <button className="ghost-button" type="button" onClick={() => setView("queue")}>
              返回队列
            </button>
          </div>
        </div>
      )}

      {view === "results" && (
        <div className="panel publish-success">
          <p className="eyebrow">批量公开发布成功</p>
          <h3>批量公开发布成功</h3>
          <div className="status-grid">
            <span>成功：{batch.completedCount}</span>
            <span>跳过：{batch.skippedCount}</span>
            <span>失败：{batch.failedCount}</span>
            <span>Commit：{batch.batchCommitHashes.length}</span>
            <span>Push：1 次</span>
            <span>Pages：部署成功</span>
          </div>
          <ul className="validation-list">
            {committedItems.map((item) => (
              <li key={item.id} className="check-pass">
                <strong>{item.draft?.article.title || item.displayName}</strong>
                <small>Slug：{item.draft?.article.slug ?? "—"}</small>
                <small>Commit：{item.commitHash ? item.commitHash.slice(0, 7) : "—"}</small>
                {articleUrls[item.id] && (
                  <small>
                    <a href={articleUrls[item.id]} target="_blank" rel="noreferrer">
                      {articleUrls[item.id]}
                    </a>
                  </small>
                )}
                {articleUrls[item.id] && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => window.open(articleUrls[item.id], "_blank")}
                  >
                    打开文章
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="secondary-button" type="button" onClick={() => window.open(SITE_HOME, "_blank")}>
              打开网站首页
            </button>
            <button className="secondary-button" type="button" onClick={() => window.open(commitsUrl(), "_blank")}>
              查看本批次 Commits
            </button>
            <button className="secondary-button" type="button" onClick={publishNextBatch}>
              发布下一批
            </button>
            <button className="primary-button" type="button" onClick={onClose}>
              返回单篇发布
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
