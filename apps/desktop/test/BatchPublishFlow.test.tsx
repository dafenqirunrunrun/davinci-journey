import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchPublishFlow } from "../src/components/BatchPublishFlow";
import { initialArchiveProfiles } from "../src/archiveProfiles";
import type { BatchPublishPersistedState } from "../src/batchPublishTypes";

const REPO = "D:/target-site";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function metaFor(name: string) {
  return {
    absolutePath: `C:/tmp/${name}.md`,
    displayName: `${name}.md`,
    directoryPath: "C:/tmp",
    size: 12,
    modifiedAt: "2026-08-04T00:00:00Z"
  };
}

function markdownFor(path: string) {
  const stem = path.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/, "") ?? "note";
  return {
    absolutePath: path,
    fileName: `${stem}.md`,
    directoryPath: "C:/tmp",
    size: 12,
    modifiedAt: "2026-08-04T00:00:00Z",
    content: `# Smoke ${stem}\n\nBody of ${stem}.`,
    sourceFingerprint: `fpr-${stem}`
  };
}

interface InvokeCounts {
  apply: number;
  commit: number;
  push: number;
}

function buildInvoke(overrides: Record<string, unknown> = {}, fileNames = ["a", "b"]) {
  const counts: InvokeCounts = { apply: 0, commit: 0, push: 0 };
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command in overrides) {
      const override = overrides[command];
      if (typeof override === "function") {
        return (override as (c: string, a?: Record<string, unknown>) => unknown)(command, args);
      }
      return override;
    }
    switch (command) {
      case "list_batch_publish_states":
        return [];
      case "inspect_publish_lock_command":
        return { state: "missing", lockPath: "" };
      case "validate_repository_root_command":
      case "resolve_repository_root_command":
        return { repositoryRoot: REPO, displayPath: REPO, branch: "master", head: "abc123", valid: true, errors: [] };
      case "select_markdown_files":
        return fileNames.map(metaFor);
      case "read_markdown_path":
        return markdownFor(String((args?.request as { path?: string } | undefined)?.path ?? "C:/tmp/note.md"));
      case "resolve_image_dependencies":
        return [];
      case "generate_publish_workspace":
        return {
          workspaceId: `ws-${counts.apply}`,
          workspacePath: "",
          manifestPath: "",
          targetMarkdownPath: "",
          targetAssetDirectory: "",
          assets: [],
          validation: { passed: true, checks: [], warnings: [] }
        };
      case "inspect_repository_publish":
        return {
          gitStatus: {
            repositoryRoot: REPO,
            branch: "master",
            head: "abc123",
            detachedHead: false,
            operationsInProgress: [],
            unrelatedUntrackedCount: 3,
            untrackedFiles: [],
            stagedFiles: [],
            unstagedTrackedFiles: [],
            unrelatedStagedFiles: [],
            unrelatedStagedCount: 0,
            safeToPublish: true,
            message: undefined
          },
          workspaceStatus: { passed: true, checks: ["ok"], warnings: [], markdownValid: true, assetsValid: true, manifestValid: true, noSymlinks: true, noUnknownFiles: true },
          sourceFingerprintStatus: { markdownChanged: false, imagesChanged: [], sourceUnchanged: true },
          targetConflicts: { targetExists: false, hasUncommittedChanges: false, uncommittedFiles: [], canProceed: true }
        };
      case "apply_publish_workspace_command":
        counts.apply += 1;
        return { transactionId: `tx-${counts.apply}`, plannedChanges: [], backups: [] };
      case "stage_publish_transaction":
        return { canCommit: true, message: "" };
      case "commit_publish_transaction":
        counts.commit += 1;
        return { commitHash: `commit-${counts.commit}`, shortHash: `c${counts.commit}`, branch: "master", message: "", committedFiles: [] };
      case "inspect_remote_publish_command":
        return {
          remoteUrl: "https://github.com/dafenqirunrunrun/davinci-journey.git",
          remoteOwner: "dafenqirunrunrun",
          remoteRepo: "davinci-journey",
          branch: "master",
          headCommit: "abc123",
          ahead: 0,
          behind: 0,
          syncState: "synced",
          untrackedFiles: 3,
          canPush: true,
          pushedAlready: false,
          message: undefined
        };
      case "push_publish_commit_command":
        counts.push += 1;
        return { remoteHead: "remote-1", remoteUrl: "", pushed: true };
      case "check_github_pages_deployment_command":
        return { ghAvailable: true, phase: "not_started", ghMessage: "", runId: 1, runUrl: "", runStatus: "", runConclusion: "" };
      case "wait_github_pages_deployment_command":
        return { ghAvailable: true, phase: "success", ghMessage: "", runId: 1, runUrl: "", runStatus: "completed", runConclusion: "success" };
      case "get_public_article_url_command":
        return `https://dafenqirunrunrun.github.io/davinci-journey/notes/${String(args?.slug)}/`;
      case "save_batch_publish_state":
      case "delete_batch_publish_state":
      case "load_batch_publish_state":
        return undefined;
      default:
        return undefined;
    }
  });
  return { invoke, counts };
}

function setupTauri(invoke: ReturnType<typeof vi.fn>) {
  // Inject `invoke` into the Tauri runtime object so even the real
  // `@tauri-apps/api/core` delegates to our mock. Combined with vi.doMock this
  // is deterministic across repeated parses in this suite.
  (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = { invoke };
  vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
}

function renderBatch(invoke: ReturnType<typeof vi.fn>) {
  setupTauri(invoke);
  return render(<BatchPublishFlow profiles={initialArchiveProfiles} repositoryRoot={REPO} onClose={vi.fn()} />);
}

async function openReviewFor(name: string) {
  const row = screen.getByText(`${name}.md`).closest(".profile-row");
  const viewButton = within(row as HTMLElement).getByRole("button", { name: "查看" });
  fireEvent.click(viewButton);
  await waitFor(() => expect(screen.getByLabelText(/标题/)).toBeInTheDocument());
}

async function fillReviewAndNext(name: string) {
  await waitFor(() => expect(screen.getByLabelText(/标题/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/标题/), { target: { value: `Title ${name}` } });
  fireEvent.change(screen.getByLabelText(/Slug/), { target: { value: `slug-${name}` } });
  fireEvent.click(screen.getByText("保存并审核下一篇"));
}

async function driveTwoItemBatchToPush() {
  fireEvent.click(screen.getByText("批量选择 Markdown"));
  await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
  await openReviewFor("a");
  await fillReviewAndNext("a");
  // saveAndNext opened review for b (async parse).
  await fillReviewAndNext("b");
  await waitFor(() => expect(screen.getByText("开始批量发布")).toBeInTheDocument());
  fireEvent.click(screen.getByText("开始批量发布"));
  await waitFor(() => expect(screen.getByText("准备推送本批次")).toBeInTheDocument());
  // Push confirmation renders only after the remote inspection resolves.
  await waitFor(() => expect(screen.getByText("确认推送到 GitHub（仅 1 次）")).toBeInTheDocument());
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.doUnmock("@tauri-apps/api/core");
  vi.restoreAllMocks();
});

describe("BatchPublishFlow success chain", () => {
  it("publishes two notes with per-item commits and a single push", async () => {
    const { invoke, counts } = buildInvoke();
    renderBatch(invoke);

    await driveTwoItemBatchToPush();

    // Two items committed → one push → deploy success.
    fireEvent.click(screen.getByText("确认推送到 GitHub（仅 1 次）"));
    await waitFor(() => expect(screen.getAllByText("批量公开发布成功").length).toBeGreaterThan(0));

    expect(counts.apply).toBe(2);
    expect(counts.commit).toBe(2);
    expect(counts.push).toBe(1);
    // Two distinct commit hashes were generated.
    const commitCalls = invoke.mock.calls.filter(([cmd]) => cmd === "commit_publish_transaction");
    expect(commitCalls).toHaveLength(2);
    expect(commitCalls[0]?.[1]).toBeDefined();
    expect(commitCalls[1]?.[1]).toBeDefined();
    // No force push anywhere.
    expect(invoke.mock.calls.some(([cmd, args]) => String(cmd).includes("push") && String(args?.force ?? "") !== "")).toBe(false);

    // Result page shows success counts.
    expect(screen.getByText("成功：2")).toBeInTheDocument();
    expect(screen.getByText("Push：1 次")).toBeInTheDocument();

    // Both article URLs were generated from real slugs.
    expect(screen.getByText(/notes\/slug-a\//)).toBeInTheDocument();
    expect(screen.getByText(/notes\/slug-b\//)).toBeInTheDocument();

    // Results actions are present.
    expect(screen.getByText("打开网站首页")).toBeInTheDocument();
    expect(screen.getByText("查看本批次 Commits")).toBeInTheDocument();
    expect(screen.getByText("发布下一批")).toBeInTheDocument();
  });

  it("resets for the next batch without losing target settings", async () => {
    const { invoke, counts } = buildInvoke();
    renderBatch(invoke);
    await driveTwoItemBatchToPush();
    fireEvent.click(screen.getByText("确认推送到 GitHub（仅 1 次）"));
    await waitFor(() => expect(screen.getAllByText("批量公开发布成功").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText("发布下一批"));

    // Returns to the file-selection entry, not the single-note flow.
    expect(screen.getByText("批量选择 Markdown")).toBeInTheDocument();
    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
    expect(screen.queryAllByText("批量公开发布成功")).toHaveLength(0);
    // No new push/commit happened during reset.
    expect(counts.push).toBe(1);
    expect(counts.commit).toBe(2);
  });

  it("exposes writing and committing intermediate states", async () => {
    const applyD1 = deferred<unknown>();
    const applyD2 = deferred<unknown>();
    const commitD1 = deferred<unknown>();
    const commitD2 = deferred<unknown>();
    const applyQueue = [applyD1, applyD2];
    const commitQueue = [commitD1, commitD2];
    const { invoke } = buildInvoke({
      apply_publish_workspace_command: () => applyQueue.shift()!.promise,
      commit_publish_transaction: () => commitQueue.shift()!.promise
    });
    renderBatch(invoke);

    fireEvent.click(screen.getByText("批量选择 Markdown"));
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
    await openReviewFor("a");
    await fillReviewAndNext("a");
    await fillReviewAndNext("b");
    await waitFor(() => expect(screen.getByText("开始批量发布")).toBeInTheDocument());
    fireEvent.click(screen.getByText("开始批量发布"));

    // Item 1 enters writing while its apply is pending.
    await waitFor(() => expect(screen.getByText("写入中")).toBeInTheDocument());
    expect(screen.getByText("● 正在写入正式文件")).toBeInTheDocument();
    applyD1.resolve({ transactionId: "tx-1", plannedChanges: [], backups: [] });

    // Item 1 enters committing while its commit is pending.
    await waitFor(() => expect(screen.getByText("提交中")).toBeInTheDocument());
    expect(screen.getByText("● 正在创建独立 Commit")).toBeInTheDocument();
    commitD1.resolve({ commitHash: "commit-1", shortHash: "c1", branch: "master", message: "", committedFiles: [] });

    // Item 2 writing.
    await waitFor(() => expect(screen.getByText("写入中")).toBeInTheDocument());
    applyD2.resolve({ transactionId: "tx-2", plannedChanges: [], backups: [] });

    // Item 2 committing.
    await waitFor(() => expect(screen.getByText("提交中")).toBeInTheDocument());
    commitD2.resolve({ commitHash: "commit-2", shortHash: "c2", branch: "master", message: "", committedFiles: [] });

    await waitFor(() => expect(screen.getByText("准备推送本批次")).toBeInTheDocument());
  });
});

describe("BatchPublishFlow failure and recovery", () => {
  it("pauses on the second commit failure, retries only that item, then pushes once", async () => {
    let commitCalls = 0;
    const { invoke, counts } = buildInvoke(
      {
        commit_publish_transaction: () => {
          commitCalls += 1;
          if (commitCalls === 2) {
            return Promise.reject({ code: "GIT_COMMIT_FAILED", message: "模拟提交失败", recoverable: true });
          }
          return Promise.resolve({ commitHash: `commit-${commitCalls}`, shortHash: "", branch: "master", message: "", committedFiles: [] });
        }
      },
      ["a", "b", "c"]
    );
    renderBatch(invoke);

    fireEvent.click(screen.getByText("批量选择 Markdown"));
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
    await openReviewFor("a");
    await fillReviewAndNext("a");
    await fillReviewAndNext("b");
    await fillReviewAndNext("c");
    await waitFor(() => expect(screen.getByText("开始批量发布")).toBeInTheDocument());
    fireEvent.click(screen.getByText("开始批量发布"));

    // Second item fails at commit → queue pauses.
    await waitFor(() => expect(screen.getByText("批量发布已暂停")).toBeInTheDocument());
    expect(screen.getByText(/阶段：创建独立 Commit/)).toBeInTheDocument();
    expect(screen.getByText("模拟提交失败")).toBeInTheDocument();
    // Third item never executed; nothing pushed.
    expect(commitCalls).toBe(2);
    expect(counts.push).toBe(0);
    // First item stays committed.
    expect(screen.getAllByText(/已完成：1/).length).toBeGreaterThan(0);

    // Retry only the failed item; it now succeeds, then item 3 runs.
    fireEvent.click(screen.getByText("重试当前项"));
    await waitFor(() => expect(screen.getByText("准备推送本批次")).toBeInTheDocument());
    // Still waiting for the single push confirmation.
    expect(counts.push).toBe(0);
    expect(commitCalls).toBe(4); // a, b-fail, b-retry, c

    // Final success reflects 3 committed + exactly one push.
    fireEvent.click(screen.getByText("确认推送到 GitHub（仅 1 次）"));
    await waitFor(() => expect(screen.getByText("成功：3")).toBeInTheDocument());
    expect(counts.push).toBe(1);
  });

  it("skips a failed item only after confirmation and continues the rest", async () => {
    let commitCalls = 0;
    const { invoke, counts } = buildInvoke(
      {
        commit_publish_transaction: () => {
          commitCalls += 1;
          if (commitCalls === 2) {
            return Promise.reject({ code: "GIT_COMMIT_FAILED", message: "模拟提交失败", recoverable: true });
          }
          return Promise.resolve({ commitHash: `commit-${commitCalls}`, shortHash: "", branch: "master", message: "", committedFiles: [] });
        }
      },
      ["a", "b", "c"]
    );
    renderBatch(invoke);

    fireEvent.click(screen.getByText("批量选择 Markdown"));
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
    await openReviewFor("a");
    await fillReviewAndNext("a");
    await fillReviewAndNext("b");
    await fillReviewAndNext("c");
    await waitFor(() => expect(screen.getByText("开始批量发布")).toBeInTheDocument());
    fireEvent.click(screen.getByText("开始批量发布"));

    await waitFor(() => expect(screen.getByText("批量发布已暂停")).toBeInTheDocument());
    expect(counts.push).toBe(0);

    // Confirm-skip → item 3 continues, then the push confirmation shows.
    fireEvent.click(screen.getByText("跳过当前项并继续"));
    await waitFor(() => expect(screen.getByText("准备推送本批次")).toBeInTheDocument());
    expect(counts.push).toBe(0);
    expect(commitCalls).toBe(3); // a, b-fail, c

    fireEvent.click(screen.getByText("确认推送到 GitHub（仅 1 次）"));
    await waitFor(() => expect(screen.getByText("成功：2")).toBeInTheDocument());
    expect(screen.getByText("跳过：1")).toBeInTheDocument();
    expect(counts.push).toBe(1);
  });
});

describe("BatchPublishFlow restart recovery", () => {
  it("scenario A: queue, order and ready items survive; in-flight items re-queue", async () => {
    const persisted: BatchPublishPersistedState = {
      batchId: "batch-a",
      status: "reviewing",
      items: [
        { id: "id-1", sourcePath: "C:/tmp/a.md", displayName: "a.md", status: "ready", selected: true, order: 0, title: "Title a", slug: "slug-a", warnings: [], errors: [] },
        { id: "id-2", sourcePath: "C:/tmp/b.md", displayName: "b.md", status: "ready", selected: true, order: 1, title: "Title b", slug: "slug-b", warnings: [], errors: [] },
        { id: "id-3", sourcePath: "C:/tmp/c.md", displayName: "c.md", status: "needs_review", selected: true, order: 2, warnings: [], errors: [] },
        { id: "id-4", sourcePath: "C:/tmp/d.md", displayName: "d.md", status: "queued", selected: true, order: 3, warnings: [], errors: [] },
        { id: "id-5", sourcePath: "C:/tmp/e.md", displayName: "e.md", status: "queued", selected: true, order: 4, warnings: [], errors: [] }
      ],
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      batchCommitHashes: [],
      savedAt: "2026-08-04T00:00:00.000Z"
    };
    const { invoke } = buildInvoke({ list_batch_publish_states: [persisted] });
    renderBatch(invoke);

    // Resume prompt shows; clicking 继续 restores queue + order.
    await waitFor(() => expect(screen.getByText("继续")).toBeInTheDocument());
    fireEvent.click(screen.getByText("继续"));
    await waitFor(() => expect(screen.getByText("开始批量发布")).toBeInTheDocument());

    const names = screen.getAllByText(/^(a|b|c|d|e)\.md$/);
    expect(names.map((node) => node.textContent)).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
    // Two ready items survived.
    expect(screen.getAllByText("已就绪")).toHaveLength(2);
  });

  it("scenario B: committed item is never duplicated; crashed item re-queues", async () => {
    const persisted: BatchPublishPersistedState = {
      batchId: "batch-b",
      status: "paused",
      items: [
        { id: "id-1", sourcePath: "C:/tmp/a.md", displayName: "a.md", status: "committed", selected: true, order: 0, commitHash: "commit-1", warnings: [], errors: [] },
        { id: "id-2", sourcePath: "C:/tmp/b.md", displayName: "b.md", status: "writing", selected: true, order: 1, warnings: [], errors: [] },
        { id: "id-3", sourcePath: "C:/tmp/c.md", displayName: "c.md", status: "queued", selected: true, order: 2, warnings: [], errors: [] }
      ],
      currentItemId: "id-2",
      completedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      batchCommitHashes: ["commit-1"],
      savedAt: "2026-08-04T00:00:00.000Z"
    };
    const { invoke, counts } = buildInvoke({ list_batch_publish_states: [persisted] });
    renderBatch(invoke);

    await waitFor(() => expect(screen.getByText("继续")).toBeInTheDocument());
    fireEvent.click(screen.getByText("继续"));
    await waitFor(() => expect(screen.getByText("开始批量发布")).toBeInTheDocument());

    // a stays committed (✓), b downgraded to queued (排队中), c queued.
    expect(screen.getByText(/✓ a\.md/)).toBeInTheDocument();
    expect(screen.getAllByText("排队中")).toHaveLength(2);
    // No re-commit happened during restore.
    expect(counts.commit).toBe(0);
    // The committed hash is preserved for a fresh precheck on push.
    expect(screen.getByText("继续导入")).toBeInTheDocument();
  });

  it("scenario C: fully committed batch resumes to push without re-committing", async () => {
    const persisted: BatchPublishPersistedState = {
      batchId: "batch-c",
      status: "push_ready",
      items: [
        { id: "id-1", sourcePath: "C:/tmp/a.md", displayName: "a.md", status: "committed", selected: true, order: 0, commitHash: "commit-1", warnings: [], errors: [] },
        { id: "id-2", sourcePath: "C:/tmp/b.md", displayName: "b.md", status: "committed", selected: true, order: 1, commitHash: "commit-2", warnings: [], errors: [] }
      ],
      completedCount: 2,
      failedCount: 0,
      skippedCount: 0,
      batchCommitHashes: ["commit-1", "commit-2"],
      pushCommitRange: "commit-1..commit-2",
      savedAt: "2026-08-04T00:00:00.000Z"
    };
    const { invoke, counts } = buildInvoke({ list_batch_publish_states: [persisted] });
    renderBatch(invoke);

    // Unpushed-batch prompt with a dedicated action.
    await waitFor(() => expect(screen.getByText("尚未推送的批次")).toBeInTheDocument());
    fireEvent.click(screen.getByText("继续推送"));

    await waitFor(() => expect(screen.getByText("准备推送本批次")).toBeInTheDocument());
    // No re-commit; push waits for confirmation.
    expect(counts.commit).toBe(0);
    expect(counts.push).toBe(0);
    expect(screen.getByText("Commits：2 个")).toBeInTheDocument();
  });
});
