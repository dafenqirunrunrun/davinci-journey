import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PrePublishCheckResult, RepositoryRootResult } from "../desktopBridge";
import { PreCheckResult } from "./PublishFlow";

function preCheck(overrides: Partial<PrePublishCheckResult> = {}): PrePublishCheckResult {
  return {
    gitStatus: {
      repositoryRoot: "C:/site",
      branch: "master",
      head: "abcdef123",
      detachedHead: false,
      operationsInProgress: [],
      unrelatedUntrackedCount: 0,
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
});
