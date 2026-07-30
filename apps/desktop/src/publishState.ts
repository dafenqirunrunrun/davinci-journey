import type { ArchiveProfileChange } from "@davinci-journey/classification";
import type { ParsedMarkdownDocument } from "@davinci-journey/markdown-core";
import type { GeneratePublishWorkspaceResult } from "./desktopBridge";

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
  };
  status: "selecting" | "parsing" | "needs_attention" | "ready" | "generating_workspace" | "workspace_ready" | "failed";
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
  status: "selecting"
};

export function canContinueFromAssets(dependencies: ResolvedImageDependency[]): boolean {
  return !dependencies.some((dependency) => ["missing", "ambiguous", "unsafe", "unsupported"].includes(dependency.status));
}
