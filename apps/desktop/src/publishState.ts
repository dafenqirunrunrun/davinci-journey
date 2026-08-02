import type { ArchiveProfileChange } from "@davinci-journey/classification";
import type { ParsedMarkdownDocument } from "@davinci-journey/markdown-core";
import type { ApplyWorkspaceResult, CommitTransactionResult, GeneratePublishWorkspaceResult, PrePublishCheckResult, RepositoryRootResult, StageTransactionResult } from "./desktopBridge";

export interface SelectedMarkdownFile {
  absolutePath: string;
  fileName: string;
  directoryPath: string;
  size: number;
  modifiedAt?: string;
  content: string;
}

export type ImageDependencyStatus = "resolved" | "missing" | "remote" | "embedded" | "ambiguous" | "unsupported" | "unsafe";

export interface ImageCandidate {
  absolutePath: string;
  fileName: string;
  size: number;
  mimeType?: string;
  sha256?: string;
}

export interface ResolvedImageDependency {
  referenceId: string;
  originalSource: string;
  status: ImageDependencyStatus;
  resolvedPath?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  message?: string;
  candidates?: ImageCandidate[];
}

export type AssetResolutionChoice = "replace" | "remove" | "keep_pending";

export interface PublishWorkspacePlan {
  workspaceId: string;
  sourceMarkdownPath: string;
  outputMarkdownPath: string;
  outputAssetDirectory: string;
  plannedFiles: PlannedFileChange[];
}

export type PlannedFileChange = { type: "create"; path: string; source?: string } | { type: "update"; path: string } | { type: "delete"; path: string };

export type PublishStatus =
  | "selecting"
  | "parsing"
  | "needs_attention"
  | "ready"
  | "generating_workspace"
  | "workspace_ready"
  | "checking_repo"
  | "confirm_write"
  | "precheck_failed"
  | "writing"
  | "write_failed"
  | "written"
  | "viewing_diff"
  | "staging"
  | "stage_failed"
  | "confirm_commit"
  | "commit_failed"
  | "committed"
  | "rolling_back"
  | "failed";

export interface RepositoryPublishState {
  repositoryRootResult?: RepositoryRootResult;
  preCheckResult?: PrePublishCheckResult;
  applyResult?: ApplyWorkspaceResult;
  stageResult?: StageTransactionResult;
  commitResult?: CommitTransactionResult;
  diffResult?: string;
  transactionId?: string;
  failedStage?: string;
}

export type RemotePublishStatus =
  | "idle"
  | "checking"
  | "ready_to_push"
  | "push_confirmation"
  | "remote_conflict"
  | "pushing"
  | "pushed"
  | "verifying_remote"
  | "waiting_for_workflow"
  | "deployment_succeeded"
  | "deployment_failed"
  | "website_verifying"
  | "published"
  | "push_failed"
  | "verification_failed";

export interface RemotePublishState {
  status: RemotePublishStatus;
  repositoryRoot: string;
  remoteName: string;
  remoteUrl?: string;
  remoteOwner?: string;
  remoteRepo?: string;
  branch: string;
  localCommitHash: string;
  remoteCommitHash?: string;
  ahead?: number;
  behind?: number;
  untrackedFiles?: number;
  inspectMessage?: string;
  workflowRunId?: number;
  workflowUrl?: string;
  workflowStatus?: string;
  workflowConclusion?: string;
  publicSiteUrl?: string;
  publicArticleUrl?: string;
  error?: string;
}

export interface PublishDraft {
  id: string;
  source: {
    markdownFile?: SelectedMarkdownFile;
    parsedDocument?: ParsedMarkdownDocument;
  };
  assets: {
    dependencies: ResolvedImageDependency[];
    userResolutions: Record<string, AssetResolutionChoice>;
  };
  article: {
    title: string;
    description: string;
    slug: string;
    tags: string[];
    date: string;
    updated: string;
    draft: boolean;
    featured: boolean;
  };
  archive: {
    selectedProfileId?: string;
    recommendedProfileIds: string[];
    pendingProfileChanges: ArchiveProfileChange[];
  };
  preview: {
    markdownPath?: string;
    assetDirectory?: string;
    workspacePlan?: PublishWorkspacePlan;
    workspaceResult?: GeneratePublishWorkspaceResult;
    /** 发布输出是否自动移除了正文开头的重复一级标题。 */
    leadingTitleRemoved?: boolean;
  };
  repository: RepositoryPublishState;
  remote: RemotePublishState;
  status: PublishStatus;
  error?: string;
}

export const emptyDraft: PublishDraft = {
  id: "draft-initial",
  source: {},
  assets: {
    dependencies: [],
    userResolutions: {}
  },
  article: {
    title: "",
    description: "",
    slug: "",
    tags: [],
    date: "2026-07-30",
    updated: "2026-07-30",
    draft: false,
    featured: false
  },
  archive: {
    recommendedProfileIds: [],
    pendingProfileChanges: []
  },
  preview: {},
  repository: {},
  remote: {
    status: "idle",
    repositoryRoot: "",
    remoteName: "origin",
    branch: "master",
    localCommitHash: ""
  },
  status: "selecting"
};

export function canContinueFromAssets(dependencies: ResolvedImageDependency[]): boolean {
  return !dependencies.some((dependency) => ["missing", "ambiguous", "unsafe", "unsupported"].includes(dependency.status));
}
