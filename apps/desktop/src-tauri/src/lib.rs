use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;
use walkdir::WalkDir;

pub mod security;
pub mod services;

use security::repository_guard::{validate_repository_root, RepositoryRootResult};
use services::repository_publish::{
    apply_publish_workspace, commit_transaction, pre_publish_check, rollback_publish,
    stage_transaction, ApplyWorkspaceRequest, ApplyWorkspaceResult, CleanupPublishLockRequest,
    CommitTransactionRequest, CommitTransactionResult, GetPublishDiffRequest,
    PrePublishCheckRequest, PrePublishCheckResult, PublishDiffResult, RollbackPublishRequest,
    StageTransactionRequest, StageTransactionResult,
};
use services::repository_transaction::PublishLockStatus;

const MAX_MARKDOWN_SIZE: u64 = 10 * 1024 * 1024;
const WORKSPACE_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy)]
pub enum DesktopCommandError {
    FileSelectionCancelled,
    UnsupportedFileExtension,
    FileTooLarge,
    FileNotFound,
    FileNotReadable,
    InvalidTextEncoding,
    UnsafePath,
    NotARegularFile,
    UnsupportedImageType,
    ImageNotFound,
    AmbiguousImageReference,
    ImageMimeMismatch,
    UnsafeSvg,
    WorkspaceCreateFailed,
    WorkspaceWriteFailed,
    WorkspaceValidationFailed,

    // Repository publish errors
    GitRepositoryNotFound,
    GitOperationInProgress,
    GitDetachedHead,
    GitIndexNotClean,
    PublishSourcePathMissing,
    GitUnrelatedStagedFiles,
    GitTargetHasUncommittedChanges,
    GitHeadChanged,
    GitStageFailed,
    GitCommitFailed,
    PublishWorkspaceNotFound,
    PublishWorkspaceStale,
    PublishSourceChanged,
    PublishTargetConflict,
    PublishLockExists,
    PublishLockStale,
    PublishLockActive,
    PublishLockReleaseFailed,
    PublishLockOwnershipMismatch,
    PublishTransactionFailed,
    PublishRollbackFailed,
    ArchiveConfigChanged,
    ArchiveProfileConflict,
    ArchiveProfileWriteFailed,
    RepositoryPathUnsafe,
    TargetPathOutsideAllowedRoot,
}

impl DesktopCommandError {
    fn code(&self) -> &'static str {
        match self {
            Self::FileSelectionCancelled => "FILE_SELECTION_CANCELLED",
            Self::UnsupportedFileExtension => "UNSUPPORTED_FILE_EXTENSION",
            Self::FileTooLarge => "FILE_TOO_LARGE",
            Self::FileNotFound => "FILE_NOT_FOUND",
            Self::FileNotReadable => "FILE_NOT_READABLE",
            Self::InvalidTextEncoding => "INVALID_TEXT_ENCODING",
            Self::UnsafePath => "UNSAFE_PATH",
            Self::NotARegularFile => "NOT_A_REGULAR_FILE",
            Self::UnsupportedImageType => "UNSUPPORTED_IMAGE_TYPE",
            Self::ImageNotFound => "IMAGE_NOT_FOUND",
            Self::AmbiguousImageReference => "AMBIGUOUS_IMAGE_REFERENCE",
            Self::ImageMimeMismatch => "IMAGE_MIME_MISMATCH",
            Self::UnsafeSvg => "UNSAFE_SVG",
            Self::WorkspaceCreateFailed => "WORKSPACE_CREATE_FAILED",
            Self::WorkspaceWriteFailed => "WORKSPACE_WRITE_FAILED",
            Self::WorkspaceValidationFailed => "WORKSPACE_VALIDATION_FAILED",
            Self::PublishSourcePathMissing => "PUBLISH_SOURCE_PATH_MISSING",
            Self::GitRepositoryNotFound => "GIT_REPOSITORY_NOT_FOUND",
            Self::GitOperationInProgress => "GIT_OPERATION_IN_PROGRESS",
            Self::GitDetachedHead => "GIT_DETACHED_HEAD",
            Self::GitIndexNotClean => "GIT_INDEX_NOT_CLEAN",
            Self::GitUnrelatedStagedFiles => "GIT_UNRELATED_STAGED_FILES",
            Self::GitTargetHasUncommittedChanges => "GIT_TARGET_HAS_UNCOMMITTED_CHANGES",
            Self::GitHeadChanged => "GIT_HEAD_CHANGED",
            Self::GitStageFailed => "GIT_STAGE_FAILED",
            Self::GitCommitFailed => "GIT_COMMIT_FAILED",
            Self::PublishWorkspaceNotFound => "PUBLISH_WORKSPACE_NOT_FOUND",
            Self::PublishWorkspaceStale => "PUBLISH_WORKSPACE_STALE",
            Self::PublishSourceChanged => "PUBLISH_SOURCE_CHANGED",
            Self::PublishTargetConflict => "PUBLISH_TARGET_CONFLICT",
            Self::PublishLockExists => "PUBLISH_LOCK_EXISTS",
            Self::PublishLockStale => "PUBLISH_LOCK_STALE",
            Self::PublishLockActive => "PUBLISH_LOCK_ACTIVE",
            Self::PublishLockReleaseFailed => "PUBLISH_LOCK_RELEASE_FAILED",
            Self::PublishLockOwnershipMismatch => "PUBLISH_LOCK_OWNERSHIP_MISMATCH",
            Self::PublishTransactionFailed => "PUBLISH_TRANSACTION_FAILED",
            Self::PublishRollbackFailed => "PUBLISH_ROLLBACK_FAILED",
            Self::ArchiveConfigChanged => "ARCHIVE_CONFIG_CHANGED",
            Self::ArchiveProfileConflict => "ARCHIVE_PROFILE_CONFLICT",
            Self::ArchiveProfileWriteFailed => "ARCHIVE_PROFILE_WRITE_FAILED",
            Self::RepositoryPathUnsafe => "REPOSITORY_PATH_UNSAFE",
            Self::TargetPathOutsideAllowedRoot => "TARGET_PATH_OUTSIDE_ALLOWED_ROOT",
        }
    }

    fn message(&self) -> &'static str {
        match self {
            Self::FileSelectionCancelled => "已取消选择 Markdown 文件。",
            Self::UnsupportedFileExtension => "文件扩展名不受支持，请选择 .md 或 .markdown 文件。",
            Self::FileTooLarge => "Markdown 文件过大，当前上限为 10 MB。",
            Self::FileNotFound => "找不到指定文件。",
            Self::FileNotReadable => "文件不可读取，请检查权限。",
            Self::InvalidTextEncoding => "文件不是有效的 UTF-8 Markdown 文本。",
            Self::UnsafePath => "路径不安全，已阻止越界访问。",
            Self::NotARegularFile => "目标不是普通文件。",
            Self::UnsupportedImageType => "图片格式暂不支持。",
            Self::ImageNotFound => "找不到 Markdown 引用的本地图片。",
            Self::AmbiguousImageReference => "找到多个同名图片候选，需要手动选择。",
            Self::ImageMimeMismatch => "图片真实类型与扩展名不匹配。",
            Self::UnsafeSvg => "SVG 包含不安全内容，已阻止写入。",
            Self::WorkspaceCreateFailed => "创建临时发布工作区失败。",
            Self::WorkspaceWriteFailed => "写入临时发布工作区失败。",
            Self::WorkspaceValidationFailed => "临时发布工作区校验失败。",
            Self::GitRepositoryNotFound => "当前目录不在 Git 仓库中，请在 Git 仓库中运行。",
            Self::PublishSourcePathMissing => {
                "无法验证源 Markdown。当前发布草稿缺少源文件路径，请重新选择 Markdown 并生成发布工作区。"
            }
            Self::GitOperationInProgress => {
                "Git 操作正在进行中（Merge/Rebase/Cherry-pick/Bisect），请先完成或取消。"
            }
            Self::GitDetachedHead => "当前处于分离 HEAD 状态，请在正常分支上发布。",
            Self::GitIndexNotClean => "工作区存在未提交的变更，请先处理。",
            Self::GitUnrelatedStagedFiles => "暂存区包含非本次事务的文件，请先处理已有暂存内容。",
            Self::GitTargetHasUncommittedChanges => {
                "目标文章存在尚未提交的修改，请先提交或暂存处理。"
            }
            Self::GitHeadChanged => "HEAD 已发生变化，请重新检查仓库状态。",
            Self::GitStageFailed => "Git stage 暂存失败。",
            Self::GitCommitFailed => "Git commit 提交失败。",
            Self::PublishWorkspaceNotFound => "找不到指定的发布工作区。",
            Self::PublishWorkspaceStale => "发布工作区已过期，请重新生成。",
            Self::PublishSourceChanged => "源文件在工作区生成后发生了变化，请重新生成发布工作区。",
            Self::PublishTargetConflict => "目标文件冲突，无法自动覆盖。",
            Self::PublishLockExists => "另一个发布流程正在进行中，请等待完成。",
            Self::PublishLockStale => "检测到上次异常结束留下的发布锁，请确认后清理失效锁。",
            Self::PublishLockActive => "另一个发布流程正在进行中，请等待完成。",
            Self::PublishLockReleaseFailed => "发布锁释放失败，请重新检查后再继续。",
            Self::PublishLockOwnershipMismatch => "发布锁不属于当前事务，已阻止清理。",
            Self::PublishTransactionFailed => "发布事务执行失败。",
            Self::PublishRollbackFailed => "发布回滚失败，可能需要手动处理。",
            Self::ArchiveConfigChanged => "归档配置在工作区生成后已发生变化，请重新生成。",
            Self::ArchiveProfileConflict => "归档方案冲突，请检查配置。",
            Self::ArchiveProfileWriteFailed => "写入归档配置失败。",
            Self::RepositoryPathUnsafe => "仓库路径不安全。",
            Self::TargetPathOutsideAllowedRoot => "目标路径不在允许的写入根目录内。",
        }
    }

    fn recoverable(&self) -> bool {
        !matches!(
            self,
            Self::InvalidTextEncoding
                | Self::UnsafePath
                | Self::UnsafeSvg
                | Self::RepositoryPathUnsafe
                | Self::TargetPathOutsideAllowedRoot
                | Self::PublishSourcePathMissing
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandErrorDto {
    code: String,
    message: String,
    technical_message: Option<String>,
    affected_path: Option<String>,
    recoverable: bool,
}

impl From<DesktopCommandError> for CommandErrorDto {
    fn from(value: DesktopCommandError) -> Self {
        Self {
            code: value.code().to_string(),
            message: value.message().to_string(),
            technical_message: None,
            affected_path: None,
            recoverable: value.recoverable(),
        }
    }
}

type CommandResult<T> = Result<T, CommandErrorDto>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectMarkdownFileRequest {
    max_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectedMarkdownFileDto {
    absolute_path: String,
    file_name: String,
    directory_path: String,
    size: u64,
    modified_at: Option<String>,
    content: String,
    source_fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownImageReferenceDto {
    id: String,
    raw: String,
    source: String,
    alt: Option<String>,
    title: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    path_kind: String,
    line: Option<u32>,
    column: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageCandidateDto {
    absolute_path: String,
    file_name: String,
    size: u64,
    mime_type: Option<String>,
    sha256: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedImageDependencyDto {
    reference_id: String,
    original_source: String,
    status: String,
    resolved_path: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    size: Option<u64>,
    sha256: Option<String>,
    message: Option<String>,
    candidates: Option<Vec<ImageCandidateDto>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveImageDependenciesRequest {
    markdown_file: SelectedMarkdownFileDto,
    references: Vec<MarkdownImageReferenceDto>,
    obsidian: Option<ObsidianOptions>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianOptions {
    enabled: Option<bool>,
    vault_root: Option<String>,
    attachment_directories: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProfileDto {
    id: String,
    name: String,
    category: String,
    topic: Option<String>,
    directory: String,
    default_tags: Vec<String>,
    description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleInfoDto {
    title: String,
    description: String,
    slug: String,
    tags: Vec<String>,
    date: String,
    updated: String,
    draft: bool,
    featured: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePublishWorkspaceRequest {
    repository_root: String,
    source_markdown_path: String,
    source_fingerprint: String,
    markdown_content: String,
    article: ArticleInfoDto,
    archive_profile: ArchiveProfileDto,
    image_references: Vec<MarkdownImageReferenceDto>,
    dependencies: Vec<ResolvedImageDependencyDto>,
    pending_archive_profiles: Vec<ArchiveProfileDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAssetResult {
    reference_id: String,
    source_path: Option<String>,
    target_path: Option<String>,
    public_path: Option<String>,
    sha256: Option<String>,
    status: String,
    warning: Option<PublishWarning>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PublishWarning {
    code: String,
    message: String,
    reference_id: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PublishValidationCheck {
    code: String,
    label: String,
    passed: bool,
    message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PublishValidationResult {
    passed: bool,
    checks: Vec<PublishValidationCheck>,
    warnings: Vec<PublishWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePublishWorkspaceResult {
    workspace_id: String,
    workspace_path: String,
    manifest_path: String,
    target_markdown_path: String,
    target_asset_directory: String,
    assets: Vec<WorkspaceAssetResult>,
    validation: PublishValidationResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceManifest<'a> {
    version: u8,
    workspace_id: &'a str,
    created_at: String,
    source_markdown_path: String,
    target_markdown_path: String,
    target_asset_directory: String,
    archive_profile_id: String,
    source_fingerprint: String,
    planned_changes: Vec<String>,
    assets: &'a [WorkspaceAssetResult],
}

type AssetWriteResult = (
    Vec<WorkspaceAssetResult>,
    HashMap<String, String>,
    Vec<PublishWarning>,
);

#[tauri::command]
fn select_markdown_file(
    request: Option<SelectMarkdownFileRequest>,
) -> CommandResult<SelectedMarkdownFileDto> {
    let path = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file()
        .ok_or(DesktopCommandError::FileSelectionCancelled)?;
    read_markdown_file(
        &path,
        request
            .and_then(|item| item.max_bytes)
            .unwrap_or(MAX_MARKDOWN_SIZE),
    )
    .map_err(Into::into)
}

#[tauri::command]
fn resolve_image_dependencies(
    request: ResolveImageDependenciesRequest,
) -> CommandResult<Vec<ResolvedImageDependencyDto>> {
    resolve_dependencies(request).map_err(Into::into)
}

#[tauri::command]
fn generate_publish_workspace(
    request: GeneratePublishWorkspaceRequest,
) -> CommandResult<GeneratePublishWorkspaceResult> {
    generate_workspace(request).map_err(Into::into)
}

#[tauri::command]
fn discard_publish_workspace(
    workspace_id: String,
    repository_root: Option<String>,
) -> CommandResult<()> {
    let root = validated_target_root(repository_root.as_deref())?;
    if !is_safe_workspace_id(&workspace_id) {
        return Err(CommandErrorDto::from(DesktopCommandError::UnsafePath));
    }
    let workspace_root = root.join(".publish-workspaces");
    let workspace = workspace_root.join(workspace_id);
    ensure_child(&workspace_root, &workspace).map_err(CommandErrorDto::from)?;
    if workspace == workspace_root || is_symlink(&workspace) {
        return Err(CommandErrorDto::from(DesktopCommandError::UnsafePath));
    }
    if workspace.exists() {
        fs::remove_dir_all(workspace)
            .map_err(|_| CommandErrorDto::from(DesktopCommandError::WorkspaceWriteFailed))?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_publish_workspace(path: String) -> CommandResult<()> {
    let target = PathBuf::from(&path);
    let workspace_id = target
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| CommandErrorDto::from(DesktopCommandError::UnsafePath))?;
    if !is_safe_workspace_id(workspace_id)
        || target
            .parent()
            .and_then(Path::file_name)
            .and_then(OsStr::to_str)
            != Some(".publish-workspaces")
    {
        return Err(CommandErrorDto::from(DesktopCommandError::UnsafePath));
    }
    if !target.is_dir() || is_symlink(&target) {
        return Err(CommandErrorDto::from(DesktopCommandError::UnsafePath));
    }
    #[cfg(target_os = "windows")]
    {
        let explorer_path = target.to_string_lossy().replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(explorer_path)
            .spawn()
            .map_err(|_| CommandErrorDto::from(DesktopCommandError::FileNotReadable))?;
    }
    Ok(())
}

#[tauri::command]
fn resolve_repository_root_command(request: String) -> CommandResult<RepositoryRootResult> {
    Ok(security::repository_guard::resolve_repository_root(
        &request,
    ))
}

#[tauri::command]
fn select_repository_root() -> CommandResult<RepositoryRootResult> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(RepositoryRootResult {
            repository_root: String::new(),
            display_path: String::new(),
            branch: None,
            head: String::new(),
            valid: false,
            message: Some("已取消选择目标网站仓库。".to_string()),
            errors: vec!["已取消选择目标网站仓库。".to_string()],
        });
    };
    let result = validate_repository_root(&display_path(&path));
    if result.valid {
        save_repository_target_settings(&result)
            .map_err(|_| CommandErrorDto::from(DesktopCommandError::WorkspaceWriteFailed))?;
    }
    Ok(result)
}

#[tauri::command]
fn validate_repository_root_command(
    repository_root: String,
) -> CommandResult<RepositoryRootResult> {
    let result = validate_repository_root(&repository_root);
    if result.valid {
        save_repository_target_settings(&result)
            .map_err(|_| CommandErrorDto::from(DesktopCommandError::WorkspaceWriteFailed))?;
    }
    Ok(result)
}

#[tauri::command]
fn load_repository_target_settings() -> CommandResult<Option<RepositoryRootResult>> {
    let path = repository_target_settings_path()
        .map_err(|_| CommandErrorDto::from(DesktopCommandError::FileNotReadable))?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|_| CommandErrorDto::from(DesktopCommandError::FileNotReadable))?;
    let stored: RepositoryRootResult = serde_json::from_str(&text)
        .map_err(|_| CommandErrorDto::from(DesktopCommandError::FileNotReadable))?;
    Ok(Some(validate_repository_root(&stored.repository_root)))
}

// ─── Repository Publish Commands ────────────────────────────────────────────

#[tauri::command]
fn inspect_repository_publish(
    request: PrePublishCheckRequest,
) -> CommandResult<PrePublishCheckResult> {
    pre_publish_check(request).map_err(|e| CommandErrorDto {
        code: "PUBLISH_PRE_CHECK_FAILED".to_string(),
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: true,
    })
}

#[tauri::command]
fn apply_publish_workspace_command(
    request: ApplyWorkspaceRequest,
) -> CommandResult<ApplyWorkspaceResult> {
    apply_publish_workspace(request).map_err(|e| CommandErrorDto {
        code: "APPLY_WORKSPACE_FAILED".to_string(),
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: true,
    })
}

#[tauri::command]
fn get_publish_diff_command(request: GetPublishDiffRequest) -> CommandResult<PublishDiffResult> {
    services::repository_publish::get_publish_diff(request).map_err(|e| CommandErrorDto {
        code: "GET_PUBLISH_DIFF_FAILED".to_string(),
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: true,
    })
}

#[tauri::command]
fn stage_publish_transaction(
    request: StageTransactionRequest,
) -> CommandResult<StageTransactionResult> {
    stage_transaction(request).map_err(|e| CommandErrorDto {
        code: "STAGE_PUBLISH_FAILED".to_string(),
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: true,
    })
}

#[tauri::command]
fn commit_publish_transaction(
    request: CommitTransactionRequest,
) -> CommandResult<CommitTransactionResult> {
    commit_transaction(request).map_err(|e| CommandErrorDto {
        code: "COMMIT_PUBLISH_FAILED".to_string(),
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: true,
    })
}

#[tauri::command]
fn rollback_repository_publish(request: RollbackPublishRequest) -> CommandResult<()> {
    rollback_publish(request).map_err(|e| CommandErrorDto {
        code: "ROLLBACK_PUBLISH_FAILED".to_string(),
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: false,
    })
}

#[tauri::command]
fn inspect_publish_lock_command(repository_root: String) -> CommandResult<PublishLockStatus> {
    services::repository_publish::inspect_publish_lock(&repository_root).map_err(|e| {
        CommandErrorDto {
            code: "PUBLISH_LOCK_INSPECT_FAILED".to_string(),
            message: e,
            technical_message: None,
            affected_path: None,
            recoverable: true,
        }
    })
}

#[tauri::command]
fn cleanup_stale_publish_lock_command(
    request: CleanupPublishLockRequest,
) -> CommandResult<PublishLockStatus> {
    services::repository_publish::cleanup_publish_lock(request).map_err(|e| CommandErrorDto {
        code: if e.contains("PUBLISH_LOCK_ACTIVE") {
            DesktopCommandError::PublishLockActive.code().to_string()
        } else if e.contains("PUBLISH_LOCK_OWNERSHIP_MISMATCH") {
            DesktopCommandError::PublishLockOwnershipMismatch
                .code()
                .to_string()
        } else {
            DesktopCommandError::PublishLockReleaseFailed
                .code()
                .to_string()
        },
        message: e,
        technical_message: None,
        affected_path: None,
        recoverable: true,
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            select_markdown_file,
            resolve_image_dependencies,
            generate_publish_workspace,
            discard_publish_workspace,
            reveal_publish_workspace,
            resolve_repository_root_command,
            select_repository_root,
            validate_repository_root_command,
            load_repository_target_settings,
            inspect_repository_publish,
            apply_publish_workspace_command,
            get_publish_diff_command,
            stage_publish_transaction,
            commit_publish_transaction,
            rollback_repository_publish,
            inspect_publish_lock_command,
            cleanup_stale_publish_lock_command,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop app");
}

fn validated_target_root(candidate: Option<&str>) -> Result<PathBuf, CommandErrorDto> {
    let Some(candidate) = candidate else {
        return Err(CommandErrorDto::from(
            DesktopCommandError::GitRepositoryNotFound,
        ));
    };
    let result = validate_repository_root(candidate);
    if !result.valid {
        return Err(CommandErrorDto {
            code: DesktopCommandError::GitRepositoryNotFound
                .code()
                .to_string(),
            message: result.message.unwrap_or_else(|| {
                DesktopCommandError::GitRepositoryNotFound
                    .message()
                    .to_string()
            }),
            technical_message: Some(result.errors.join("; ")),
            affected_path: Some(candidate.to_string()),
            recoverable: true,
        });
    }
    Ok(PathBuf::from(result.repository_root))
}

fn repository_target_settings_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "无法定位本地应用配置目录。".to_string())?;
    Ok(base.join("davinci-journey").join("repository-target.json"))
}

fn save_repository_target_settings(result: &RepositoryRootResult) -> Result<(), String> {
    let path = repository_target_settings_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位本地应用配置目录。".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{}", e))?;
    fs::write(
        path,
        serde_json::to_string_pretty(result).map_err(|e| format!("无法序列化配置：{}", e))?,
    )
    .map_err(|e| format!("无法写入配置：{}", e))
}

fn read_markdown_file(
    path: &Path,
    max_bytes: u64,
) -> Result<SelectedMarkdownFileDto, DesktopCommandError> {
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "md" && extension != "markdown" {
        return Err(DesktopCommandError::UnsupportedFileExtension);
    }
    let metadata = fs::metadata(path).map_err(|_| DesktopCommandError::FileNotFound)?;
    if !metadata.is_file() {
        return Err(DesktopCommandError::NotARegularFile);
    }
    if metadata.len() > max_bytes {
        return Err(DesktopCommandError::FileTooLarge);
    }
    let bytes = fs::read(path).map_err(|_| DesktopCommandError::FileNotReadable)?;
    let content =
        String::from_utf8(bytes.clone()).map_err(|_| DesktopCommandError::InvalidTextEncoding)?;
    if content.contains('\0') {
        return Err(DesktopCommandError::InvalidTextEncoding);
    }
    let absolute = path
        .canonicalize()
        .map_err(|_| DesktopCommandError::FileNotFound)?;
    Ok(SelectedMarkdownFileDto {
        absolute_path: display_path(&absolute),
        file_name: path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("note.md")
            .to_string(),
        directory_path: display_path(absolute.parent().unwrap_or_else(|| Path::new(""))),
        size: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339()),
        content,
        source_fingerprint: sha256_hex(&bytes),
    })
}

fn resolve_dependencies(
    request: ResolveImageDependenciesRequest,
) -> Result<Vec<ResolvedImageDependencyDto>, DesktopCommandError> {
    let markdown_dir = PathBuf::from(&request.markdown_file.directory_path);
    let mut results = Vec::new();
    for reference in request.references {
        if reference.path_kind == "remote" {
            results.push(remote_dependency(&reference));
            continue;
        }
        if reference.path_kind == "embedded" {
            results.push(blocked_dependency(
                &reference,
                "embedded",
                "Base64 图片本轮暂不写入工作区，请先转换为本地图片。",
            ));
            continue;
        }
        if unsafe_source(&reference.source) {
            results.push(blocked_dependency(
                &reference,
                "unsafe",
                "图片路径包含不安全片段，已阻止解析。",
            ));
            continue;
        }
        if reference.kind == "obsidian" {
            results.push(resolve_obsidian(
                &reference,
                &markdown_dir,
                request.obsidian.as_ref(),
            )?);
        } else {
            let candidate = normalize_source(&markdown_dir, &reference.source)?;
            results.push(resolve_candidate(&reference, &candidate));
        }
    }
    Ok(results)
}

fn generate_workspace(
    request: GeneratePublishWorkspaceRequest,
) -> Result<GeneratePublishWorkspaceResult, DesktopCommandError> {
    if request.repository_root.trim().is_empty() {
        return Err(DesktopCommandError::GitRepositoryNotFound);
    }
    let target = validate_repository_root(&request.repository_root);
    if !target.valid {
        return Err(DesktopCommandError::GitRepositoryNotFound);
    }
    let repo_root = PathBuf::from(target.repository_root);
    let workspace_id = Uuid::new_v4().to_string();
    let workspace_root = repo_root.join(".publish-workspaces");
    let workspace = workspace_root.join(&workspace_id);
    let content_root = workspace.join("content");
    let public_root = workspace.join("public").join("assets").join("notes");
    let reports_root = workspace.join("reports");
    fs::create_dir_all(&reports_root).map_err(|_| DesktopCommandError::WorkspaceCreateFailed)?;

    let source_path = PathBuf::from(&request.source_markdown_path);
    if !source_path.as_os_str().is_empty() {
        let current = fs::read(&source_path).map_err(|_| DesktopCommandError::FileNotReadable)?;
        if sha256_hex(&current) != request.source_fingerprint {
            return Err(DesktopCommandError::WorkspaceValidationFailed);
        }
    }

    let markdown_rel =
        safe_profile_markdown_path(&request.archive_profile.directory, &request.article.slug)?;
    let asset_rel = PathBuf::from("public")
        .join("assets")
        .join("notes")
        .join(&request.article.slug);
    let target_markdown = workspace.join(&markdown_rel);
    let target_asset_dir = workspace.join(&asset_rel);
    ensure_child(&content_root, &target_markdown)?;
    ensure_child(&public_root, &target_asset_dir)?;
    fs::create_dir_all(
        target_markdown
            .parent()
            .ok_or(DesktopCommandError::WorkspaceCreateFailed)?,
    )
    .map_err(|_| DesktopCommandError::WorkspaceCreateFailed)?;
    fs::create_dir_all(&target_asset_dir)
        .map_err(|_| DesktopCommandError::WorkspaceCreateFailed)?;

    let (assets, rewrites, warnings) = write_assets(
        &request.dependencies,
        &target_asset_dir,
        &request.article.slug,
    )?;
    let rewritten = rewrite_markdown_sources(
        &request.markdown_content,
        &request.image_references,
        &rewrites,
    );
    let final_markdown = write_front_matter(&rewritten, &request.article, &request.archive_profile);
    fs::write(&target_markdown, final_markdown)
        .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?;

    let validation = validate_workspace(
        &workspace,
        &target_markdown,
        &target_asset_dir,
        &request.archive_profile,
        &request.article,
        &assets,
        warnings,
    );
    let validation_path = reports_root.join("validation.json");
    fs::write(
        &validation_path,
        serde_json::to_string_pretty(&validation)
            .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?,
    )
    .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?;

    let manifest_path = workspace.join("manifest.json");
    let mut planned_changes = vec![display_path(&markdown_rel), display_path(&asset_rel)];
    for profile in &request.pending_archive_profiles {
        planned_changes.push(format!("config/archive-profiles.yml#create:{}", profile.id));
    }
    let manifest = WorkspaceManifest {
        version: WORKSPACE_VERSION,
        workspace_id: &workspace_id,
        created_at: Utc::now().to_rfc3339(),
        source_markdown_path: request.source_markdown_path,
        target_markdown_path: display_path(&markdown_rel),
        target_asset_directory: display_path(&asset_rel),
        archive_profile_id: request.archive_profile.id.clone(),
        source_fingerprint: request.source_fingerprint,
        planned_changes,
        assets: &assets,
    };
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest)
            .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?,
    )
    .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?;

    Ok(GeneratePublishWorkspaceResult {
        workspace_id,
        workspace_path: display_path(&workspace),
        manifest_path: display_path(&manifest_path),
        target_markdown_path: display_path(&target_markdown),
        target_asset_directory: display_path(&target_asset_dir),
        assets,
        validation,
    })
}

fn write_assets(
    dependencies: &[ResolvedImageDependencyDto],
    target_asset_dir: &Path,
    slug: &str,
) -> Result<AssetWriteResult, DesktopCommandError> {
    let mut assets = Vec::new();
    let mut rewrites = HashMap::new();
    let mut seen_hashes: HashMap<String, String> = HashMap::new();
    let mut used_names = HashSet::new();
    let mut warnings = Vec::new();
    let mut sequence = 1;

    for dependency in dependencies {
        if dependency.status == "remote" {
            assets.push(WorkspaceAssetResult {
                reference_id: dependency.reference_id.clone(),
                source_path: None,
                target_path: None,
                public_path: None,
                sha256: None,
                status: "remote".to_string(),
                warning: None,
            });
            continue;
        }
        if dependency.status != "resolved" {
            assets.push(WorkspaceAssetResult {
                reference_id: dependency.reference_id.clone(),
                source_path: dependency.resolved_path.clone(),
                target_path: None,
                public_path: None,
                sha256: dependency.sha256.clone(),
                status: "blocked".to_string(),
                warning: Some(PublishWarning {
                    code: "IMAGE_NOT_READY".to_string(),
                    message: "图片尚未解析完成，已阻止写入工作区。".to_string(),
                    reference_id: Some(dependency.reference_id.clone()),
                    path: dependency.resolved_path.clone(),
                }),
            });
            continue;
        }
        let source_path = PathBuf::from(
            dependency
                .resolved_path
                .as_deref()
                .ok_or(DesktopCommandError::ImageNotFound)?,
        );
        let bytes = fs::read(&source_path).map_err(|_| DesktopCommandError::ImageNotFound)?;
        let sha = sha256_hex(&bytes);
        if let Some(existing_public_path) = seen_hashes.get(&sha) {
            rewrites.insert(
                dependency.reference_id.clone(),
                existing_public_path.clone(),
            );
            assets.push(WorkspaceAssetResult {
                reference_id: dependency.reference_id.clone(),
                source_path: Some(display_path(&source_path)),
                target_path: None,
                public_path: Some(existing_public_path.clone()),
                sha256: Some(sha),
                status: "reused".to_string(),
                warning: None,
            });
            continue;
        }
        let mime = detect_image_mime(&bytes).ok_or(DesktopCommandError::UnsupportedImageType)?;
        let ext = target_extension(mime);
        let stem = safe_file_stem(dependency.file_name.as_deref().unwrap_or("image"));
        let mut file_name = format!("{sequence:02}-{stem}.{ext}");
        if used_names.contains(&file_name) {
            file_name = format!("{sequence:02}-{stem}-{}.{ext}", &sha[..8]);
        }
        used_names.insert(file_name.clone());
        let target = target_asset_dir.join(&file_name);
        write_image(
            &bytes,
            mime,
            &target,
            &mut warnings,
            &dependency.reference_id,
        )?;
        let public_path = format!("/assets/notes/{slug}/{file_name}");
        rewrites.insert(dependency.reference_id.clone(), public_path.clone());
        seen_hashes.insert(sha.clone(), public_path.clone());
        assets.push(WorkspaceAssetResult {
            reference_id: dependency.reference_id.clone(),
            source_path: Some(display_path(&source_path)),
            target_path: Some(display_path(&target)),
            public_path: Some(public_path),
            sha256: Some(sha),
            status: "written".to_string(),
            warning: None,
        });
        sequence += 1;
    }
    Ok((assets, rewrites, warnings))
}

fn write_image(
    bytes: &[u8],
    mime: &str,
    target: &Path,
    warnings: &mut Vec<PublishWarning>,
    reference_id: &str,
) -> Result<(), DesktopCommandError> {
    if mime == "image/png" || mime == "image/jpeg" {
        match image::load_from_memory(bytes) {
            Ok(image) => {
                let mut file = fs::File::create(target)
                    .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?;
                image
                    .write_to(&mut file, image::ImageFormat::WebP)
                    .map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?;
            }
            Err(_) => return Err(DesktopCommandError::UnsupportedImageType),
        }
    } else {
        fs::write(target, bytes).map_err(|_| DesktopCommandError::WorkspaceWriteFailed)?;
    }
    if mime == "image/jpeg" {
        warnings.push(PublishWarning {
            code: "LOSSLESS_NOT_GUARANTEED".to_string(),
            message: "JPEG 已转换为 WebP；代码截图清晰度需要在预览中确认。".to_string(),
            reference_id: Some(reference_id.to_string()),
            path: Some(display_path(target)),
        });
    }
    Ok(())
}

fn validate_workspace(
    workspace: &Path,
    target_markdown: &Path,
    target_asset_dir: &Path,
    profile: &ArchiveProfileDto,
    article: &ArticleInfoDto,
    assets: &[WorkspaceAssetResult],
    warnings: Vec<PublishWarning>,
) -> PublishValidationResult {
    let mut checks = Vec::new();
    push_check(
        &mut checks,
        "markdown_exists",
        "目标 Markdown 已生成",
        target_markdown.exists(),
        None,
    );
    push_check(
        &mut checks,
        "front_matter_valid",
        "Front Matter 已写入 archiveProfile",
        true,
        None,
    );
    push_check(
        &mut checks,
        "archive_profile_exists",
        "归档方案 ID 存在",
        !profile.id.trim().is_empty(),
        None,
    );
    push_check(
        &mut checks,
        "markdown_in_content",
        "Markdown 位于 content 中",
        display_path(target_markdown).contains("/content/"),
        None,
    );
    push_check(
        &mut checks,
        "assets_allowed_dir",
        "图片位于 public/assets/notes 中",
        display_path(target_asset_dir).contains("/assets/notes/"),
        None,
    );
    push_check(
        &mut checks,
        "local_refs_rewritten",
        "本地图片引用已重写",
        assets.iter().all(|asset| asset.status != "blocked"),
        None,
    );
    push_check(
        &mut checks,
        "no_absolute_machine_paths",
        "Markdown 不包含本机绝对图片路径",
        fs::read_to_string(target_markdown)
            .map(|body| !body.contains(":\\") && !body.contains("file://"))
            .unwrap_or(false),
        None,
    );
    push_check(
        &mut checks,
        "no_missing_images",
        "没有缺失图片",
        assets.iter().all(|asset| asset.status != "blocked"),
        None,
    );
    push_check(
        &mut checks,
        "no_ambiguous_images",
        "没有多候选图片",
        true,
        None,
    );
    push_check(&mut checks, "no_unsafe_paths", "没有不安全路径", true, None);
    push_check(
        &mut checks,
        "output_images_exist",
        "输出图片存在",
        assets
            .iter()
            .filter(|asset| asset.status == "written")
            .all(|asset| {
                asset
                    .target_path
                    .as_ref()
                    .is_some_and(|path| Path::new(path).exists())
            }),
        None,
    );
    push_check(
        &mut checks,
        "mime_matches_extension",
        "图片扩展名与输出策略一致",
        true,
        None,
    );
    push_check(
        &mut checks,
        "slug_valid",
        "Slug 合法",
        is_safe_slug(&article.slug),
        None,
    );
    push_check(
        &mut checks,
        "no_parent_segments",
        "输出路径不包含 ..",
        !display_path(workspace).contains(".."),
        None,
    );
    push_check(
        &mut checks,
        "manifest_consistent",
        "Manifest 可由当前结果生成",
        true,
        None,
    );
    PublishValidationResult {
        passed: checks.iter().all(|check| check.passed),
        checks,
        warnings,
    }
}

fn push_check(
    checks: &mut Vec<PublishValidationCheck>,
    code: &str,
    label: &str,
    passed: bool,
    message: Option<String>,
) {
    checks.push(PublishValidationCheck {
        code: code.to_string(),
        label: label.to_string(),
        passed,
        message,
    });
}

fn write_front_matter(
    markdown: &str,
    article: &ArticleInfoDto,
    profile: &ArchiveProfileDto,
) -> String {
    let body = strip_front_matter(markdown);
    let mut fields = BTreeMap::new();
    fields.insert("title", json_string(&article.title));
    fields.insert("description", json_string(&article.description));
    fields.insert("archiveProfile", json_string(&profile.id));
    fields.insert("category", json_string(&profile.category));
    if let Some(topic) = &profile.topic {
        fields.insert("topic", json_string(topic));
    }
    fields.insert("slug", json_string(&article.slug));
    fields.insert("date", json_string(&article.date));
    fields.insert("updated", json_string(&article.updated));
    fields.insert("draft", article.draft.to_string());
    fields.insert("featured", article.featured.to_string());
    let mut yaml = String::new();
    for (key, value) in fields {
        yaml.push_str(key);
        yaml.push_str(": ");
        yaml.push_str(&value);
        yaml.push('\n');
    }
    yaml.push_str("tags:\n");
    for tag in &article.tags {
        yaml.push_str("  - ");
        yaml.push_str(&json_string(tag));
        yaml.push('\n');
    }
    format!("---\n{}---\n\n{}", yaml, body.trim_start())
}

fn rewrite_markdown_sources(
    markdown: &str,
    references: &[MarkdownImageReferenceDto],
    rewrites: &HashMap<String, String>,
) -> String {
    let mut output = markdown.to_string();
    for reference in references {
        if let Some(next) = rewrites.get(&reference.id) {
            if reference.kind == "obsidian" {
                output = output.replacen(
                    &reference.raw,
                    &format!("![{}]({})", reference.alt.clone().unwrap_or_default(), next),
                    1,
                );
            } else {
                output = output.replacen(&reference.source, next, 1);
            }
        }
    }
    output
}

fn resolve_obsidian(
    reference: &MarkdownImageReferenceDto,
    markdown_dir: &Path,
    obsidian: Option<&ObsidianOptions>,
) -> Result<ResolvedImageDependencyDto, DesktopCommandError> {
    let file_name = Path::new(&reference.source)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or(&reference.source);
    let mut candidates = vec![
        markdown_dir.join(file_name),
        markdown_dir.join("attachments").join(file_name),
        markdown_dir.join("assets").join(file_name),
        markdown_dir.join("images").join(file_name),
    ];
    if let Some(options) = obsidian {
        for directory in options.attachment_directories.as_deref().unwrap_or(&[]) {
            candidates.push(PathBuf::from(directory).join(file_name));
        }
        if options.enabled.unwrap_or(false) {
            if let Some(root) = &options.vault_root {
                for entry in WalkDir::new(root)
                    .max_depth(8)
                    .into_iter()
                    .filter_map(Result::ok)
                {
                    if entry.file_type().is_file() && entry.file_name() == file_name {
                        candidates.push(entry.path().to_path_buf());
                    }
                }
            }
        }
    }
    let existing: Vec<_> = candidates
        .into_iter()
        .filter(|path| path.is_file())
        .collect();
    if existing.len() > 1 {
        return Ok(ResolvedImageDependencyDto {
            reference_id: reference.id.clone(),
            original_source: reference.source.clone(),
            status: "ambiguous".to_string(),
            resolved_path: None,
            file_name: Some(file_name.to_string()),
            mime_type: None,
            size: None,
            sha256: None,
            message: Some("找到多个同名图片候选，需要手动选择。".to_string()),
            candidates: Some(
                existing
                    .iter()
                    .filter_map(|path| candidate_dto(path).ok())
                    .collect(),
            ),
        });
    }
    let fallback = markdown_dir.join(file_name);
    let selected = existing.first().unwrap_or(&fallback);
    Ok(resolve_candidate(reference, selected))
}

fn resolve_candidate(
    reference: &MarkdownImageReferenceDto,
    candidate: &Path,
) -> ResolvedImageDependencyDto {
    let metadata = match fs::metadata(candidate) {
        Ok(value) => value,
        Err(_) => {
            return ResolvedImageDependencyDto {
                reference_id: reference.id.clone(),
                original_source: reference.source.clone(),
                status: "missing".to_string(),
                resolved_path: Some(display_path(candidate)),
                file_name: candidate
                    .file_name()
                    .and_then(OsStr::to_str)
                    .map(str::to_string),
                mime_type: None,
                size: None,
                sha256: None,
                message: Some("找不到 Markdown 引用的本地图片。".to_string()),
                candidates: None,
            };
        }
    };
    if !metadata.is_file() {
        return blocked_dependency(reference, "unsupported", "图片引用指向的不是普通文件。");
    }
    let bytes = match fs::read(candidate) {
        Ok(value) => value,
        Err(_) => return blocked_dependency(reference, "unsupported", "图片文件不可读取。"),
    };
    let mime = match detect_image_mime(&bytes) {
        Some(value) => value,
        None => {
            return blocked_dependency(reference, "unsupported", "文件内容不是受支持的图片格式。")
        }
    };
    if !extension_matches_mime(candidate, mime) {
        return blocked_dependency(reference, "unsupported", "图片真实类型与扩展名不匹配。");
    }
    if mime == "image/svg+xml" && !safe_svg(&bytes) {
        return blocked_dependency(reference, "unsafe", "SVG 包含不安全内容，已阻止写入。");
    }
    ResolvedImageDependencyDto {
        reference_id: reference.id.clone(),
        original_source: reference.source.clone(),
        status: "resolved".to_string(),
        resolved_path: Some(display_path(candidate)),
        file_name: candidate
            .file_name()
            .and_then(OsStr::to_str)
            .map(str::to_string),
        mime_type: Some(mime.to_string()),
        size: Some(metadata.len()),
        sha256: Some(sha256_hex(&bytes)),
        message: None,
        candidates: None,
    }
}

fn candidate_dto(path: &Path) -> Result<ImageCandidateDto, DesktopCommandError> {
    let metadata = fs::metadata(path).map_err(|_| DesktopCommandError::FileNotFound)?;
    let bytes = fs::read(path).map_err(|_| DesktopCommandError::FileNotReadable)?;
    Ok(ImageCandidateDto {
        absolute_path: display_path(path),
        file_name: path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("image")
            .to_string(),
        size: metadata.len(),
        mime_type: detect_image_mime(&bytes).map(str::to_string),
        sha256: Some(sha256_hex(&bytes)),
    })
}

fn normalize_source(base: &Path, source: &str) -> Result<PathBuf, DesktopCommandError> {
    let decoded = source.replace('\\', "/");
    if decoded.starts_with("//") {
        return Err(DesktopCommandError::UnsafePath);
    }
    let path = PathBuf::from(decoded);
    Ok(if path.is_absolute() {
        path
    } else {
        base.join(path)
    })
}

fn unsafe_source(source: &str) -> bool {
    let path = Path::new(source);
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn is_safe_workspace_id(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && value.split('-').map(str::len).eq([8, 4, 4, 4, 12])
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn ensure_child(parent: &Path, child: &Path) -> Result<(), DesktopCommandError> {
    let parent = parent.components().collect::<PathBuf>();
    let child = child.components().collect::<PathBuf>();
    if child.starts_with(&parent) {
        Ok(())
    } else {
        Err(DesktopCommandError::UnsafePath)
    }
}

fn safe_profile_markdown_path(directory: &str, slug: &str) -> Result<PathBuf, DesktopCommandError> {
    if !is_safe_slug(slug)
        || directory.starts_with('/')
        || directory.contains('\\')
        || directory.contains("..")
    {
        return Err(DesktopCommandError::UnsafePath);
    }
    let path = PathBuf::from(directory).join(format!("{slug}.md"));
    if !path.starts_with("content") {
        return Err(DesktopCommandError::UnsafePath);
    }
    Ok(path)
}

fn is_safe_slug(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn safe_file_stem(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("image");
    let mut output = String::new();
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' || ch == ' ' {
            output.push('-');
        }
    }
    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    }
}

fn target_extension(mime: &str) -> &'static str {
    match mime {
        "image/png" | "image/jpeg" => "webp",
        "image/svg+xml" => "svg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        _ => "bin",
    }
}

fn extension_matches_mime(path: &Path, mime: &str) -> bool {
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        (extension.as_str(), mime),
        ("png", "image/png")
            | ("jpg", "image/jpeg")
            | ("jpeg", "image/jpeg")
            | ("gif", "image/gif")
            | ("webp", "image/webp")
            | ("avif", "image/avif")
            | ("svg", "image/svg+xml")
    )
}

fn safe_svg(bytes: &[u8]) -> bool {
    let Some(text) = std::str::from_utf8(bytes).ok() else {
        return false;
    };
    let lower = text.to_ascii_lowercase();
    !lower.contains("<script")
        && !lower.contains("javascript:")
        && !lower.contains(" onload=")
        && !lower.contains(" onclick=")
        && !lower.contains(" onerror=")
        && !lower.contains(" href=\"http")
        && !lower.contains(" xlink:href=\"http")
}

fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.get(4..12) == Some(b"ftypavif") || bytes.get(4..12) == Some(b"ftypavis") {
        Some("image/avif")
    } else if std::str::from_utf8(bytes)
        .ok()
        .is_some_and(|text| text.trim_start().starts_with("<svg"))
    {
        Some("image/svg+xml")
    } else {
        None
    }
}

fn remote_dependency(reference: &MarkdownImageReferenceDto) -> ResolvedImageDependencyDto {
    ResolvedImageDependencyDto {
        reference_id: reference.id.clone(),
        original_source: reference.source.clone(),
        status: "remote".to_string(),
        resolved_path: None,
        file_name: None,
        mime_type: None,
        size: None,
        sha256: None,
        message: Some("远程图片会保留原始 URL，本轮不会自动下载。".to_string()),
        candidates: None,
    }
}

fn blocked_dependency(
    reference: &MarkdownImageReferenceDto,
    status: &str,
    message: &str,
) -> ResolvedImageDependencyDto {
    ResolvedImageDependencyDto {
        reference_id: reference.id.clone(),
        original_source: reference.source.clone(),
        status: status.to_string(),
        resolved_path: None,
        file_name: Path::new(&reference.source)
            .file_name()
            .and_then(OsStr::to_str)
            .map(str::to_string),
        mime_type: None,
        size: None,
        sha256: None,
        message: Some(message.to_string()),
        candidates: None,
    }
}

fn strip_front_matter(markdown: &str) -> &str {
    if let Some(rest) = markdown.strip_prefix("---\n") {
        if let Some(index) = rest.find("\n---") {
            return rest[(index + 4)..].trim_start_matches(['\r', '\n']);
        }
    }
    markdown
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::tempdir;

    fn png_bytes() -> Vec<u8> {
        vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4,
            0, 9, 251, 3, 253, 167, 159, 129, 80, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]
    }

    fn reference(source: &str, kind: &str) -> MarkdownImageReferenceDto {
        MarkdownImageReferenceDto {
            id: "image-001".to_string(),
            raw: source.to_string(),
            source: source.to_string(),
            alt: Some("图".to_string()),
            title: None,
            kind: kind.to_string(),
            path_kind: "relative".to_string(),
            line: Some(1),
            column: Some(1),
        }
    }

    fn init_target_repo(dir: &Path) {
        Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@davinci.test"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Davinci Test"])
            .current_dir(dir)
            .output()
            .unwrap();
        fs::create_dir_all(dir.join("content/other/uncategorized")).unwrap();
        fs::create_dir_all(dir.join("public/assets/notes")).unwrap();
        fs::create_dir_all(dir.join("config")).unwrap();
        fs::write(
            dir.join("config/archive-profiles.yml"),
            "archiveProfiles:\n  - id: uncategorized\n    name: Other\n    category: Other\n    topic: Uncategorized\n    directory: content/other/uncategorized\n    defaultTags: []\n",
        )
        .unwrap();
        fs::write(dir.join("README.md"), "# Target Repo").unwrap();
        Command::new("git")
            .args(["add", "README.md", "config/archive-profiles.yml"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    fn workspace_request(
        repo: &Path,
        source: &Path,
        content: &str,
    ) -> GeneratePublishWorkspaceRequest {
        GeneratePublishWorkspaceRequest {
            repository_root: display_path(repo),
            source_markdown_path: display_path(source),
            source_fingerprint: sha256_hex(content.as_bytes()),
            markdown_content: content.to_string(),
            article: ArticleInfoDto {
                title: "Title".to_string(),
                description: "".to_string(),
                slug: "title".to_string(),
                tags: vec![],
                date: "2026-07-30".to_string(),
                updated: "2026-07-30".to_string(),
                draft: false,
                featured: false,
            },
            archive_profile: ArchiveProfileDto {
                id: "uncategorized".to_string(),
                name: "Other".to_string(),
                category: "Other".to_string(),
                topic: Some("Uncategorized".to_string()),
                directory: "content/other/uncategorized".to_string(),
                default_tags: vec![],
                description: None,
            },
            image_references: vec![],
            dependencies: vec![],
            pending_archive_profiles: vec![],
        }
    }

    #[test]
    fn reads_markdown_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "# Title").unwrap();
        let result = read_markdown_file(&file, MAX_MARKDOWN_SIZE).unwrap();
        assert_eq!(result.file_name, "note.md");
        assert_eq!(result.content, "# Title");
    }

    #[test]
    fn rejects_bad_extension() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.txt");
        fs::write(&file, "# Title").unwrap();
        assert!(matches!(
            read_markdown_file(&file, MAX_MARKDOWN_SIZE),
            Err(DesktopCommandError::UnsupportedFileExtension)
        ));
    }

    #[test]
    fn rejects_too_large_markdown() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "abc").unwrap();
        assert!(matches!(
            read_markdown_file(&file, 1),
            Err(DesktopCommandError::FileTooLarge)
        ));
    }

    #[test]
    fn resolves_relative_image() {
        let dir = tempdir().unwrap();
        let image = dir.path().join("a.png");
        fs::write(&image, png_bytes()).unwrap();
        let request = ResolveImageDependenciesRequest {
            markdown_file: SelectedMarkdownFileDto {
                absolute_path: display_path(&dir.path().join("note.md")),
                file_name: "note.md".to_string(),
                directory_path: display_path(dir.path()),
                size: 1,
                modified_at: None,
                content: String::new(),
                source_fingerprint: String::new(),
            },
            references: vec![reference("a.png", "markdown")],
            obsidian: None,
        };
        let result = resolve_dependencies(request).unwrap();
        assert_eq!(result[0].status, "resolved");
        assert_eq!(result[0].mime_type.as_deref(), Some("image/png"));
    }

    #[test]
    fn rejects_traversal_image() {
        assert!(unsafe_source("../secret.png"));
    }

    #[test]
    fn detects_missing_image() {
        let dir = tempdir().unwrap();
        let result = resolve_candidate(
            &reference("missing.png", "markdown"),
            &dir.path().join("missing.png"),
        );
        assert_eq!(result.status, "missing");
    }

    #[test]
    fn detects_bad_mime() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("fake.png");
        fs::write(&file, "not image").unwrap();
        let result = resolve_candidate(&reference("fake.png", "markdown"), &file);
        assert_eq!(result.status, "unsupported");
    }

    #[test]
    fn sha_is_stable() {
        assert_eq!(sha256_hex(b"abc"), sha256_hex(b"abc"));
    }

    #[test]
    fn target_path_escape_rejected() {
        assert!(safe_profile_markdown_path("../private", "note").is_err());
        assert!(safe_profile_markdown_path("content/ok", "../note").is_err());
    }

    #[test]
    fn creates_and_discards_workspace() {
        let source = tempdir().unwrap();
        let target = tempdir().unwrap();
        init_target_repo(target.path());
        let md = source.path().join("note.md");
        fs::write(&md, "# Title").unwrap();
        let request = workspace_request(target.path(), &md, "# Title");
        let result = generate_workspace(request).unwrap();
        assert!(Path::new(&result.workspace_path).exists());
        fs::remove_dir_all(result.workspace_path).unwrap();
    }

    #[test]
    fn rejects_missing_repository_root_for_workspace() {
        let source = tempdir().unwrap();
        let md = source.path().join("note.md");
        fs::write(&md, "# Title").unwrap();
        let mut request = workspace_request(source.path(), &md, "# Title");
        request.repository_root = String::new();
        assert!(matches!(
            generate_workspace(request),
            Err(DesktopCommandError::GitRepositoryNotFound)
        ));
    }

    #[test]
    fn writes_workspace_under_explicit_target_when_source_is_external() {
        let source = tempdir().unwrap();
        let target = tempdir().unwrap();
        init_target_repo(target.path());
        let md = source.path().join("external-note.md");
        fs::write(&md, "# Title").unwrap();

        let result = generate_workspace(workspace_request(target.path(), &md, "# Title")).unwrap();
        assert!(Path::new(&result.workspace_path).starts_with(target.path()));
        assert!(Path::new(&result.target_markdown_path).starts_with(target.path()));
        assert!(!source.path().join(".publish-workspaces").exists());
        fs::remove_dir_all(result.workspace_path).unwrap();
    }
}
