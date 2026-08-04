import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishFlow } from "../src/components/PublishFlow";

const REPO = "D:/target-site";

// A hoisted `vi.mock` (not `vi.doMock`) so every dynamic import of the Tauri
// core resolves to a wrapper that delegates to whatever mock is installed for
// the current test. This avoids the dynamic-import interception timing races
// that made the flow flaky under repeated sequential awaits.
const { mockHolder } = vi.hoisted(() => ({ mockHolder: { invoke: undefined as unknown as ((cmd: string, args?: Record<string, unknown>) => unknown) | undefined } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    const fn = mockHolder.invoke;
    if (!fn) throw new Error("No Tauri invoke mock installed for this test");
    return fn(cmd, args);
  }
}));

function markdownFile(content = "# LangGraph Checkpoint\n\n![图](./images/a.png)\n\nLangGraph checkpoint") {
  return new File([content], "checkpoint.md", { type: "text/markdown", lastModified: Date.UTC(2026, 6, 30) });
}

/**
 * A stateful `invoke` mock that drives the full publish flow through to step 7.
 */
function buildInvoke(overrides: Record<string, unknown> = {}) {
  const invocationLog: string[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    invocationLog.push(command);
    if (command in overrides) {
      const override = (overrides as Record<string, unknown>)[command];
      if (typeof override === "function") {
        return (override as () => unknown)();
      }
      return override;
    }
    if (command === "load_repository_target_settings") {
      return { repositoryRoot: REPO, displayPath: REPO, branch: "master", head: "abc123", valid: true, errors: [] };
    }
    if (command === "validate_repository_root_command" || command === "resolve_repository_root_command") {
      return { repositoryRoot: REPO, displayPath: REPO, branch: "master", head: "abc123", valid: true, errors: [] };
    }
    if (command === "inspect_publish_lock_command") {
      return { state: "missing", lockPath: `${REPO}/.publish.lock` };
    }
    if (command === "cleanup_stale_publish_lock_command") {
      return { state: "missing", lockPath: `${REPO}/.publish.lock` };
    }
    if (command === "select_markdown_file") {
      return {
        absolutePath: "D:/external-notes/checkpoint.md",
        fileName: "checkpoint.md",
        directoryPath: "D:/external-notes",
        size: 32,
        modifiedAt: "2026-07-30T00:00:00Z",
        content: "# LangGraph Checkpoint\n\nLangGraph checkpoint body",
        sourceFingerprint: "a".repeat(64)
      };
    }
    if (command === "resolve_image_dependencies") return [];
    if (command === "generate_publish_workspace") {
      return {
        workspaceId: "ws-1",
        workspacePath: `${REPO}/.publish-workspaces/ws-1`,
        manifestPath: `${REPO}/.publish-workspaces/ws-1/manifest.json`,
        targetMarkdownPath: `${REPO}/content/ai-agent/langgraph/langgraph-checkpoint.md`,
        targetAssetDirectory: `${REPO}/public/assets/notes/langgraph-checkpoint`,
        assets: [],
        validation: { passed: true, checks: [], warnings: [] }
      };
    }
    if (command === "inspect_repository_publish") {
      return {
        gitStatus: {
          repositoryRoot: REPO,
          branch: "master",
          head: "abc123",
          detachedHead: false,
          operationsInProgress: [],
          unrelatedUntrackedCount: 3,
          safeToPublish: true,
          message: undefined
        },
        workspaceStatus: { passed: true, checks: ["ok"], warnings: [], markdownValid: true, assetsValid: true, manifestValid: true, noSymlinks: true, noUnknownFiles: true },
        sourceFingerprintStatus: { markdownChanged: false, imagesChanged: [], sourceUnchanged: true },
        targetConflicts: { targetExists: false, hasUncommittedChanges: false, uncommittedFiles: [], canProceed: true }
      };
    }
    if (command === "apply_publish_workspace_command") {
      return {
        transactionId: "tx-1",
        plannedChanges: [{ path: "content/ai-agent/langgraph/langgraph-checkpoint.md", operation: "create", size: 100 }],
        backups: []
      };
    }
    if (command === "stage_publish_transaction") {
      return { stagedFiles: ["content/ai-agent/langgraph/langgraph-checkpoint.md"], hasUnrelatedStaged: false, unrelatedFiles: [], canCommit: true };
    }
    if (command === "commit_publish_transaction") {
      return {
        commitHash: "commit-1234567890abcdef",
        shortHash: "commit-12",
        branch: "master",
        message: "docs(langgraph): add langgraph-checkpoint with assets",
        committedFiles: ["content/ai-agent/langgraph/langgraph-checkpoint.md"]
      };
    }
    if (command === "inspect_remote_publish_command") {
      return {
        remoteUrl: "https://github.com/dafenqirunrunrun/davinci-journey.git",
        remoteOwner: "dafenqirunrunrun",
        remoteRepo: "davinci-journey",
        branch: "master",
        headCommit: "commit-1234567890abcdef",
        ahead: 1,
        behind: 0,
        syncState: "ahead",
        untrackedFiles: 3,
        canPush: true,
        pushedAlready: false
      };
    }
    if (command === "push_publish_commit_command") {
      return { pushed: true, localHead: "commit-1234567890abcdef", remoteHead: "commit-1234567890abcdef", alreadyPushed: false };
    }
    if (command === "check_github_pages_deployment_command") {
      return { ghAvailable: true, phase: "in_progress", runId: 42, runUrl: "https://github.com/actions/runs/42", headSha: "commit-1234567890abcdef" };
    }
    if (command === "wait_github_pages_deployment_command") {
      return { ghAvailable: true, phase: "success", runId: 42, runUrl: "https://github.com/actions/runs/42", headSha: "commit-1234567890abcdef", runStatus: "completed", runConclusion: "success" };
    }
    if (command === "get_public_article_url_command") {
      return "https://dafenqirunrunrun.github.io/davinci-journey/notes/langgraph-checkpoint/";
    }
    if (command === "verify_public_article_command") {
      return { reachable: true, message: "文章页面可访问。" };
    }
    if (command === "reset_publish_flow_command") {
      return undefined;
    }
    return undefined;
  });
  return { invoke, invocationLog };
}

function setupTauri(invoke: ReturnType<typeof vi.fn>) {
  mockHolder.invoke = invoke;
  // Presence of __TAURI_INTERNALS__ makes hasTauriRuntime() choose the Tauri
  // bridge; the invoke itself is served by the hoisted module mock.
  (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

/**
 * The publish flow drives many sequential async steps through a mocked invoke.
 * Under parallel test workers the default 1s waitFor window can be too short,
 * producing load-dependent flakes, so use a longer, deterministic window here.
 */
async function waitForText(text: string, timeout = 10000) {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument(), { timeout });
}

/** Wait for a button whose text is present but that may start disabled. */
async function waitForEnabledButton(text: string) {
  await waitFor(
    () => {
      const button = screen.getByText(text).closest("button");
      expect(button).not.toBeNull();
      expect((button as HTMLButtonElement).disabled).toBe(false);
    },
    { timeout: 10000 }
  );
}

async function driveToStep7() {
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [markdownFile()] } });
  await waitForText("检查图片");
  fireEvent.click(screen.getByText("下一步"));
  fireEvent.click(screen.getByText("下一步"));
  fireEvent.click(screen.getByText("下一步"));
  // Step 5: generate workspace
  fireEvent.click(screen.getByText("生成发布工作区"));
  // The "写入正式仓库" button renders disabled until the workspace is ready;
  // clicking it while disabled is a silent no-op, so wait until it is enabled.
  await waitForEnabledButton("写入正式仓库");
  // Step 6: write + stage + commit
  fireEvent.click(screen.getByText("写入正式仓库"));
  await waitForText("确认写入正式仓库");
  fireEvent.click(screen.getByText("确认写入正式仓库"));
  await waitForText("准备提交");
  fireEvent.click(screen.getByText("准备提交"));
  await waitForText("确认创建本地 Commit");
  fireEvent.click(screen.getByText("确认创建本地 Commit"));
  await waitForText("推送到 GitHub");
}

afterEach(() => {
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  mockHolder.invoke = undefined;
});

describe("remote publish flow (step 7)", () => {
  // These tests drive a 7-step sequential flow through many awaited mock
  // invokes. Under parallel fork load they need more than the global window, so
  // give them a localized per-test timeout instead of inflating the global one.
  function slowIt(name: string, fn: () => void | Promise<void>) {
    return it(name, fn, 30000);
  }

  slowIt("本地 Commit 后进入第 7 步并最终显示公开发布成功", async () => {
    const { invoke, invocationLog } = buildInvoke();
    setupTauri(invoke);
    render(<PublishFlow />);

    await driveToStep7();
    expect(screen.getByText("本地 Commit 已创建")).toBeInTheDocument();
    expect(screen.getByText(/尚未推送到 GitHub/)).toBeInTheDocument();

    // Click push → step 7 confirmation
    fireEvent.click(screen.getByText("推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("准备推送到 GitHub")).toBeInTheDocument());
    expect(screen.getByText("dafenqirunrunrun/davinci-journey")).toBeInTheDocument();
    expect(screen.getByText(/3 个/)).toBeInTheDocument(); // untracked files

    // Confirm push
    fireEvent.click(screen.getByText("确认推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("公开发布成功")).toBeInTheDocument());
    expect(invocationLog).toContain("push_publish_commit_command");
    expect(invocationLog).toContain("wait_github_pages_deployment_command");
    expect(invocationLog).toContain("verify_public_article_command");
  });

  slowIt("远程冲突时阻止推送", async () => {
    const { invoke } = buildInvoke({
      inspect_remote_publish_command: {
        remoteUrl: "https://github.com/dafenqirunrunrun/davinci-journey.git",
        remoteOwner: "dafenqirunrunrun",
        remoteRepo: "davinci-journey",
        branch: "master",
        headCommit: "commit-1234567890abcdef",
        ahead: 0,
        behind: 2,
        syncState: "remote_ahead",
        untrackedFiles: 3,
        canPush: false,
        message: "GitHub 上存在本地尚未包含的新提交。"
      }
    });
    setupTauri(invoke);
    render(<PublishFlow />);
    await driveToStep7();
    fireEvent.click(screen.getByText("推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("远程状态冲突")).toBeInTheDocument());
    expect(invoke).not.toHaveBeenCalledWith("push_publish_commit_command", expect.anything());
  });

  slowIt("GitHub CLI 缺失时降级为 pushed", async () => {
    const { invoke } = buildInvoke({
      check_github_pages_deployment_command: { ghAvailable: false, phase: "not_started", ghMessage: "GitHub CLI 未安装。" },
      wait_github_pages_deployment_command: { ghAvailable: false, phase: "not_started", ghMessage: "GitHub CLI 未安装。" }
    });
    setupTauri(invoke);
    render(<PublishFlow />);
    await driveToStep7();
    fireEvent.click(screen.getByText("推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("准备推送到 GitHub")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("已成功推送到 GitHub")).toBeInTheDocument());
    expect(screen.queryByText("公开发布成功")).not.toBeInTheDocument();
  });

  slowIt("发布成功后发布下一篇重置流程", async () => {
    const { invoke } = buildInvoke();
    setupTauri(invoke);
    render(<PublishFlow />);
    await driveToStep7();
    fireEvent.click(screen.getByText("推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("确认推送到 GitHub")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("公开发布成功")).toBeInTheDocument());
    fireEvent.click(screen.getByText("发布下一篇"));
    await waitFor(() => expect(screen.getByText("选择 Markdown")).toBeInTheDocument());
  });

  slowIt("只有全部成功才显示公开发布成功（网站验证失败）", async () => {
    const { invoke } = buildInvoke({
      verify_public_article_command: { reachable: false, message: "页面内容不匹配。" }
    });
    setupTauri(invoke);
    render(<PublishFlow />);
    await driveToStep7();
    fireEvent.click(screen.getByText("推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("确认推送到 GitHub")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("网站验证失败")).toBeInTheDocument());
    expect(screen.queryByText("公开发布成功")).not.toBeInTheDocument();
  });

  slowIt("push 失败不重复执行", async () => {
    const { invoke } = buildInvoke({
      push_publish_commit_command: () => { throw new Error("GIT_PUSH_FAILED: 推送失败"); }
    });
    setupTauri(invoke);
    render(<PublishFlow />);
    await driveToStep7();
    fireEvent.click(screen.getByText("推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("确认推送到 GitHub")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认推送到 GitHub"));
    await waitFor(() => expect(screen.getByText("推送失败")).toBeInTheDocument());
    // Only one commit was created (the original); push failure must not re-commit.
    const commitCalls = invoke.mock.calls.filter((c) => c[0] === "commit_publish_transaction");
    expect(commitCalls).toHaveLength(1);
  });
});
