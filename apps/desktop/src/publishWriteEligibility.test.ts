import { describe, expect, it } from "vitest";
import type { PrePublishCheckResult, RepositoryRootResult } from "./desktopBridge";
import { getPublishWriteEligibility } from "./publishWriteEligibility";

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

describe("getPublishWriteEligibility", () => {
  it("enables writing when all prechecks pass", () => {
    const result = getPublishWriteEligibility({ preCheck: preCheck(), repositoryRootInfo: repo(), workspaceId: "workspace-1" });

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("uses successful precheck repository root when repositoryRootInfo is absent", () => {
    const result = getPublishWriteEligibility({ preCheck: preCheck(), workspaceId: "workspace-1" });

    expect(result.allowed).toBe(true);
    expect(result.repositoryRoot).toBe("C:/site");
  });

  it("disables writing when repository root is missing", () => {
    const result = getPublishWriteEligibility({ workspaceId: "workspace-1" });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("REPOSITORY_ROOT_MISSING");
    expect(result.reasons).toContain("PRECHECK_NOT_COMPLETED");
  });

  it("disables writing when repository root is invalid", () => {
    const result = getPublishWriteEligibility({ preCheck: preCheck(), repositoryRootInfo: repo({ valid: false }), workspaceId: "workspace-1" });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("REPOSITORY_INVALID");
  });

  it("disables writing when workspace is invalid", () => {
    const result = getPublishWriteEligibility({
      preCheck: preCheck({ workspaceStatus: { ...preCheck().workspaceStatus, passed: false } }),
      repositoryRootInfo: repo(),
      workspaceId: "workspace-1"
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("WORKSPACE_INVALID");
  });

  it("disables writing when source changed", () => {
    const result = getPublishWriteEligibility({
      preCheck: preCheck({ sourceFingerprintStatus: { markdownChanged: true, imagesChanged: [], sourceUnchanged: false } }),
      repositoryRootInfo: repo(),
      workspaceId: "workspace-1"
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("SOURCE_CHANGED");
  });

  it("disables writing when target conflict exists", () => {
    const result = getPublishWriteEligibility({
      preCheck: preCheck({ targetConflicts: { targetExists: true, hasUncommittedChanges: true, uncommittedFiles: ["content/a.md"], canProceed: false } }),
      repositoryRootInfo: repo(),
      workspaceId: "workspace-1"
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("TARGET_CONFLICT");
  });

  it("disables writing when unrelated repository files are reported", () => {
    const result = getPublishWriteEligibility({
      preCheck: preCheck({ gitStatus: { ...preCheck().gitStatus, unrelatedUntrackedCount: 1, safeToPublish: false } }),
      repositoryRootInfo: repo(),
      workspaceId: "workspace-1"
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("UNRELATED_STAGED_FILES");
  });

  it("disables writing while async write is loading", () => {
    const result = getPublishWriteEligibility({ preCheck: preCheck(), repositoryRootInfo: repo(), workspaceId: "workspace-1", loading: true });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("WRITE_IN_PROGRESS");
  });

  it("clears stale blocking reasons after a fresh valid precheck", () => {
    const failed = getPublishWriteEligibility({
      preCheck: preCheck({ sourceFingerprintStatus: { markdownChanged: true, imagesChanged: [], sourceUnchanged: false } }),
      repositoryRootInfo: repo(),
      workspaceId: "workspace-1"
    });
    const fresh = getPublishWriteEligibility({ preCheck: preCheck(), repositoryRootInfo: repo(), workspaceId: "workspace-1" });

    expect(failed.reasons).toContain("SOURCE_CHANGED");
    expect(fresh.allowed).toBe(true);
    expect(fresh.reasons).toEqual([]);
  });

  it("uses the newly selected repository root after repository changes", () => {
    const nextRepo = repo({ repositoryRoot: "D:/target-site", displayPath: "D:/target-site" });
    const nextPrecheck = preCheck({ gitStatus: { ...preCheck().gitStatus, repositoryRoot: "D:/target-site" } });
    const result = getPublishWriteEligibility({ preCheck: nextPrecheck, repositoryRootInfo: nextRepo, workspaceId: "workspace-1" });

    expect(result.allowed).toBe(true);
    expect(result.repositoryRoot).toBe("D:/target-site");
  });

  it("accepts camelCase DTO fields returned by Rust", () => {
    const dto = preCheck();

    expect(dto.sourceFingerprintStatus.sourceUnchanged).toBe(true);
    expect(dto.targetConflicts.canProceed).toBe(true);
    expect(dto.gitStatus.safeToPublish).toBe(true);
    expect(getPublishWriteEligibility({ preCheck: dto, repositoryRootInfo: repo(), workspaceId: "workspace-1" }).allowed).toBe(true);
  });

  it("does not block on Windows path separator differences", () => {
    const result = getPublishWriteEligibility({
      preCheck: preCheck({ gitStatus: { ...preCheck().gitStatus, repositoryRoot: "D:/target/site" } }),
      repositoryRootInfo: repo({ repositoryRoot: "D:\\target\\site", displayPath: "D:\\target\\site" }),
      workspaceId: "workspace-1"
    });

    expect(result.allowed).toBe(true);
  });
});
