import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PrePublishCheckResult, RepositoryRootResult } from "../desktopBridge";
import { PreCheckResult, RepositoryTargetPanel } from "./PublishFlow";

function preCheck(overrides: Partial<PrePublishCheckResult> = {}): PrePublishCheckResult {
  return {
    gitStatus: {
      repositoryRoot: "C:/site",
      branch: "master",
      head: "abcdef123",
      detachedHead: false,
      operationsInProgress: [],
      unrelatedUntrackedCount: 0,
      untrackedFiles: [],
      stagedFiles: [],
      unstagedTrackedFiles: [],
      unrelatedStagedFiles: [],
      unrelatedStagedCount: 0,
      safeToPublish: true
    },
    workspaceStatus: {
      passed: true,
      checks: ["Manifest 有效"],
      warnings: [],
      markdownValid: true,
      assetsValid: true,
      manifestValid: true,
      noSymlinks: true,
      noUnknownFiles: true
    },
    sourceFingerprintStatus: {
      markdownChanged: false,
      imagesChanged: [],
      sourceUnchanged: true
    },
    targetConflicts: {
      targetExists: false,
      hasUncommittedChanges: false,
      uncommittedFiles: [],
      canProceed: true
    },
    ...overrides
  };
}

function repo(overrides: Partial<RepositoryRootResult> = {}): RepositoryRootResult {
  return {
    repositoryRoot: "C:/site",
    displayPath: "C:/site",
    branch: "master",
    head: "abcdef123",
    valid: true,
    errors: [],
    ...overrides
  };
}

function renderPreCheck(props: Partial<ComponentProps<typeof PreCheckResult>> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn();
  const view = render(
    <PreCheckResult
      preCheck={props.preCheck ?? preCheck()}
      repoRootInfo={props.repoRootInfo ?? repo()}
      workspaceId={props.workspaceId ?? "workspace-1"}
      plannedChanges={props.plannedChanges ?? [{ type: "create", path: "content/ai-agent/langgraph/note.md" }]}
      pendingProfiles={props.pendingProfiles ?? []}
      onConfirm={onConfirm}
      onBack={props.onBack ?? vi.fn()}
      onDiscard={props.onDiscard ?? vi.fn()}
    />
  );
  return { ...view, onConfirm };
}

describe("PreCheckResult write eligibility interaction", () => {
  it("calls apply callback when the confirmation button is enabled", () => {
    const { container, onConfirm } = renderPreCheck();
    const button = container.querySelector("button.primary-button");

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button).not.toBeDisabled();

    fireEvent.click(button!);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not call apply callback when the confirmation button is disabled", () => {
    const { container, onConfirm } = renderPreCheck({ repoRootInfo: repo({ valid: false }) });
    const button = container.querySelector("button.primary-button");

    expect(button).toBeDisabled();

    fireEvent.click(button!);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("目标仓库无效");
  });
  it("keeps the confirmation button enabled when only unrelated untracked files exist", () => {
    const { container } = renderPreCheck({
      preCheck: preCheck({
        gitStatus: {
          ...preCheck().gitStatus,
          unrelatedUntrackedCount: 2,
          untrackedFiles: ["private-a.md", "private-b.md"],
          unrelatedStagedFiles: [],
          unrelatedStagedCount: 0
        }
      })
    });
    const button = container.querySelector("button.primary-button");

    expect(screen.getByText("无关未跟踪文件：2")).toBeInTheDocument();
    expect(screen.getByText("无关已暂存文件：0")).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});

describe("RepositoryTargetPanel publish lock recovery", () => {
  it("shows a cleanup entry for stale publish locks", () => {
    const onCleanup = vi.fn();
    render(
      <RepositoryTargetPanel
        target={repo()}
        publishLock={{
          state: "stale",
          lockPath: "C:/site/.publish.lock",
          transactionId: "tx-stale",
          processId: 999999
        }}
        onChoose={vi.fn()}
        onRevalidate={vi.fn()}
        onCleanupStaleLock={onCleanup}
      />
    );

    expect(screen.getByText("检测到上次异常结束留下的发布锁。")).toBeInTheDocument();
    fireEvent.click(screen.getByText("清理失效锁"));
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it("shows stale lock cleanup even when repository structure is invalid", () => {
    render(
      <RepositoryTargetPanel
        target={repo({
          valid: false,
          message: "目标网站仓库结构不完整，请选择正确的仓库根目录。",
          errors: ["目标仓库缺少 content/ 目录。"]
        })}
        publishLock={{
          state: "stale",
          lockPath: "C:/site/.publish.lock",
          transactionId: "tx-stale"
        }}
        onChoose={vi.fn()}
        onRevalidate={vi.fn()}
        onCleanupStaleLock={vi.fn()}
      />
    );

    expect(screen.getByText("目标网站仓库结构不完整，请选择正确的仓库根目录。")).toBeInTheDocument();
    expect(screen.getByText("检测到上次异常结束留下的发布锁。")).toBeInTheDocument();
    expect(screen.getByText("清理失效锁")).toBeInTheDocument();
  });

  it("blocks cleanup entry for active publish locks", () => {
    render(
      <RepositoryTargetPanel
        target={repo()}
        publishLock={{
          state: "active",
          lockPath: "C:/site/.publish.lock",
          transactionId: "tx-active",
          processId: 123
        }}
        onChoose={vi.fn()}
        onRevalidate={vi.fn()}
        onCleanupStaleLock={vi.fn()}
      />
    );

    expect(screen.getByText("另一个发布流程正在进行中，请等待完成后重新检查。")).toBeInTheDocument();
    expect(screen.queryByText("清理失效锁")).not.toBeInTheDocument();
  });
});
