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
  | "WORKSPACE_VALIDATION_FAILED"
  // Repository publish errors
  | "GIT_REPOSITORY_NOT_FOUND"
  | "GIT_OPERATION_IN_PROGRESS"
  | "GIT_DETACHED_HEAD"
  | "GIT_INDEX_NOT_CLEAN"
  | "GIT_UNRELATED_STAGED_FILES"
  | "GIT_TARGET_HAS_UNCOMMITTED_CHANGES"
  | "GIT_HEAD_CHANGED"
  | "GIT_STAGE_FAILED"
  | "GIT_COMMIT_FAILED"
  | "PUBLISH_WORKSPACE_NOT_FOUND"
  | "PUBLISH_WORKSPACE_STALE"
  | "PUBLISH_SOURCE_CHANGED"
  | "PUBLISH_TARGET_CONFLICT"
  | "PUBLISH_LOCK_EXISTS"
  | "PUBLISH_TRANSACTION_FAILED"
  | "PUBLISH_ROLLBACK_FAILED"
  | "ARCHIVE_CONFIG_CHANGED"
  | "ARCHIVE_PROFILE_CONFLICT"
  | "ARCHIVE_PROFILE_WRITE_FAILED"
  | "REPOSITORY_PATH_UNSAFE"
  | "TARGET_PATH_OUTSIDE_ALLOWED_ROOT";

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

// ─── Repository Publish Types ───────────────────────────────────────────────

export interface PrePublishCheckRequest {
  repositoryRoot: string;
  workspaceId: string;
}

export interface GitRepositoryStatusDto {
  repositoryRoot: string;
  branch?: string;
  head: string;
  detachedHead: boolean;
  operationsInProgress: string[];
  unrelatedUntrackedCount: number;
  untrackedFiles: string[];
  stagedFiles: string[];
  unstagedTrackedFiles: string[];
  unrelatedStagedFiles: string[];
  unrelatedStagedCount: number;
  safeToPublish: boolean;
  message?: string;
}

export interface WorkspaceValidationDto {
  passed: boolean;
  checks: string[];
  warnings: string[];
  markdownValid: boolean;
  assetsValid: boolean;
  manifestValid: boolean;
  noSymlinks: boolean;
  noUnknownFiles: boolean;
}

export interface SourceFingerprintStatus {
  markdownChanged: boolean;
  imagesChanged: string[];
  sourceUnchanged: boolean;
  message?: string;
}

export interface TargetConflictCheck {
  targetExists: boolean;
  hasUncommittedChanges: boolean;
  uncommittedFiles: string[];
  canProceed: boolean;
  message?: string;
}

export interface PrePublishCheckResult {
  gitStatus: GitRepositoryStatusDto;
  workspaceStatus: WorkspaceValidationDto;
  sourceFingerprintStatus: SourceFingerprintStatus;
  targetConflicts: TargetConflictCheck;
}

export interface ArchiveProfileEntryDto {
  id: string;
  name: string;
  category: string;
  topic?: string;
  directory: string;
  defaultTags: string[];
  description?: string;
}

export interface ApplyWorkspaceRequest {
  repositoryRoot: string;
  workspaceId: string;
  operation: string;
  archiveProfileChanges: ArchiveProfileEntryDto[];
}

export interface PlannedChangeDto {
  path: string;
  operation: string;
  size: number;
}

export interface BackupDto {
  path: string;
  hasBackup: boolean;
}

export interface ApplyWorkspaceResult {
  transactionId: string;
  plannedChanges: PlannedChangeDto[];
  backups: BackupDto[];
}

export interface GetPublishDiffRequest {
  repositoryRoot: string;
  paths: string[];
}

export interface FileDiffDto {
  path: string;
  operation: string;
  diffText: string;
  isBinary: boolean;
}

export interface PublishDiffResult {
  diffs: FileDiffDto[];
}

export interface StageTransactionRequest {
  repositoryRoot: string;
  transactionId: string;
}

export interface StageTransactionResult {
  stagedFiles: string[];
  hasUnrelatedStaged: boolean;
  unrelatedFiles: string[];
  canCommit: boolean;
  message?: string;
}

export interface CommitTransactionRequest {
  repositoryRoot: string;
  transactionId: string;
  message: string;
}

export interface CommitTransactionResult {
  commitHash: string;
  shortHash: string;
  branch: string;
  message: string;
  committedFiles: string[];
}

export interface RepositoryRootResult {
  repositoryRoot: string;
  displayPath: string;
  branch?: string;
  head: string;
  valid: boolean;
  message?: string;
  errors: string[];
}

export interface RepositoryTargetSettings {
  repositoryRoot: string;
  displayPath: string;
  branch?: string;
  head?: string;
  validatedAt?: string;
}

export interface RollbackPublishRequest {
  repositoryRoot: string;
  transactionId: string;
}

export interface DesktopBridge {
  mode: "tauri" | "browser";
  selectMarkdownFile(request?: SelectMarkdownFileRequest): Promise<SelectedMarkdownFileDto>;
  resolveImageDependencies(request: ResolveImageDependenciesRequest): Promise<ResolvedImageDependencyDto[]>;
  generatePublishWorkspace(request: GeneratePublishWorkspaceRequest): Promise<GeneratePublishWorkspaceResult>;
  discardPublishWorkspace(workspaceId: string, repositoryRoot?: string): Promise<void>;
  revealPublishWorkspace(path: string): Promise<void>;
  // Repository publish commands
  inspectRepositoryPublish(request: PrePublishCheckRequest): Promise<PrePublishCheckResult>;
  applyPublishWorkspace(request: ApplyWorkspaceRequest): Promise<ApplyWorkspaceResult>;
  getPublishDiff(request: GetPublishDiffRequest): Promise<PublishDiffResult>;
  stagePublishTransaction(request: StageTransactionRequest): Promise<StageTransactionResult>;
  commitPublishTransaction(request: CommitTransactionRequest): Promise<CommitTransactionResult>;
  rollbackRepositoryPublish(request: RollbackPublishRequest): Promise<void>;
  resolveRepositoryRoot(request: string): Promise<RepositoryRootResult>;
  selectRepositoryRoot(): Promise<RepositoryRootResult>;
  validateRepositoryRoot(repositoryRoot: string): Promise<RepositoryRootResult>;
  loadRepositoryTargetSettings(): Promise<RepositoryRootResult | undefined>;
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
  WORKSPACE_VALIDATION_FAILED: "临时发布工作区校验失败。",
  GIT_REPOSITORY_NOT_FOUND: "当前目录不在 Git 仓库中，请在 Git 仓库中运行。",
  GIT_OPERATION_IN_PROGRESS: "Git 操作正在进行中（Merge/Rebase/Cherry-pick/Bisect），请先完成或取消。",
  GIT_DETACHED_HEAD: "当前处于分离 HEAD 状态，请在正常分支上发布。",
  GIT_INDEX_NOT_CLEAN: "工作区存在未提交的变更，请先处理。",
  GIT_UNRELATED_STAGED_FILES: "暂存区包含非本次事务的文件，请先处理已有暂存内容。",
  GIT_TARGET_HAS_UNCOMMITTED_CHANGES: "目标文章存在尚未提交的修改，请先提交或暂存处理。",
  GIT_HEAD_CHANGED: "HEAD 已发生变化，请重新检查仓库状态。",
  GIT_STAGE_FAILED: "Git stage 暂存失败。",
  GIT_COMMIT_FAILED: "Git commit 提交失败。",
  PUBLISH_WORKSPACE_NOT_FOUND: "找不到指定的发布工作区。",
  PUBLISH_WORKSPACE_STALE: "发布工作区已过期，请重新生成。",
  PUBLISH_SOURCE_CHANGED: "源文件在工作区生成后发生了变化，请重新生成发布工作区。",
  PUBLISH_TARGET_CONFLICT: "目标文件冲突，无法自动覆盖。",
  PUBLISH_LOCK_EXISTS: "另一个发布流程正在进行中，请等待完成。",
  PUBLISH_TRANSACTION_FAILED: "发布事务执行失败。",
  PUBLISH_ROLLBACK_FAILED: "发布回滚失败，可能需要手动处理。",
  ARCHIVE_CONFIG_CHANGED: "归档配置在工作区生成后已发生变化，请重新生成。",
  ARCHIVE_PROFILE_CONFLICT: "归档方案冲突，请检查配置。",
  ARCHIVE_PROFILE_WRITE_FAILED: "写入归档配置失败。",
  REPOSITORY_PATH_UNSAFE: "仓库路径不安全。",
  TARGET_PATH_OUTSIDE_ALLOWED_ROOT: "目标路径不在允许的写入根目录内。"
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
    },
    async inspectRepositoryPublish() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持仓库写入操作。");
    },
    async applyPublishWorkspace() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持仓库写入操作。");
    },
    async getPublishDiff() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持 Git 操作。");
    },
    async stagePublishTransaction() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持 Git 操作。");
    },
    async commitPublishTransaction() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持 Git 操作。");
    },
    async rollbackRepositoryPublish() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持仓库写入操作。");
    },
    async resolveRepositoryRoot() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不支持仓库写入操作。");
    },
    async selectRepositoryRoot() {
      throw commandError("WORKSPACE_CREATE_FAILED", "浏览器预览模式不能选择目标网站仓库，请使用 Tauri 桌面模式。");
    },
    async validateRepositoryRoot() {
      return {
        repositoryRoot: "",
        displayPath: "",
        head: "",
        valid: false,
        message: "浏览器预览模式不能验证目标网站仓库。",
        errors: ["浏览器预览模式不能验证目标网站仓库。"]
      };
    },
    async loadRepositoryTargetSettings() {
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
    discardPublishWorkspace: (workspaceId, repositoryRoot) => invokeTauri("discard_publish_workspace", { workspaceId, repositoryRoot }),
    revealPublishWorkspace: (path) => invokeTauri("reveal_publish_workspace", { path }),
    inspectRepositoryPublish: (request) => invokeTauri("inspect_repository_publish", { request }),
    applyPublishWorkspace: (request) => invokeTauri("apply_publish_workspace_command", { request }),
    getPublishDiff: (request) => invokeTauri("get_publish_diff_command", { request }),
    stagePublishTransaction: (request) => invokeTauri("stage_publish_transaction", { request }),
    commitPublishTransaction: (request) => invokeTauri("commit_publish_transaction", { request }),
    rollbackRepositoryPublish: (request) => invokeTauri("rollback_repository_publish", { request }),
    resolveRepositoryRoot: (request) => invokeTauri("resolve_repository_root_command", { request }),
    selectRepositoryRoot: () => invokeTauri("select_repository_root"),
    validateRepositoryRoot: (repositoryRoot) => invokeTauri("validate_repository_root_command", { repositoryRoot }),
    loadRepositoryTargetSettings: () => invokeTauri("load_repository_target_settings")
  };
}

export function createDesktopBridge(filePicker: () => Promise<File | undefined>): DesktopBridge {
  return hasTauriRuntime() ? createTauriBridge() : createBrowserBridge(filePicker);
}
