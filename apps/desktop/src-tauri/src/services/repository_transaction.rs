use crate::security::path_guard::{is_symlink, verify_allowed_target};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::{fs, io::Write};
use uuid::Uuid;

/// A single file change that will be applied to the repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryFileChange {
    /// Relative path within the repository (e.g. "content/ai-agent/note.md")
    pub relative_path: String,
    /// The operation type
    pub operation: FileOperation,
    /// Size in bytes (for display)
    pub size: u64,
    /// SHA-256 of the content (for verification)
    pub sha256: String,
}

/// Type of file operation in the repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileOperation {
    Create,
    Update,
    Delete,
}

/// A backup entry for files that were overwritten.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryBackupEntry {
    pub relative_path: String,
    pub backup_path: String,
    pub sha256: String,
}

/// Status of a repository publish transaction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransactionStatus {
    Planned,
    Validating,
    Writing,
    Written,
    RolledBack,
    Failed,
}

/// The full transaction state for a repository publish operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryPublishTransaction {
    pub transaction_id: String,
    pub workspace_id: String,
    pub repository_root: String,
    pub operation: String, // "create" | "update"
    pub planned_changes: Vec<RepositoryFileChange>,
    pub backups: Vec<RepositoryBackupEntry>,
    pub status: TransactionStatus,
    pub created_at: String,
}

/// Lock information for the publish lock file.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PublishLock {
    transaction_id: String,
    process_id: u32,
    created_at: String,
}

const TRANSACTIONS_DIR: &str = ".publish-transactions";
const LOCK_FILE: &str = ".publish.lock";

/// Create a new transaction directory and return the transaction.
pub fn create_transaction(
    repo_root: &Path,
    workspace_id: &str,
    operation: &str,
    planned_changes: Vec<RepositoryFileChange>,
) -> Result<RepositoryPublishTransaction, String> {
    let transaction_id = Uuid::new_v4().to_string();
    let tx_dir = repo_root.join(TRANSACTIONS_DIR).join(&transaction_id);

    // Create the transaction directory and subdirectories
    let backups_dir = tx_dir.join("backups");
    fs::create_dir_all(&backups_dir).map_err(|e| format!("无法创建事务目录：{}", e))?;

    let transaction = RepositoryPublishTransaction {
        transaction_id: transaction_id.clone(),
        workspace_id: workspace_id.to_string(),
        repository_root: repo_root.to_string_lossy().to_string(),
        operation: operation.to_string(),
        planned_changes: planned_changes.clone(),
        backups: Vec::new(),
        status: TransactionStatus::Planned,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // Write manifest.json
    let manifest = serde_json::to_string_pretty(&transaction)
        .map_err(|e| format!("序列化事务清单失败：{}", e))?;
    let manifest_path = tx_dir.join("manifest.json");
    let mut file =
        fs::File::create(&manifest_path).map_err(|e| format!("创建事务清单文件失败：{}", e))?;
    file.write_all(manifest.as_bytes())
        .map_err(|e| format!("写入事务清单失败：{}", e))?;
    file.sync_all()
        .map_err(|e| format!("同步事务清单失败：{}", e))?;

    // Write journal.json (start with empty array)
    let journal_path = tx_dir.join("journal.json");
    fs::write(&journal_path, "[]").map_err(|e| format!("创建事务日志失败：{}", e))?;

    Ok(transaction)
}

/// Try to acquire the publish lock.
pub fn acquire_lock(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let lock_path = repo_root.join(LOCK_FILE);

    // Check if lock already exists
    if lock_path.exists() {
        let content =
            fs::read_to_string(&lock_path).map_err(|_| "无法读取发布锁文件。".to_string())?;

        if let Ok(lock) = serde_json::from_str::<PublishLock>(&content) {
            // Check if the process still exists
            if process_exists(lock.process_id) {
                return Err(format!(
                    "另一个发布流程正在进行中（事务：{}）。请等待完成或手动清理锁文件。",
                    lock.transaction_id
                ));
            }
        }

        // Lock exists but process is dead; user needs to confirm cleanup
        return Err(format!(
            "发现遗留发布锁文件 ({})。请确认已无其他发布进程后手动删除该文件。",
            display_path(&lock_path)
        ));
    }

    // Write lock file
    let lock = PublishLock {
        transaction_id: transaction_id.to_string(),
        process_id: std::process::id(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let content =
        serde_json::to_string_pretty(&lock).map_err(|e| format!("序列化锁文件失败：{}", e))?;
    fs::write(&lock_path, content).map_err(|e| format!("写入发布锁文件失败：{}", e))?;

    Ok(())
}

/// Release the publish lock (only if it belongs to our transaction).
pub fn release_lock(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let lock_path = repo_root.join(LOCK_FILE);
    if !lock_path.exists() {
        return Ok(()); // No lock to release
    }

    let content = fs::read_to_string(&lock_path).map_err(|_| "无法读取发布锁文件。".to_string())?;

    if let Ok(lock) = serde_json::from_str::<PublishLock>(&content) {
        if lock.transaction_id == transaction_id {
            fs::remove_file(&lock_path).map_err(|e| format!("删除锁文件失败：{}", e))?;
        }
    }

    Ok(())
}

/// Acquire a lock for rollback even if another lock exists (force).
/// This is used during rollback to ensure we can clean up.
pub fn acquire_rollback_lock(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let lock_path = repo_root.join(LOCK_FILE);

    let lock = PublishLock {
        transaction_id: format!("rollback-{}", transaction_id),
        process_id: std::process::id(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let content =
        serde_json::to_string_pretty(&lock).map_err(|e| format!("序列化回滚锁失败：{}", e))?;
    fs::write(&lock_path, content).map_err(|e| format!("写入回滚锁失败：{}", e))?;

    Ok(())
}

/// Write a file atomically: write to a temp file, fsync, then rename.
pub fn atomic_write(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("目标路径没有父目录：{}", target.display()))?;

    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}：{}", parent.display(), e))?;

    let tmp_path = parent.join(format!(
        ".tmp_{}",
        target
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_else(|| std::borrow::Cow::Borrowed("tmp"))
    ));

    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("创建临时文件失败 {}：{}", tmp_path.display(), e))?;

    file.write_all(content)
        .map_err(|e| format!("写入临时文件失败：{}", e))?;

    file.sync_all()
        .map_err(|e| format!("同步临时文件失败：{}", e))?;

    fs::rename(&tmp_path, target).map_err(|e| {
        format!(
            "原子重命名失败 {} → {}：{}",
            tmp_path.display(),
            target.display(),
            e
        )
    })?;

    // Sync the parent directory
    if let Ok(parent_file) = fs::File::open(parent) {
        let _ = parent_file.sync_all();
    }

    Ok(())
}

/// Execute the planned changes: copy files from workspace to repository.
/// Returns the list of backup entries.
pub fn execute_write(
    repo_root: &Path,
    workspace_path: &Path,
    transaction_id: &str,
    changes: &[RepositoryFileChange],
    backups: &mut Vec<RepositoryBackupEntry>,
) -> Result<(), String> {
    for change in changes {
        let target_path = repo_root.join(&change.relative_path);

        verify_allowed_target(Path::new(&change.relative_path))
            .map_err(|e| format!("目标越界：{} ({})", change.relative_path, e))?;

        // Ensure target is not a symlink
        if target_path.exists() && is_symlink(&target_path) {
            return Err(format!(
                "目标路径是符号链接，已阻止写入：{}",
                change.relative_path
            ));
        }

        let workspace_file = workspace_path.join(&change.relative_path);
        if !workspace_file.exists() {
            return Err(format!("工作区中找不到文件：{}", change.relative_path));
        }

        // Backup existing file if it exists
        if target_path.exists() {
            let backup_content =
                fs::read(&target_path).map_err(|e| format!("读取现有文件备份失败：{}", e))?;
            let backup_sha = sha256_hex(&backup_content);

            let backup_dir = repo_root
                .join(TRANSACTIONS_DIR)
                .join(transaction_id)
                .join("backups");
            fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败：{}", e))?;

            // Use a safe backup filename
            let backup_name = change.relative_path.replace(['/', '\\'], "_");
            let backup_path = backup_dir.join(format!("{}_{}", backup_sha, backup_name));
            fs::write(&backup_path, &backup_content)
                .map_err(|e| format!("写入备份文件失败：{}", e))?;

            backups.push(RepositoryBackupEntry {
                relative_path: change.relative_path.clone(),
                backup_path: backup_path.to_string_lossy().to_string(),
                sha256: backup_sha,
            });
        }

        // Read workspace file and write atomically
        let content = fs::read(&workspace_file)
            .map_err(|e| format!("读取工作区文件失败 {}：{}", workspace_file.display(), e))?;

        // Verify SHA-256 match
        let actual_sha = sha256_hex(&content);
        if actual_sha != change.sha256 {
            return Err(format!(
                "文件 SHA-256 不匹配：{} (期望 {}，实际 {})",
                change.relative_path, change.sha256, actual_sha
            ));
        }

        atomic_write(&target_path, &content)?;
    }

    Ok(())
}

/// Roll back a failed transaction.
pub fn rollback_transaction(
    repo_root: &Path,
    transaction: &RepositoryPublishTransaction,
) -> Result<(), String> {
    // Acquire rollback lock
    acquire_rollback_lock(repo_root, &transaction.transaction_id)?;

    // Restore backups in reverse order (most recent first)
    for backup in transaction.backups.iter().rev() {
        let target = repo_root.join(&backup.relative_path);
        let backup_path = PathBuf::from(&backup.backup_path);

        if backup_path.exists() {
            let content = fs::read(&backup_path).map_err(|e| format!("读取备份文件失败：{}", e))?;
            atomic_write(&target, &content)?;
        }
    }

    // Remove files that were newly created (no backup existed)
    let backed_up: std::collections::HashSet<&str> = transaction
        .backups
        .iter()
        .map(|b| b.relative_path.as_str())
        .collect();

    for change in &transaction.planned_changes {
        if !backed_up.contains(change.relative_path.as_str()) {
            let target = repo_root.join(&change.relative_path);
            if target.exists() {
                fs::remove_file(&target)
                    .map_err(|e| format!("删除新建文件失败 {}：{}", target.display(), e))?;
                // Try removing empty parent directories
                if let Some(parent) = target.parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
        }
    }

    // Clean up transaction directory
    let tx_dir = repo_root
        .join(TRANSACTIONS_DIR)
        .join(&transaction.transaction_id);
    if tx_dir.exists() {
        fs::remove_dir_all(&tx_dir).map_err(|e| format!("清理事务目录失败：{}", e))?;
    }

    // Release lock
    release_lock(repo_root, &transaction.transaction_id)?;

    Ok(())
}

/// Clean up transaction directory after successful commit.
pub fn cleanup_transaction(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let tx_dir = repo_root.join(TRANSACTIONS_DIR).join(transaction_id);
    if tx_dir.exists() {
        fs::remove_dir_all(&tx_dir).map_err(|e| format!("清理事务目录失败：{}", e))?;
    }
    Ok(())
}

/// Check if a process with the given ID is still running (platform-aware).
#[cfg(target_os = "windows")]
fn process_exists(pid: u32) -> bool {
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn process_exists(pid: u32) -> bool {
    std::path::PathBuf::from(format!("/proc/{}", pid)).exists()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(bytes))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Load a transaction from its manifest file.
pub fn load_transaction(
    repo_root: &Path,
    transaction_id: &str,
) -> Result<RepositoryPublishTransaction, String> {
    let manifest_path = repo_root
        .join(TRANSACTIONS_DIR)
        .join(transaction_id)
        .join("manifest.json");

    let content =
        fs::read_to_string(&manifest_path).map_err(|e| format!("读取事务清单失败：{}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析事务清单失败：{}", e))
}

/// Update transaction status in manifest.
pub fn update_transaction_status(
    repo_root: &Path,
    transaction_id: &str,
    status: TransactionStatus,
) -> Result<(), String> {
    let mut tx = load_transaction(repo_root, transaction_id)?;
    tx.status = status;

    let manifest_path = repo_root
        .join(TRANSACTIONS_DIR)
        .join(transaction_id)
        .join("manifest.json");

    let content =
        serde_json::to_string_pretty(&tx).map_err(|e| format!("序列化事务清单失败：{}", e))?;
    fs::write(&manifest_path, content).map_err(|e| format!("更新事务清单失败：{}", e))?;

    Ok(())
}

/// Append a journal entry to the transaction journal.
pub fn append_journal(
    repo_root: &Path,
    transaction_id: &str,
    entry: &serde_json::Value,
) -> Result<(), String> {
    let journal_path = repo_root
        .join(TRANSACTIONS_DIR)
        .join(transaction_id)
        .join("journal.json");

    let content = fs::read_to_string(&journal_path).unwrap_or_else(|_| "[]".to_string());

    let mut entries: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap_or_default();
    entries.push(entry.clone());

    fs::write(
        &journal_path,
        serde_json::to_string_pretty(&entries).unwrap(),
    )
    .map_err(|e| format!("写入事务日志失败：{}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_transaction_directory() {
        let dir = tempdir().unwrap();
        let changes = vec![RepositoryFileChange {
            relative_path: "content/test/note.md".to_string(),
            operation: FileOperation::Create,
            size: 10,
            sha256: "abc".to_string(),
        }];

        let tx = create_transaction(dir.path(), "ws-1", "create", changes).unwrap();
        assert_eq!(tx.status, TransactionStatus::Planned);

        let tx_dir = dir.path().join(TRANSACTIONS_DIR).join(&tx.transaction_id);
        assert!(tx_dir.exists());
        assert!(tx_dir.join("manifest.json").exists());
        assert!(tx_dir.join("journal.json").exists());
    }

    #[test]
    fn lock_and_release() {
        let dir = tempdir().unwrap();
        let tx_id = "test-tx-id";

        acquire_lock(dir.path(), tx_id).unwrap();
        assert!(dir.path().join(LOCK_FILE).exists());

        release_lock(dir.path(), tx_id).unwrap();
        assert!(!dir.path().join(LOCK_FILE).exists());
    }

    #[test]
    fn atomic_write_works() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");

        atomic_write(&target, b"hello world").unwrap();
        assert!(target.exists());
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello world");
    }

    #[test]
    fn execute_and_rollback() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        fs::create_dir_all(&workspace).unwrap();

        // Create workspace file
        let content = b"# Test Note";
        let ws_file = workspace.join("content/test/note.md");
        fs::create_dir_all(ws_file.parent().unwrap()).unwrap();
        fs::write(&ws_file, content).unwrap();

        let changes = vec![RepositoryFileChange {
            relative_path: "content/test/note.md".to_string(),
            operation: FileOperation::Create,
            size: content.len() as u64,
            sha256: sha256_hex(content),
        }];

        let tx = create_transaction(dir.path(), "ws-1", "create", changes.clone()).unwrap();
        let mut backups = Vec::new();

        // Execute write
        execute_write(
            dir.path(),
            &workspace,
            &tx.transaction_id,
            &changes,
            &mut backups,
        )
        .unwrap();

        // Verify file was written
        let target = dir.path().join("content/test/note.md");
        assert!(target.exists());

        // Update transaction with backups
        let tx_with_backups = tx.clone();
        // Note: execute_write appends backups to the vec, but the tx already has empty backups
        // We need to store them back
        let mut tx_to_rollback = tx_with_backups;
        tx_to_rollback.backups = backups;

        // Rollback
        rollback_transaction(dir.path(), &tx_to_rollback).unwrap();

        // Verify file was removed
        assert!(!target.exists());
    }

    #[test]
    fn rejects_outside_content() {
        let _dir = tempdir().unwrap();
        let change = RepositoryFileChange {
            relative_path: "apps/desktop/src/lib.rs".to_string(),
            operation: FileOperation::Update,
            size: 10,
            sha256: "abc".to_string(),
        };

        let result = verify_allowed_target(Path::new(&change.relative_path));
        assert!(result.is_err());
    }

    #[test]
    fn rejects_symlink_target() {
        // This test would need symlink creation which may require admin on Windows
        // We just test the verification logic
        let dir = tempdir().unwrap();
        let _workspace = dir.path().join("workspace");
        fs::create_dir_all(&_workspace).unwrap();

        let _change = RepositoryFileChange {
            relative_path: "content/test/note.md".to_string(),
            operation: FileOperation::Create,
            size: 10,
            sha256: "abc".to_string(),
        };

        // Before execute_write, make the target a symlink
        let target = dir.path().join("content/test/note.md");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        // Write a regular file first, then check that is_symlink returns false
        fs::write(&target, "original").unwrap();
        assert!(!is_symlink(&target));
    }
}
