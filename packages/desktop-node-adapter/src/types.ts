import type { MarkdownImageReference } from "@davinci-journey/markdown-core";

export interface SelectedMarkdownFile {
  absolutePath: string;
  fileName: string;
  directoryPath: string;
  size: number;
  modifiedAt?: string;
  content: string;
}

export interface MarkdownFileReadOptions {
  maxSizeBytes: number;
}

export interface ObsidianVaultSettings {
  enabled: boolean;
  vaultRoot?: string;
  attachmentDirectories?: string[];
}

export type ImageDependencyStatus = "resolved" | "missing" | "remote" | "embedded" | "ambiguous" | "unsupported" | "unsafe";

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
  candidates?: string[];
}

export interface ResolveImageDependenciesInput {
  markdownFile: SelectedMarkdownFile;
  references: MarkdownImageReference[];
  obsidian?: ObsidianVaultSettings;
}
