import type { ArchiveProfile, ArticleInfo } from "@davinci-journey/classification";
import type { MarkdownImageReference } from "@davinci-journey/markdown-core";
import type { ImageCandidate, ResolvedImageDependency, SelectedMarkdownFile } from "./publishState";

export type DesktopCommandErrorCode =
  | "FILE_SELECTION_CANCELLED"
  | "UNSUPPORTED_FILE_EXTENSION"
  | "FILE_TOO_LARGE"
  | "FILE_NOT_FOUND"
  | "FILE_NOT_READABLE"
  | "INVALID_TEXT_ENCODING"
  | "UNSAFE_PATH"
  | "NOT_A_REGULAR_FILE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_NOT_FOUND"
  | "AMBIGUOUS_IMAGE_REFERENCE"
  | "IMAGE_MIME_MISMATCH"
  | "UNSAFE_SVG"
  | "WORKSPACE_CREATE_FAILED"
  | "WORKSPACE_WRITE_FAILED"
  | "WORKSPACE_VALIDATION_FAILED";

export interface DesktopCommandError {
  code: DesktopCommandErrorCode;
  message: string;
  technicalMessage?: string;
  affectedPath?: string;
  recoverable: boolean;
}

export interface SelectMarkdownFileRequest {
  maxBytes?: number;
}

export type SelectedMarkdownFileDto = SelectedMarkdownFile & {
  sourceFingerprint: string;
};

export type ImageCandidateDto = ImageCandidate;

export interface ResolvedImageDependencyDto extends Omit<ResolvedImageDependency, "candidates"> {
  candidates?: ImageCandidateDto[];
}

export interface ResolveImageDependenciesRequest {
  markdownFile: SelectedMarkdownFileDto;
  references: MarkdownImageReference[];
  obsidian?: {
    enabled?: boolean;
    vaultRoot?: string;
    attachmentDirectories?: string[];
  };
}

export interface GeneratePublishWorkspaceRequest {
  repositoryRoot: string;
  sourceMarkdownPath: string;
  sourceFingerprint: string;
  markdownContent: string;
  article: ArticleInfo;
  archiveProfile: ArchiveProfile;
  imageReferences: MarkdownImageReference[];
  dependencies: ResolvedImageDependencyDto[];
  pendingArchiveProfiles: ArchiveProfile[];
}

export interface WorkspaceAssetResult {
  referenceId: string;
  sourcePath?: string;
  targetPath?: string;
  publicPath?: string;
  sha256?: string;
  status: "written" | "reused" | "remote" | "blocked" | "warning";
  warning?: PublishWarning;
}

export interface PublishWarning {
  code: string;
  message: string;
  referenceId?: string;
  path?: string;
}

export interface PublishValidationCheck {
  code: string;
  label: string;
  passed: boolean;
  message?: string;
}

export interface PublishValidationResult {
  passed: boolean;
  checks: PublishValidationCheck[];
  warnings: PublishWarning[];
}

export interface GeneratePublishWorkspaceResult {
  workspaceId: string;
  workspacePath: string;
  manifestPath: string;
  targetMarkdownPath: string;
  targetAssetDirectory: string;
  assets: WorkspaceAssetResult[];
  validation: PublishValidationResult;
}

export interface DesktopBridge {
  mode: "tauri" | "browser";
  selectMarkdownFile(request?: SelectMarkdownFileRequest): Promise<SelectedMarkdownFileDto>;
  resolveImageDependencies(request: ResolveImageDependenciesRequest): Promise<ResolvedImageDependencyDto[]>;
  generatePublishWorkspace(request: GeneratePublishWorkspaceRequest): Promise<GeneratePublishWorkspaceResult>;
  discardPublishWorkspace(workspaceId: string): Promise<void>;
  revealPublishWorkspace(path: string): Promise<void>;
}

const MAX_MARKDOWN_SIZE = 10 * 1024 * 1024;

const errorMessages: Record<DesktopCommandErrorCode, string> = {
  FILE_SELECTION_CANCELLED: "已取消选择 Markdown 文件。",
  UNSUPPORTED_FILE_EXTENSION: "文件扩展名不受支持，请选择 .md 或 .markdown 文件。",
  FILE_TOO_LARGE: "Markdown 文件过大，当前上限为 10 MB。",
  FILE_NOT_FOUND: "找不到指定文件。",
  FILE_NOT_READABLE: "文件不可读取，请检查权限。",
  INVALID_TEXT_ENCODING: "文件不是有效的 UTF-8 Markdown 文本。",
  UNSAFE_PATH: "路径不安全，已阻止越界访问。",
  NOT_A_REGULAR_FILE: "目标不是普通文件。",
  UNSUPPORTED_IMAGE_TYPE: "图片格式暂不支持。",
  IMAGE_NOT_FOUND: "找不到 Markdown 引用的本地图片。",
  AMBIGUOUS_IMAGE_REFERENCE: "找到多个同名图片候选，需要手动选择。",
  IMAGE_MIME_MISMATCH: "图片真实类型与扩展名不匹配。",
  UNSAFE_SVG: "SVG 包含不安全内容，已阻止写入。",
  WORKSPACE_CREATE_FAILED: "创建临时发布工作区失败。",
  WORKSPACE_WRITE_FAILED: "写入临时发布工作区失败。",
  WORKSPACE_VALIDATION_FAILED: "临时发布工作区校验失败。"
};

export function desktopErrorMessage(error: unknown): string {
  if (isDesktopCommandError(error)) {
    return error.message || errorMessages[error.code];
  }
  return error instanceof Error ? error.message : "桌面命令执行失败，请重试。";
}

export function isCancelError(error: unknown): boolean {
  return isDesktopCommandError(error) && error.code === "FILE_SELECTION_CANCELLED";
}

export function isDesktopCommandError(error: unknown): error is DesktopCommandError {
  return Boolean(error && typeof error === "object" && "code" in error && typeof (error as DesktopCommandError).code === "string");
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import("@tauri-apps/api/core");
  return api.invoke<T>(command, args);
}

function hasTauriRuntime(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function commandError(code: DesktopCommandErrorCode, message = errorMessages[code]): DesktopCommandError {
  return {
    code,
    message,
    recoverable: code !== "INVALID_TEXT_ENCODING"
  };
}

async function selectedFileFromBrowser(file: File): Promise<SelectedMarkdownFileDto> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (!["md", "markdown"].includes(ext ?? "")) {
    throw commandError("UNSUPPORTED_FILE_EXTENSION");
  }
  if (file.size > MAX_MARKDOWN_SIZE) {
    throw commandError("FILE_TOO_LARGE");
  }

  const content =
    typeof file.text === "function"
      ? await file.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error(errorMessages.FILE_NOT_READABLE));
          reader.readAsText(file, "utf-8");
        });

  if (content.includes("\u0000")) {
    throw commandError("INVALID_TEXT_ENCODING");
  }

  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sourceFingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return {
    absolutePath: "",
    fileName: file.name,
    directoryPath: "浏览器预览模式",
    size: file.size,
    modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
    content,
    sourceFingerprint
  };
}

function browserDependency(reference: MarkdownImageReference): ResolvedImageDependencyDto {
  if (reference.pathKind === "remote") {
    return {
      referenceId: reference.id,
      originalSource: reference.source,
      status: "remote",
      message: "远程图片会保留原始 URL，本轮不会自动下载。"
    };
  }

  if (reference.pathKind === "embedded") {
    return {
      referenceId: reference.id,
      originalSource: "data:image/*;base64,...",
      status: "embedded",
      message: "Base64 图片需要在 Tauri 模式下提取，当前阻止生成工作区。"
    };
  }

  return {
    referenceId: reference.id,
    originalSource: reference.source,
    status: "missing",
    fileName: reference.source.split(/[\\/]/).pop(),
    message: "浏览器预览模式无法读取 Markdown 相邻图片，请在 Tauri 桌面模式下生成真实依赖状态。"
  };
}

export function createBrowserBridge(filePicker: () => Promise<File | undefined>): DesktopBridge {
  return {
    mode: "browser",
    async selectMarkdownFile() {
      const file = await filePicker();
      if (!file) throw commandError("FILE_SELECTION_CANCELLED");
      return selectedFileFromBrowser(file);
    },
    async resolveImageDependencies(request) {
      return request.references.map(browserDependency);
    },
    async generatePublishWorkspace() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不能写入临时发布工作区，请使用 Tauri 桌面模式。");
    },
    async discardPublishWorkspace() {
      return undefined;
    },
    async revealPublishWorkspace() {
      return undefined;
    }
  };
}

export function createTauriBridge(): DesktopBridge {
  return {
    mode: "tauri",
    selectMarkdownFile: (request) => invokeTauri("select_markdown_file", { request }),
    resolveImageDependencies: (request) => invokeTauri("resolve_image_dependencies", { request }),
    generatePublishWorkspace: (request) => invokeTauri("generate_publish_workspace", { request }),
    discardPublishWorkspace: (workspaceId) => invokeTauri("discard_publish_workspace", { workspaceId }),
    revealPublishWorkspace: (path) => invokeTauri("reveal_publish_workspace", { path })
  };
}

export function createDesktopBridge(filePicker: () => Promise<File | undefined>): DesktopBridge {
  return hasTauriRuntime() ? createTauriBridge() : createBrowserBridge(filePicker);
}
