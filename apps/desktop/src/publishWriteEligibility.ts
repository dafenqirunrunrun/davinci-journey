import type { PrePublishCheckResult, RepositoryRootResult } from "./desktopBridge";

export type PublishWriteBlockReason =
  | "REPOSITORY_ROOT_MISSING"
  | "REPOSITORY_INVALID"
  | "WORKSPACE_MISSING"
  | "WORKSPACE_INVALID"
  | "SOURCE_CHANGED"
  | "TARGET_CONFLICT"
  | "UNRELATED_STAGED_FILES"
  | "GIT_OPERATION_IN_PROGRESS"
  | "PRECHECK_NOT_COMPLETED"
  | "WRITE_IN_PROGRESS"
  | "ALREADY_WRITTEN";

export interface PublishWriteEligibility {
  allowed: boolean;
  repositoryRoot?: string;
  reasons: PublishWriteBlockReason[];
  diagnostics: {
    repositoryRoot?: string;
    workspaceId?: string;
    precheckCompleted: boolean;
    repositoryValid: boolean;
    workspaceValid: boolean;
    sourceChanged: boolean;
    targetConflictCount: number;
    unrelatedStagedCount: number;
    loading: boolean;
  };
}

export interface PublishWriteEligibilityInput {
  preCheck?: PrePublishCheckResult;
  repositoryRootInfo?: RepositoryRootResult;
  workspaceId?: string;
  loading?: boolean;
  alreadyWritten?: boolean;
}

function normalizeWindowsPath(value?: string): string {
  return (value ?? "")
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function hasSameRepositoryRoot(repoRootInfo?: RepositoryRootResult, preCheck?: PrePublishCheckResult): boolean {
  const verifiedRoot = normalizeWindowsPath(repoRootInfo?.repositoryRoot);
  const precheckRoot = normalizeWindowsPath(preCheck?.gitStatus.repositoryRoot);
  return Boolean(verifiedRoot && precheckRoot && verifiedRoot === precheckRoot);
}

export function getPublishWriteEligibility(input: PublishWriteEligibilityInput): PublishWriteEligibility {
  const reasons: PublishWriteBlockReason[] = [];
  const preCheck = input.preCheck;
  const repositoryRoot = input.repositoryRootInfo?.repositoryRoot || preCheck?.gitStatus.repositoryRoot;
  const precheckCompleted = Boolean(preCheck);
  const repositoryRootMatches = hasSameRepositoryRoot(input.repositoryRootInfo, preCheck);
  const repositoryValid = input.repositoryRootInfo
    ? Boolean(input.repositoryRootInfo.valid)
    : Boolean(preCheck?.gitStatus.repositoryRoot || (repositoryRootMatches && preCheck?.gitStatus.safeToPublish));
  const workspaceValid = Boolean(input.workspaceId && preCheck?.workspaceStatus.passed);
  const sourceChanged = Boolean(preCheck && !preCheck.sourceFingerprintStatus.sourceUnchanged);
  const targetConflictCount = preCheck && !preCheck.targetConflicts.canProceed ? Math.max(1, preCheck.targetConflicts.uncommittedFiles.length) : 0;
  const unrelatedStagedCount = preCheck?.gitStatus.unrelatedUntrackedCount ?? 0;
  const gitOperationCount = preCheck?.gitStatus.operationsInProgress.length ?? 0;
  const loading = Boolean(input.loading);

  if (!precheckCompleted) reasons.push("PRECHECK_NOT_COMPLETED");
  if (!repositoryRoot) reasons.push("REPOSITORY_ROOT_MISSING");
  if (repositoryRoot && !repositoryValid) reasons.push("REPOSITORY_INVALID");
  if (!input.workspaceId) reasons.push("WORKSPACE_MISSING");
  if (input.workspaceId && !workspaceValid) reasons.push("WORKSPACE_INVALID");
  if (sourceChanged) reasons.push("SOURCE_CHANGED");
  if (targetConflictCount > 0) reasons.push("TARGET_CONFLICT");
  if (unrelatedStagedCount > 0) reasons.push("UNRELATED_STAGED_FILES");
  if (gitOperationCount > 0) reasons.push("GIT_OPERATION_IN_PROGRESS");
  if (preCheck && !preCheck.gitStatus.safeToPublish && unrelatedStagedCount === 0 && gitOperationCount === 0) reasons.push("UNRELATED_STAGED_FILES");
  if (loading) reasons.push("WRITE_IN_PROGRESS");
  if (input.alreadyWritten) reasons.push("ALREADY_WRITTEN");

  return {
    allowed: reasons.length === 0,
    repositoryRoot,
    reasons,
    diagnostics: {
      repositoryRoot,
      workspaceId: input.workspaceId,
      precheckCompleted,
      repositoryValid,
      workspaceValid,
      sourceChanged,
      targetConflictCount,
      unrelatedStagedCount,
      loading
    }
  };
}

export const publishWriteBlockReasonText: Record<PublishWriteBlockReason, string> = {
  REPOSITORY_ROOT_MISSING: "尚未选择目标仓库。",
  REPOSITORY_INVALID: "目标仓库无效，请重新选择或验证。",
  WORKSPACE_MISSING: "尚未生成发布工作区。",
  WORKSPACE_INVALID: "发布工作区验证未通过。",
  SOURCE_CHANGED: "源 Markdown 或图片已变化，请重新生成工作区。",
  TARGET_CONFLICT: "目标文件存在未提交修改或冲突。",
  UNRELATED_STAGED_FILES: "目标仓库存在无关文件状态，请先处理。",
  GIT_OPERATION_IN_PROGRESS: "目标仓库正在执行 Git 操作，请稍候。",
  PRECHECK_NOT_COMPLETED: "尚未完成写入前预检。",
  WRITE_IN_PROGRESS: "正在写入，请稍候。",
  ALREADY_WRITTEN: "工作区已经写入，请继续查看 Diff 或暂存。"
};
