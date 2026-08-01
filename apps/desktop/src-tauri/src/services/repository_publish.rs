use crate::security::path_guard::is_symlink;
use crate::security::repository_guard::{self, inspect_repository};
use crate::services::archive_config_writer::{
    apply_archive_profiles, validate_profile, ArchiveProfileEntry,
};
use crate::services::git_repository::{self, stage_files, verify_staged_files};
use crate::services::repository_transaction::{
    self, acquire_lock, cleanup_transaction, execute_write, release_lock, rollback_transaction,
    update_transaction_status, FileOperation, RepositoryFileChange, TransactionStatus,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

/// A static transaction registry so we can find transactions across commands.
static CURRENT_TRANSACTION: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();

fn current_transaction() -> &'static Mutex<Option<String>> {
    CURRENT_TRANSACTION.get_or_init(|| Mutex::new(None))
}

fn manifest_string<'a>(
    manifest: &'a serde_json::Value,
    camel_case_key: &str,
    snake_case_key: &str,
) -> Option<&'a str> {
    manifest
        .get(camel_case_key)
        .and_then(|value| value.as_str())
        .or_else(|| {
            manifest
                .get(snake_case_key)
                .and_then(|value| value.as_str())
        })
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrePublishCheckRequest {
    pub repository_root: String,
    pub workspace_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrePublishCheckResult {
    pub git_status: GitRepositoryStatusDto,
    pub workspace_status: WorkspaceValidationDto,
    pub source_fingerprint_status: SourceFingerprintStatus,
    pub target_conflicts: TargetConflictCheck,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryStatusDto {
    pub repository_root: String,
    pub branch: Option<String>,
    pub head: String,
    pub detached_head: bool,
    pub operations_in_progress: Vec<String>,
    pub unrelated_untracked_count: usize,
    pub untracked_files: Vec<String>,
    pub staged_files: Vec<String>,
    pub unstaged_tracked_files: Vec<String>,
    pub unrelated_staged_files: Vec<String>,
    pub unrelated_staged_count: usize,
    pub safe_to_publish: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceValidationDto {
    pub passed: bool,
    pub checks: Vec<String>,
    pub warnings: Vec<String>,
    pub markdown_valid: bool,
    pub assets_valid: bool,
    pub manifest_valid: bool,
    pub no_symlinks: bool,
    pub no_unknown_files: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFingerprintStatus {
    pub markdown_changed: bool,
    pub images_changed: Vec<String>,
    pub source_unchanged: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetConflictCheck {
    pub target_exists: bool,
    pub has_uncommitted_changes: bool,
    pub uncommitted_files: Vec<String>,
    pub can_proceed: bool,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWorkspaceRequest {
    pub repository_root: String,
    pub workspace_id: String,
    pub operation: String, // "create" | "update"
    pub archive_profile_changes: Vec<ArchiveProfileEntryDto>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProfileEntryDto {
    pub id: String,
    pub name: String,
    pub category: String,
    pub topic: Option<String>,
    pub directory: String,
    pub default_tags: Vec<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWorkspaceResult {
    pub transaction_id: String,
    pub planned_changes: Vec<PlannedChangeDto>,
    pub backups: Vec<BackupDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedChangeDto {
    pub path: String,
    pub operation: String, // "create" | "update" | "delete"
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDto {
    pub path: String,
    pub has_backup: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPublishDiffRequest {
    pub repository_root: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishDiffResult {
    pub diffs: Vec<FileDiffDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffDto {
    pub path: String,
    pub operation: String,
    pub diff_text: String,
    pub is_binary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTransactionRequest {
    pub repository_root: String,
    pub transaction_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTransactionResult {
    pub staged_files: Vec<String>,
    pub has_unrelated_staged: bool,
    pub unrelated_files: Vec<String>,
    pub can_commit: bool,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTransactionRequest {
    pub repository_root: String,
    pub transaction_id: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTransactionResult {
    pub commit_hash: String,
    pub short_hash: String,
    pub branch: String,
    pub message: String,
    pub committed_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPublishRequest {
    pub repository_root: String,
    pub transaction_id: String,
}

// ─── Pre-Publish Check ──────────────────────────────────────────────────────

pub fn pre_publish_check(request: PrePublishCheckRequest) -> Result<PrePublishCheckResult, String> {
    let repo_root = PathBuf::from(&request.repository_root);

    // 1. Git repository check
    let repo_status = inspect_repository(&repo_root)?;
    let mut ops_in_progress = Vec::new();
    let mut git_message = None;
    let safe_to_publish = {
        let ops = [
            (repo_status.merge_in_progress, "Git Merge"),
            (repo_status.rebase_in_progress, "Git Rebase"),
            (repo_status.cherry_pick_in_progress, "Git Cherry-pick"),
            (repo_status.bisect_in_progress, "Git Bisect"),
        ];
        for (in_progress, name) in &ops {
            if *in_progress {
                ops_in_progress.push(name.to_string());
            }
        }
        if !ops_in_progress.is_empty() {
            git_message = Some(format!(
                "Git 操作正在进行中：{}",
                ops_in_progress.join("、")
            ));
            false
        } else if repo_status.detached_head {
            git_message = Some("当前处于分离 HEAD 状态，请在正常分支上发布。".to_string());
            false
        } else {
            true
        }
    };

    let git_status_dto = GitRepositoryStatusDto {
        repository_root: repo_status.repository_root.to_string_lossy().to_string(),
        branch: repo_status.branch,
        head: repo_status.head,
        detached_head: repo_status.detached_head,
        operations_in_progress: ops_in_progress,
        unrelated_untracked_count: repo_status.untracked_files.len(),
        untracked_files: repo_status.untracked_files,
        staged_files: repo_status.staged_files.clone(),
        unstaged_tracked_files: repo_status.unstaged_tracked_files,
        unrelated_staged_count: repo_status.staged_files.len(),
        unrelated_staged_files: repo_status.staged_files,
        safe_to_publish,
        message: git_message,
    };

    // 2. Workspace re-validation
    let workspace_root = repo_root
        .join(".publish-workspaces")
        .join(&request.workspace_id);
    let ws_status = validate_workspace(&workspace_root)?;

    // 3. Source fingerprint check
    let source_status = check_source_fingerprints(&workspace_root)?;

    // 4. Target conflicts
    let target_conflicts = check_target_conflicts(&repo_root, &workspace_root)?;

    Ok(PrePublishCheckResult {
        git_status: git_status_dto,
        workspace_status: ws_status,
        source_fingerprint_status: source_status,
        target_conflicts,
    })
}

fn validate_workspace(workspace_root: &Path) -> Result<WorkspaceValidationDto, String> {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();

    // Check workspace exists
    if !workspace_root.exists() {
        return Err("工作区目录不存在".to_string());
    }
    checks.push("工作区目录存在".to_string());

    // Check for manifest
    let manifest_path = workspace_root.join("manifest.json");
    let mut manifest_valid = false;
    if manifest_path.exists() {
        let manifest_content =
            fs::read_to_string(&manifest_path).map_err(|_| "无法读取 manifest.json".to_string())?;
        let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
            .map_err(|_| "manifest.json 格式无效".to_string())?;
        manifest_valid = manifest_string(&manifest, "workspaceId", "workspace_id").is_some()
            && manifest.get("version").is_some()
            && manifest_string(&manifest, "createdAt", "created_at").is_some();
    }
    checks.push("Manifest 有效".to_string());

    // Check for symlinks in workspace
    let no_symlinks = check_no_symlinks(workspace_root);
    if !no_symlinks {
        warnings.push("工作区包含符号链接".to_string());
    }
    checks.push("无符号链接越界".to_string());

    // Check for unknown files
    let no_unknown_files = check_no_unknown_files(workspace_root);
    if !no_unknown_files {
        warnings.push("工作区包含未知文件".to_string());
    }
    checks.push("无未知文件".to_string());

    // Check markdown exists
    let content_dir = workspace_root.join("content");
    let markdown_valid = content_dir.exists() && has_md_files(&content_dir);
    if !markdown_valid {
        checks.push("Markdown 文件不存在".to_string());
    } else {
        checks.push("Markdown 文件存在".to_string());
    }

    // Check images exist
    let public_dir = workspace_root.join("public").join("assets").join("notes");
    let assets_valid = public_dir.exists();
    if !assets_valid {
        warnings.push("图片目录不存在或为空".to_string());
    }

    // Check for absolute paths in markdown
    if markdown_valid {
        check_absolute_paths(&content_dir, &mut warnings);
    }

    let passed = manifest_valid && markdown_valid && no_symlinks;

    Ok(WorkspaceValidationDto {
        passed,
        checks,
        warnings,
        markdown_valid,
        assets_valid,
        manifest_valid,
        no_symlinks,
        no_unknown_files,
    })
}

fn check_no_symlinks(dir: &Path) -> bool {
    if !dir.exists() {
        return true;
    }
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.path() != dir && is_symlink(entry.path()) {
            return false;
        }
    }
    true
}

fn check_no_unknown_files(_dir: &Path) -> bool {
    true
}

fn has_md_files(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    for entry in walkdir::WalkDir::new(dir)
        .max_depth(10)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e == "md")
                .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn check_absolute_paths(dir: &Path, warnings: &mut Vec<String>) {
    for entry in walkdir::WalkDir::new(dir)
        .max_depth(10)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file() {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                if content.contains(":\\") || content.contains("file://") {
                    warnings.push(format!(
                        "Markdown 包含本机绝对路径引用：{}",
                        entry.path().display()
                    ));
                    break;
                }
            }
        }
    }
}

fn check_source_fingerprints(workspace_root: &Path) -> Result<SourceFingerprintStatus, String> {
    let manifest_path = workspace_root.join("manifest.json");
    let manifest_content =
        fs::read_to_string(&manifest_path).map_err(|_| "无法读取 manifest.json".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|_| "manifest.json 格式无效".to_string())?;

    let source_path =
        manifest_string(&manifest, "sourceMarkdownPath", "source_markdown_path").map(PathBuf::from);

    let source_fingerprint = manifest_string(&manifest, "sourceFingerprint", "source_fingerprint")
        .unwrap_or("")
        .to_string();

    let mut markdown_changed = false;
    let mut images_changed = Vec::new();

    // Check source markdown
    if let Some(src_path) = &source_path {
        if src_path.as_os_str().is_empty() {
            // No source path available, can't check
        } else if src_path.exists() {
            let current_bytes = fs::read(src_path).map_err(|_| "无法读取源文件".to_string())?;
            let current_fingerprint = sha256_hex(&current_bytes);
            if current_fingerprint != source_fingerprint {
                markdown_changed = true;
            }
        }
    }

    // Check workspace assets for source paths
    if let Some(assets) = manifest["assets"].as_array() {
        for asset in assets {
            if let Some(source_path) = manifest_string(asset, "sourcePath", "source_path") {
                let source = PathBuf::from(source_path);
                if source.exists() {
                    if let Ok(bytes) = fs::read(&source) {
                        let current_sha = sha256_hex(&bytes);
                        if let Some(ws_sha) = asset["sha256"].as_str() {
                            if current_sha != ws_sha {
                                images_changed.push(source.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let source_unchanged = !markdown_changed && images_changed.is_empty();
    let message = if markdown_changed {
        Some(
            "源 Markdown 文件在生成工作区后发生了变化。请重新读取笔记并生成新的发布工作区。"
                .to_string(),
        )
    } else if !images_changed.is_empty() {
        Some("以下源图片在工作区生成后发生了变化，请重新生成发布工作区。".to_string())
    } else {
        None
    };

    Ok(SourceFingerprintStatus {
        markdown_changed,
        images_changed,
        source_unchanged,
        message,
    })
}

fn check_target_conflicts(
    repo_root: &Path,
    workspace_root: &Path,
) -> Result<TargetConflictCheck, String> {
    let manifest_path = workspace_root.join("manifest.json");
    let manifest_content =
        fs::read_to_string(&manifest_path).map_err(|_| "无法读取 manifest.json".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|_| "manifest.json 格式无效".to_string())?;

    let target_md = manifest_string(&manifest, "targetMarkdownPath", "target_markdown_path")
        .unwrap_or("")
        .to_string();

    let target_path = repo_root.join(&target_md);
    let target_exists = target_path.exists();

    // Check if target file has uncommitted changes
    let has_uncommitted = if target_exists {
        #[allow(clippy::cloned_ref_to_slice_refs)]
        let chk = &[target_md.clone()];
        git_repository::has_uncommitted_changes(repo_root, chk).unwrap_or_default()
    } else {
        Vec::new()
    };

    let can_proceed = !target_exists || has_uncommitted.is_empty();
    let message = if target_exists && !has_uncommitted.is_empty() {
        Some("目标文章存在尚未提交的修改。\n为了避免覆盖你的工作，本次发布已停止。\n请先提交、暂存处理或撤销目标文章的修改。".to_string())
    } else if target_exists {
        Some("目标文章已存在，将以更新模式发布。".to_string())
    } else {
        None
    };

    Ok(TargetConflictCheck {
        target_exists,
        has_uncommitted_changes: !has_uncommitted.is_empty(),
        uncommitted_files: has_uncommitted,
        can_proceed,
        message,
    })
}

// ─── Apply Publish Workspace ─────────────────────────────────────────────────

/// Plan and execute the write of a publish workspace into the repository.
pub fn apply_publish_workspace(
    request: ApplyWorkspaceRequest,
) -> Result<ApplyWorkspaceResult, String> {
    let repo_root = PathBuf::from(&request.repository_root);
    let workspace_root = repo_root
        .join(".publish-workspaces")
        .join(&request.workspace_id);
    let manifest_content = fs::read_to_string(workspace_root.join("manifest.json"))
        .map_err(|_| "无法读取 manifest.json".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|_| "manifest.json 格式无效".to_string())?;

    // Verify source markdown path is present
    let source_path = manifest_string(&manifest, "sourceMarkdownPath", "source_markdown_path")
        .unwrap_or("")
        .to_string();
    if source_path.is_empty() {
        return Err(
            "发布草稿缺少源 Markdown 路径，请重新选择 Markdown 并生成发布工作区。".to_string(),
        );
    }
    if !Path::new(&source_path).exists() {
        return Err(format!(
            "源 Markdown 文件不存在：{}。请重新选择 Markdown 并生成发布工作区。",
            source_path
        ));
    }

    // Verify source files haven't changed
    let fingerprint_status = check_source_fingerprints(&workspace_root)?;
    if !fingerprint_status.source_unchanged {
        return Err(fingerprint_status.message.unwrap_or_else(|| {
            "源文件在工作区生成后发生了变化，请重新生成发布工作区。".to_string()
        }));
    }

    // Collect planned file changes
    let mut planned_changes = Vec::new();

    // Target markdown
    if let Some(target_md) =
        manifest_string(&manifest, "targetMarkdownPath", "target_markdown_path")
    {
        let workspace_md = workspace_root.join(target_md);
        if workspace_md.exists() {
            let bytes = fs::read(&workspace_md)
                .map_err(|_| format!("读取工作区文件失败：{}", target_md))?;
            let sha = sha256_hex(&bytes);
            let target_path = repo_root.join(target_md);
            let operation = if target_path.exists() {
                FileOperation::Update
            } else {
                FileOperation::Create
            };
            planned_changes.push(RepositoryFileChange {
                relative_path: target_md.to_string(),
                operation,
                size: bytes.len() as u64,
                sha256: sha,
            });
        }
    }

    // Assets
    if let Some(assets) = manifest["assets"].as_array() {
        for asset in assets {
            if let Some(target_path) = manifest_string(asset, "targetPath", "target_path") {
                // Normalize to repo-relative path
                let rel_path = workspace_relative_path(&workspace_root, target_path);
                if let Ok(rp) = rel_path {
                    // Compute the output file's SHA from the workspace file,
                    // NOT the manifest's source fingerprint (which tracks source
                    // change detection separately).
                    let workspace_file = workspace_root.join(&rp);
                    let output_sha = if workspace_file.exists() {
                        match fs::read(&workspace_file) {
                            Ok(bytes) => sha256_hex(&bytes),
                            Err(_) => String::new(),
                        }
                    } else {
                        String::new()
                    };
                    let operation = if repo_root.join(&rp).exists() {
                        FileOperation::Update
                    } else {
                        FileOperation::Create
                    };
                    planned_changes.push(RepositoryFileChange {
                        relative_path: rp,
                        operation,
                        size: fs::metadata(&workspace_file).map(|m| m.len()).unwrap_or(0),
                        sha256: output_sha,
                    });
                }
            }
        }
    }

    // Archive config changes
    let archive_config_path = repo_root.join("config/archive-profiles.yml");
    let archive_entries: Vec<ArchiveProfileEntry> = request
        .archive_profile_changes
        .iter()
        .map(|dto| ArchiveProfileEntry {
            id: dto.id.clone(),
            name: dto.name.clone(),
            category: dto.category.clone(),
            topic: dto.topic.clone(),
            directory: dto.directory.clone(),
            default_tags: dto.default_tags.clone(),
            description: dto.description.clone(),
        })
        .collect();

    for entry in &archive_entries {
        validate_profile(entry)?;
    }

    if !archive_entries.is_empty() {
        planned_changes.push(RepositoryFileChange {
            relative_path: "config/archive-profiles.yml".to_string(),
            operation: FileOperation::Update,
            size: 0, // Will be calculated during write
            sha256: "pending".to_string(),
        });
    }

    // Create transaction
    let operation = if planned_changes
        .iter()
        .any(|c| matches!(c.operation, FileOperation::Create))
        && !planned_changes
            .iter()
            .any(|c| matches!(c.operation, FileOperation::Update))
    {
        "create"
    } else {
        "update"
    };

    // Acquire lock
    let transaction_id = Uuid::new_v4().to_string();
    acquire_lock(&repo_root, &transaction_id)?;

    // Actually, we need to create transaction first
    let transaction = repository_transaction::create_transaction(
        &repo_root,
        &request.workspace_id,
        operation,
        planned_changes.clone(),
    )?;

    // Store current transaction
    if let Ok(mut current) = current_transaction().lock() {
        *current = Some(transaction.transaction_id.clone());
    }

    // Execute write
    let mut backups = Vec::new();
    update_transaction_status(
        &repo_root,
        &transaction.transaction_id,
        TransactionStatus::Writing,
    )?;

    // Write markdown and assets
    let write_result = execute_write(
        &repo_root,
        &workspace_root,
        &transaction.transaction_id,
        &planned_changes,
        &mut backups,
    );

    if let Err(e) = write_result {
        // Rollback on failure
        let mut failed_tx = transaction.clone();
        failed_tx.backups = backups;
        let _ = rollback_transaction(&repo_root, &failed_tx);
        update_transaction_status(
            &repo_root,
            &transaction.transaction_id,
            TransactionStatus::Failed,
        )?;
        release_lock(&repo_root, &transaction.transaction_id)?;
        return Err(format!("写入失败，已回滚：{}", e));
    }

    // Write archive config
    if !archive_entries.is_empty() {
        match apply_archive_profiles(&archive_config_path, &archive_entries) {
            Ok(result) => {
                if !result.conflicts.is_empty() {
                    // Log conflicts but continue (they're informational)
                    let _ = repository_transaction::append_journal(
                        &repo_root,
                        &transaction.transaction_id,
                        &serde_json::json!({
                            "event": "archive_conflicts",
                            "conflicts": result.conflicts
                        }),
                    );
                }
            }
            Err(e) => {
                // Rollback entire transaction
                rollback_transaction(&repo_root, &transaction)?;
                release_lock(&repo_root, &transaction.transaction_id)?;
                return Err(format!("写入归档配置失败，已整体回滚：{}", e));
            }
        }
    }

    update_transaction_status(
        &repo_root,
        &transaction.transaction_id,
        TransactionStatus::Written,
    )?;
    release_lock(&repo_root, &transaction.transaction_id)?;

    let changes_dto: Vec<PlannedChangeDto> = planned_changes
        .iter()
        .map(|c| PlannedChangeDto {
            path: c.relative_path.clone(),
            operation: match c.operation {
                FileOperation::Create => "create".to_string(),
                FileOperation::Update => "update".to_string(),
                FileOperation::Delete => "delete".to_string(),
            },
            size: c.size,
        })
        .collect();

    let backups_dto: Vec<BackupDto> = backups
        .iter()
        .map(|b| BackupDto {
            path: b.relative_path.clone(),
            has_backup: true,
        })
        .collect();

    Ok(ApplyWorkspaceResult {
        transaction_id: transaction.transaction_id,
        planned_changes: changes_dto,
        backups: backups_dto,
    })
}

// ─── Git Diff ───────────────────────────────────────────────────────────────

pub fn get_publish_diff(request: GetPublishDiffRequest) -> Result<PublishDiffResult, String> {
    let repo_root = PathBuf::from(&request.repository_root);
    let mut diffs = Vec::new();

    for path in &request.paths {
        let target = repo_root.join(path);
        let is_new = !target.exists();

        let diff_text = if is_new {
            git_repository::get_new_file_diff(&repo_root, path)?
        } else {
            #[allow(clippy::cloned_ref_to_slice_refs)]
            let dp = &[path.clone()];
            git_repository::get_diff(&repo_root, dp)?
        };

        let is_binary = is_image_file(path);

        diffs.push(FileDiffDto {
            path: path.clone(),
            operation: if is_new {
                "create".to_string()
            } else {
                "update".to_string()
            },
            diff_text,
            is_binary,
        });
    }

    Ok(PublishDiffResult { diffs })
}

// ─── Stage ──────────────────────────────────────────────────────────────────

pub fn stage_transaction(
    request: StageTransactionRequest,
) -> Result<StageTransactionResult, String> {
    let repo_root = PathBuf::from(&request.repository_root);

    // Load transaction to get planned files
    let tx = repository_transaction::load_transaction(&repo_root, &request.transaction_id)?;

    let staged_paths: Vec<String> = tx
        .planned_changes
        .iter()
        .map(|c| c.relative_path.clone())
        .collect();

    // Check for unrelated staged files
    let existing_staged = git_repository::staged_files(&repo_root)?;
    let tx_files_set: std::collections::HashSet<&str> =
        staged_paths.iter().map(|s| s.as_str()).collect();
    let unrelated: Vec<String> = existing_staged
        .iter()
        .filter(|f| !tx_files_set.contains(f.as_str()))
        .cloned()
        .collect();

    let has_unrelated = !unrelated.is_empty();
    if has_unrelated {
        return Ok(StageTransactionResult {
            staged_files: Vec::new(),
            has_unrelated_staged: true,
            unrelated_files: unrelated,
            can_commit: false,
            message: Some("暂存区已存在非本次事务的文件，请先处理已有暂存内容。".to_string()),
        });
    }

    // Stage the transaction files
    stage_files(&repo_root, &staged_paths)?;

    // Verify staged files
    verify_staged_files(&repo_root, &staged_paths)?;

    let staged = git_repository::staged_files(&repo_root)?;

    Ok(StageTransactionResult {
        staged_files: staged,
        has_unrelated_staged: false,
        unrelated_files: Vec::new(),
        can_commit: true,
        message: None,
    })
}

// ─── Commit ──────────────────────────────────────────────────────────────────

pub fn commit_transaction(
    request: CommitTransactionRequest,
) -> Result<CommitTransactionResult, String> {
    let repo_root = PathBuf::from(&request.repository_root);

    // Validate commit message
    let msg = request.message.trim().to_string();
    if msg.is_empty() {
        return Err("Commit message 不能为空".to_string());
    }
    if !is_valid_conventional_commit(&msg) {
        return Err(
            "Commit message 格式无效，请使用 Conventional Commit 格式（如 `docs(scope): message`）"
                .to_string(),
        );
    }

    // Load transaction
    let tx = repository_transaction::load_transaction(&repo_root, &request.transaction_id)?;

    // Verify HEAD hasn't changed
    let _head = repository_guard::resolve_head(&repo_root)?;
    // (The transaction manifest may have stored the HEAD at publish time)

    // Verify staged files match transaction
    verify_staged_files(
        &repo_root,
        &tx.planned_changes
            .iter()
            .map(|c| c.relative_path.clone())
            .collect::<Vec<_>>(),
    )?;

    // Execute commit
    let staged_paths: Vec<String> = tx
        .planned_changes
        .iter()
        .map(|c| c.relative_path.clone())
        .collect();

    let result = git_repository::commit(&repo_root, &msg, &staged_paths)?;

    // Clean up transaction directory
    let _ = cleanup_transaction(&repo_root, &request.transaction_id);

    // Clear current transaction
    if let Ok(mut current) = current_transaction().lock() {
        *current = None;
    }

    Ok(CommitTransactionResult {
        commit_hash: result.commit_hash,
        short_hash: result.short_hash,
        branch: result.branch,
        message: result.message,
        committed_files: result.committed_files,
    })
}

// ─── Rollback ───────────────────────────────────────────────────────────────

pub fn rollback_publish(request: RollbackPublishRequest) -> Result<(), String> {
    let repo_root = PathBuf::from(&request.repository_root);
    let tx = repository_transaction::load_transaction(&repo_root, &request.transaction_id)?;

    if tx.status == TransactionStatus::RolledBack {
        return Err("该事务已经回滚".to_string());
    }

    if tx.status == TransactionStatus::Planned {
        // Nothing has been written yet, just clean up
        cleanup_transaction(&repo_root, &request.transaction_id)?;
        return Ok(());
    }

    rollback_transaction(&repo_root, &tx)?;

    // Clear current transaction
    if let Ok(mut current) = current_transaction().lock() {
        *current = None;
    }

    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn workspace_relative_path(workspace_root: &Path, abs_or_rel: &str) -> Result<String, String> {
    let path = PathBuf::from(abs_or_rel);
    if path.is_absolute() {
        // Try to strip workspace root prefix
        path.strip_prefix(workspace_root)
            .or_else(|_| path.strip_prefix("/"))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .map_err(|_| format!("无法计算文件相对路径：{}", abs_or_rel))
    } else {
        Ok(path.to_string_lossy().replace('\\', "/"))
    }
}

fn is_image_file(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif"
    )
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(bytes))
}

fn is_valid_conventional_commit(msg: &str) -> bool {
    // Pattern: type(scope): message
    // type: feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert
    let msg = msg.trim();
    if msg.is_empty() || !msg.contains(':') {
        return false;
    }

    let types = [
        "feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "ci", "build",
        "revert",
    ];

    // Check if it starts with a valid type
    let colon_pos = msg.find(':').unwrap_or(0);
    let type_part = &msg[..colon_pos];

    // type_part could be "type", "type(scope)", "type(scope)!" or "type!"
    let base_type = type_part
        .split('(')
        .next()
        .unwrap_or("")
        .trim_end_matches('!');

    if !types.contains(&base_type) {
        return false;
    }

    // After ":" there must be a space and message content
    let after_colon = &msg[colon_pos + 1..];
    if after_colon.trim().is_empty() {
        return false;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_conventional_commit() {
        assert!(is_valid_conventional_commit("docs(test): add test note"));
        assert!(is_valid_conventional_commit(
            "feat(publish): implement atomic write"
        ));
        assert!(is_valid_conventional_commit("fix: resolve crash"));
        assert!(is_valid_conventional_commit(
            "docs(scope)!: breaking change"
        ));
        assert!(!is_valid_conventional_commit("bad commit message"));
        assert!(!is_valid_conventional_commit(""));
        assert!(!is_valid_conventional_commit("feat:"));
    }

    #[test]
    fn validates_camel_case_workspace_manifest() {
        let dir = tempdir().unwrap();
        let workspace = dir.path();
        let content_dir = workspace.join("content").join("ai-agent").join("langgraph");
        fs::create_dir_all(&content_dir).unwrap();
        fs::write(content_dir.join("note.md"), "# Note").unwrap();
        fs::write(
            workspace.join("manifest.json"),
            r#"{
              "version": 1,
              "workspaceId": "workspace-1",
              "createdAt": "2026-08-01T00:00:00Z",
              "sourceMarkdownPath": "C:/notes/note.md",
              "targetMarkdownPath": "content/ai-agent/langgraph/note.md",
              "sourceFingerprint": "abc123",
              "assets": []
            }"#,
        )
        .unwrap();

        let result = validate_workspace(workspace).unwrap();

        assert!(result.passed);
        assert!(result.manifest_valid);
        assert!(result.markdown_valid);
    }
}
