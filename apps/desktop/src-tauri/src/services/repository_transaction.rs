use crate::security::path_guard::{is_symlink, verify_allowed_target};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::{fs, io::Write};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryFileChange {
    pub relative_path: String,
    pub operation: FileOperation,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileOperation {
    Create,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryBackupEntry {
    pub relative_path: String,
    pub backup_path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransactionStatus {
    Planned,
    Validating,
    Writing,
    Written,
    RolledBack,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryPublishTransaction {
    pub transaction_id: String,
    pub workspace_id: String,
    pub repository_root: String,
    pub operation: String,
    pub planned_changes: Vec<RepositoryFileChange>,
    pub backups: Vec<RepositoryBackupEntry>,
    pub status: TransactionStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PublishLock {
    transaction_id: String,
    process_id: u32,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PublishLockState {
    Missing,
    Active,
    Stale,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishLockStatus {
    pub state: PublishLockState,
    pub lock_path: String,
    pub transaction_id: Option<String>,
    pub process_id: Option<u32>,
    pub created_at: Option<String>,
    pub message: Option<String>,
}

const TRANSACTIONS_DIR: &str = ".publish-transactions";
const LOCK_FILE: &str = ".publish.lock";

pub struct PublishLockGuard {
    repo_root: PathBuf,
    transaction_id: String,
    release_on_drop: bool,
}

impl PublishLockGuard {
    pub fn acquire(repo_root: &Path, transaction_id: &str) -> Result<Self, String> {
        acquire_lock(repo_root, transaction_id)?;
        Ok(Self {
            repo_root: repo_root.to_path_buf(),
            transaction_id: transaction_id.to_string(),
            release_on_drop: true,
        })
    }

    pub fn verify_existing(repo_root: &Path, transaction_id: &str) -> Result<Self, String> {
        ensure_lock_owner(repo_root, transaction_id)?;
        Ok(Self {
            repo_root: repo_root.to_path_buf(),
            transaction_id: transaction_id.to_string(),
            release_on_drop: true,
        })
    }

    pub fn persist(mut self) {
        self.release_on_drop = false;
    }

    pub fn release(mut self) -> Result<(), String> {
        self.release_on_drop = false;
        release_lock(&self.repo_root, &self.transaction_id)
    }
}

impl Drop for PublishLockGuard {
    fn drop(&mut self) {
        if self.release_on_drop {
            if let Err(error) = release_lock(&self.repo_root, &self.transaction_id) {
                eprintln!("PUBLISH_LOCK_RELEASE_FAILED: {}", error);
            }
        }
    }
}

pub fn create_transaction(
    repo_root: &Path,
    workspace_id: &str,
    operation: &str,
    planned_changes: Vec<RepositoryFileChange>,
) -> Result<RepositoryPublishTransaction, String> {
    let transaction_id = Uuid::new_v4().to_string();
    let tx_dir = repo_root.join(TRANSACTIONS_DIR).join(&transaction_id);
    let backups_dir = tx_dir.join("backups");
    fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("failed to create transaction directory: {}", e))?;

    let transaction = RepositoryPublishTransaction {
        transaction_id: transaction_id.clone(),
        workspace_id: workspace_id.to_string(),
        repository_root: repo_root.to_string_lossy().to_string(),
        operation: operation.to_string(),
        planned_changes,
        backups: Vec::new(),
        status: TransactionStatus::Planned,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let manifest = serde_json::to_string_pretty(&transaction)
        .map_err(|e| format!("failed to serialize transaction manifest: {}", e))?;
    let manifest_path = tx_dir.join("manifest.json");
    let mut file = fs::File::create(&manifest_path)
        .map_err(|e| format!("failed to create transaction manifest: {}", e))?;
    file.write_all(manifest.as_bytes())
        .map_err(|e| format!("failed to write transaction manifest: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("failed to sync transaction manifest: {}", e))?;

    fs::write(tx_dir.join("journal.json"), "[]")
        .map_err(|e| format!("failed to create transaction journal: {}", e))?;

    Ok(transaction)
}

pub fn acquire_lock(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let lock_path = repo_root.join(LOCK_FILE);
    if lock_path.exists() {
        let status = inspect_lock(repo_root)?;
        return match status.state {
            PublishLockState::Active => Err(format!(
                "PUBLISH_LOCK_ACTIVE: {}",
                status.transaction_id.unwrap_or_default()
            )),
            PublishLockState::Stale => Err(format!(
                "PUBLISH_LOCK_STALE: {}",
                status.transaction_id.unwrap_or_default()
            )),
            PublishLockState::Invalid => Err("PUBLISH_LOCK_INVALID".to_string()),
            PublishLockState::Missing => Ok(()),
        };
    }

    let lock = PublishLock {
        transaction_id: transaction_id.to_string(),
        process_id: std::process::id(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let content = serde_json::to_string_pretty(&lock)
        .map_err(|e| format!("failed to serialize publish lock: {}", e))?;
    fs::write(&lock_path, content).map_err(|e| format!("failed to write publish lock: {}", e))?;
    Ok(())
}

pub fn release_lock(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let lock_path = repo_root.join(LOCK_FILE);
    if !lock_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&lock_path).map_err(|_| "PUBLISH_LOCK_INVALID".to_string())?;
    let lock = serde_json::from_str::<PublishLock>(&content)
        .map_err(|_| "PUBLISH_LOCK_INVALID".to_string())?;
    if lock.transaction_id != transaction_id {
        return Err(format!(
            "PUBLISH_LOCK_OWNERSHIP_MISMATCH: expected {}, found {}",
            transaction_id, lock.transaction_id
        ));
    }

    fs::remove_file(&lock_path).map_err(|e| format!("PUBLISH_LOCK_RELEASE_FAILED: {}", e))?;
    Ok(())
}

pub fn inspect_lock(repo_root: &Path) -> Result<PublishLockStatus, String> {
    let lock_path = repo_root.join(LOCK_FILE);
    let lock_path_text = display_path(&lock_path);
    if !lock_path.exists() {
        return Ok(PublishLockStatus {
            state: PublishLockState::Missing,
            lock_path: lock_path_text,
            transaction_id: None,
            process_id: None,
            created_at: None,
            message: None,
        });
    }

    let content = fs::read_to_string(&lock_path).map_err(|_| "PUBLISH_LOCK_INVALID".to_string())?;
    let lock = match serde_json::from_str::<PublishLock>(&content) {
        Ok(lock) => lock,
        Err(_) => {
            return Ok(PublishLockStatus {
                state: PublishLockState::Invalid,
                lock_path: lock_path_text,
                transaction_id: None,
                process_id: None,
                created_at: None,
                message: Some("PUBLISH_LOCK_INVALID".to_string()),
            })
        }
    };

    let active = process_exists(lock.process_id);
    Ok(PublishLockStatus {
        state: if active {
            PublishLockState::Active
        } else {
            PublishLockState::Stale
        },
        lock_path: lock_path_text,
        transaction_id: Some(lock.transaction_id),
        process_id: Some(lock.process_id),
        created_at: Some(lock.created_at),
        message: Some(if active {
            "PUBLISH_LOCK_ACTIVE".to_string()
        } else {
            "PUBLISH_LOCK_STALE".to_string()
        }),
    })
}

pub fn cleanup_stale_lock(
    repo_root: &Path,
    expected_transaction_id: Option<&str>,
) -> Result<PublishLockStatus, String> {
    let status = inspect_lock(repo_root)?;
    match status.state {
        PublishLockState::Missing => Ok(status),
        PublishLockState::Active => Err("PUBLISH_LOCK_ACTIVE".to_string()),
        PublishLockState::Invalid => Err("PUBLISH_LOCK_INVALID".to_string()),
        PublishLockState::Stale => {
            if let (Some(expected), Some(actual)) =
                (expected_transaction_id, status.transaction_id.as_deref())
            {
                if expected != actual {
                    return Err(format!(
                        "PUBLISH_LOCK_OWNERSHIP_MISMATCH: expected {}, found {}",
                        expected, actual
                    ));
                }
            }
            fs::remove_file(repo_root.join(LOCK_FILE))
                .map_err(|e| format!("PUBLISH_LOCK_RELEASE_FAILED: {}", e))?;
            inspect_lock(repo_root)
        }
    }
}

fn ensure_lock_owner(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let status = inspect_lock(repo_root)?;
    match status.state {
        PublishLockState::Active => {
            if status.transaction_id.as_deref() == Some(transaction_id) {
                Ok(())
            } else {
                Err(format!(
                    "PUBLISH_LOCK_OWNERSHIP_MISMATCH: expected {}, found {}",
                    transaction_id,
                    status.transaction_id.unwrap_or_default()
                ))
            }
        }
        PublishLockState::Stale => Err(format!(
            "PUBLISH_LOCK_STALE: {}",
            status.transaction_id.unwrap_or_default()
        )),
        PublishLockState::Missing => Err("PUBLISH_LOCK_MISSING".to_string()),
        PublishLockState::Invalid => Err("PUBLISH_LOCK_INVALID".to_string()),
    }
}

pub fn atomic_write(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("target path has no parent: {}", target.display()))?;
    fs::create_dir_all(parent).map_err(|e| {
        format!(
            "failed to create target directory {}: {}",
            parent.display(),
            e
        )
    })?;

    let tmp_path = parent.join(format!(
        ".tmp_{}",
        target
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_else(|| std::borrow::Cow::Borrowed("tmp"))
    ));
    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("failed to create temp file {}: {}", tmp_path.display(), e))?;
    file.write_all(content)
        .map_err(|e| format!("failed to write temp file: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("failed to sync temp file: {}", e))?;
    fs::rename(&tmp_path, target).map_err(|e| {
        format!(
            "failed to atomically move {} to {}: {}",
            tmp_path.display(),
            target.display(),
            e
        )
    })?;
    if let Ok(parent_file) = fs::File::open(parent) {
        let _ = parent_file.sync_all();
    }
    Ok(())
}

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
            .map_err(|e| format!("target path is outside allowed roots: {}", e))?;

        if target_path.exists() && is_symlink(&target_path) {
            return Err(format!(
                "target path is a symlink: {}",
                change.relative_path
            ));
        }

        let workspace_file = workspace_path.join(&change.relative_path);
        if !workspace_file.exists() {
            return Err(format!(
                "workspace file not found for planned change: {}",
                change.relative_path
            ));
        }

        if target_path.exists() {
            let backup_content =
                fs::read(&target_path).map_err(|e| format!("failed to read backup: {}", e))?;
            let backup_sha = sha256_hex(&backup_content);
            let backup_dir = repo_root
                .join(TRANSACTIONS_DIR)
                .join(transaction_id)
                .join("backups");
            fs::create_dir_all(&backup_dir)
                .map_err(|e| format!("failed to create backup directory: {}", e))?;
            let backup_name = change.relative_path.replace(['/', '\\'], "_");
            let backup_path = backup_dir.join(format!("{}_{}", backup_sha, backup_name));
            fs::write(&backup_path, &backup_content)
                .map_err(|e| format!("failed to write backup file: {}", e))?;
            backups.push(RepositoryBackupEntry {
                relative_path: change.relative_path.clone(),
                backup_path: backup_path.to_string_lossy().to_string(),
                sha256: backup_sha,
            });
        }

        let content = fs::read(&workspace_file).map_err(|e| {
            format!(
                "failed to read workspace file {}: {}",
                workspace_file.display(),
                e
            )
        })?;
        let actual_sha = sha256_hex(&content);
        if actual_sha != change.sha256 {
            return Err(format!(
                "file sha256 mismatch for {}: expected {}, got {}",
                change.relative_path, change.sha256, actual_sha
            ));
        }
        atomic_write(&target_path, &content)?;
    }
    Ok(())
}

pub fn rollback_transaction(
    repo_root: &Path,
    transaction: &RepositoryPublishTransaction,
) -> Result<(), String> {
    for backup in transaction.backups.iter().rev() {
        let target = repo_root.join(&backup.relative_path);
        let backup_path = PathBuf::from(&backup.backup_path);
        if backup_path.exists() {
            let content =
                fs::read(&backup_path).map_err(|e| format!("failed to read backup: {}", e))?;
            atomic_write(&target, &content)?;
        }
    }

    let backed_up: std::collections::HashSet<&str> = transaction
        .backups
        .iter()
        .map(|b| b.relative_path.as_str())
        .collect();
    for change in &transaction.planned_changes {
        if !backed_up.contains(change.relative_path.as_str()) {
            let target = repo_root.join(&change.relative_path);
            if target.exists() {
                fs::remove_file(&target).map_err(|e| {
                    format!("failed to remove created file {}: {}", target.display(), e)
                })?;
                if let Some(parent) = target.parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
        }
    }

    cleanup_transaction(repo_root, &transaction.transaction_id)?;
    Ok(())
}

pub fn cleanup_transaction(repo_root: &Path, transaction_id: &str) -> Result<(), String> {
    let tx_dir = repo_root.join(TRANSACTIONS_DIR).join(transaction_id);
    if tx_dir.exists() {
        fs::remove_dir_all(&tx_dir)
            .map_err(|e| format!("failed to clean transaction directory: {}", e))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn process_exists(pid: u32) -> bool {
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub fn process_exists(pid: u32) -> bool {
    PathBuf::from(format!("/proc/{}", pid)).exists()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(bytes))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn load_transaction(
    repo_root: &Path,
    transaction_id: &str,
) -> Result<RepositoryPublishTransaction, String> {
    let manifest_path = repo_root
        .join(TRANSACTIONS_DIR)
        .join(transaction_id)
        .join("manifest.json");
    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("failed to parse manifest: {}", e))
}

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
    let content = serde_json::to_string_pretty(&tx)
        .map_err(|e| format!("failed to serialize manifest: {}", e))?;
    fs::write(&manifest_path, content).map_err(|e| format!("failed to update manifest: {}", e))?;
    Ok(())
}

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
    let content = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("failed to serialize journal: {}", e))?;
    fs::write(&journal_path, content).map_err(|e| format!("failed to write journal: {}", e))?;
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
    fn guard_releases_on_drop() {
        let dir = tempdir().unwrap();
        {
            let _guard = PublishLockGuard::acquire(dir.path(), "tx-drop").unwrap();
            assert!(dir.path().join(LOCK_FILE).exists());
        }
        assert!(!dir.path().join(LOCK_FILE).exists());
    }

    #[test]
    fn persisted_guard_keeps_lock_for_follow_up_commands() {
        let dir = tempdir().unwrap();
        PublishLockGuard::acquire(dir.path(), "tx-persist")
            .unwrap()
            .persist();

        let status = inspect_lock(dir.path()).unwrap();
        assert_eq!(status.state, PublishLockState::Active);
        assert_eq!(status.transaction_id.as_deref(), Some("tx-persist"));
        release_lock(dir.path(), "tx-persist").unwrap();
    }

    #[test]
    fn stale_process_id_can_be_cleaned() {
        let dir = tempdir().unwrap();
        let lock = PublishLock {
            transaction_id: "stale-tx".to_string(),
            process_id: u32::MAX,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        fs::write(
            dir.path().join(LOCK_FILE),
            serde_json::to_string_pretty(&lock).unwrap(),
        )
        .unwrap();

        let status = inspect_lock(dir.path()).unwrap();
        assert_eq!(status.state, PublishLockState::Stale);
        let cleaned = cleanup_stale_lock(dir.path(), Some("stale-tx")).unwrap();
        assert_eq!(cleaned.state, PublishLockState::Missing);
        assert!(!dir.path().join(LOCK_FILE).exists());
    }

    #[test]
    fn active_process_id_cannot_be_cleaned() {
        let dir = tempdir().unwrap();
        acquire_lock(dir.path(), "active-tx").unwrap();

        let result = cleanup_stale_lock(dir.path(), Some("active-tx"));

        assert!(result.unwrap_err().contains("PUBLISH_LOCK_ACTIVE"));
        release_lock(dir.path(), "active-tx").unwrap();
    }

    #[test]
    fn mismatched_transaction_refuses_release_and_cleanup() {
        let dir = tempdir().unwrap();
        let lock = PublishLock {
            transaction_id: "actual-tx".to_string(),
            process_id: u32::MAX,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        fs::write(
            dir.path().join(LOCK_FILE),
            serde_json::to_string_pretty(&lock).unwrap(),
        )
        .unwrap();

        assert!(release_lock(dir.path(), "other-tx")
            .unwrap_err()
            .contains("PUBLISH_LOCK_OWNERSHIP_MISMATCH"));
        assert!(cleanup_stale_lock(dir.path(), Some("other-tx"))
            .unwrap_err()
            .contains("PUBLISH_LOCK_OWNERSHIP_MISMATCH"));
        assert!(dir.path().join(LOCK_FILE).exists());
    }

    #[test]
    fn corrupted_lock_reports_invalid_and_is_not_cleaned() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(LOCK_FILE), "{not-json").unwrap();

        let status = inspect_lock(dir.path()).unwrap();
        assert_eq!(status.state, PublishLockState::Invalid);
        assert!(cleanup_stale_lock(dir.path(), None)
            .unwrap_err()
            .contains("PUBLISH_LOCK_INVALID"));
        assert!(dir.path().join(LOCK_FILE).exists());
    }

    #[test]
    fn concurrent_transaction_cannot_acquire_lock() {
        let dir = tempdir().unwrap();
        acquire_lock(dir.path(), "first").unwrap();

        let result = acquire_lock(dir.path(), "second");

        assert!(result.unwrap_err().contains("PUBLISH_LOCK_ACTIVE"));
        release_lock(dir.path(), "first").unwrap();
    }

    #[test]
    fn untracked_private_files_do_not_affect_lock_check() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("private.md"), "# private").unwrap();

        let status = inspect_lock(dir.path()).unwrap();

        assert_eq!(status.state, PublishLockState::Missing);
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
        execute_write(
            dir.path(),
            &workspace,
            &tx.transaction_id,
            &changes,
            &mut backups,
        )
        .unwrap();

        let target = dir.path().join("content/test/note.md");
        assert!(target.exists());

        let mut tx_to_rollback = tx.clone();
        tx_to_rollback.backups = backups;
        rollback_transaction(dir.path(), &tx_to_rollback).unwrap();

        assert!(!target.exists());
    }

    #[test]
    fn rollback_releases_when_owned_by_guard() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        fs::create_dir_all(&workspace).unwrap();
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
        let guard = PublishLockGuard::acquire(dir.path(), &tx.transaction_id).unwrap();
        let mut backups = Vec::new();
        execute_write(
            dir.path(),
            &workspace,
            &tx.transaction_id,
            &changes,
            &mut backups,
        )
        .unwrap();
        let mut tx_to_rollback = tx.clone();
        tx_to_rollback.backups = backups;

        rollback_transaction(dir.path(), &tx_to_rollback).unwrap();
        guard.release().unwrap();

        assert!(!dir.path().join(LOCK_FILE).exists());
    }

    #[test]
    fn rejects_outside_content() {
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
        let dir = tempdir().unwrap();
        let target = dir.path().join("content/test/note.md");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "original").unwrap();
        assert!(!is_symlink(&target));
    }
}
