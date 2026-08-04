//! Safety checks before pushing a publish commit.
//!
//! Push is only allowed for the current branch's existing commit, never with
//! force flags, never for all branches or tags, and never when the remote is
//! ahead or diverged.

use crate::security::repository_guard::{
    current_branch, resolve_head, verify_no_operation_in_progress,
};
use std::path::Path;

/// The branch that is allowed to be pushed for publishing.
pub const PUBLISH_BRANCH: &str = "master";

/// Result of the pre-push sync check.
#[derive(Debug, Clone, PartialEq)]
pub enum SyncState {
    /// Local is ahead of remote, remote has nothing we don't have.
    Ahead { ahead: usize, behind: usize },
    /// Local and remote are in sync.
    InSync,
    /// Remote is ahead of local (must sync first).
    RemoteAhead { ahead: usize, behind: usize },
    /// Branches have diverged.
    Diverged { ahead: usize, behind: usize },
}

/// Run `git rev-list --left-right --count <remote>...<local>`.
pub fn ahead_behind(
    repo_root: &Path,
    remote_ref: &str,
    local_ref: &str,
) -> Result<(usize, usize), String> {
    let rev = format!("{}...{}", remote_ref, local_ref);
    let output = crate::services::process_util::silent_command("git")
        .args(["rev-list", "--left-right", "--count", &rev])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git rev-list：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If the remote ref does not exist yet (e.g. fresh remote), the local
        // branch is entirely ahead of an empty remote.
        if stderr.contains("unknown revision") || stderr.contains("not in the working tree") {
            let local_commits = local_commit_count(repo_root, local_ref)?;
            return Ok((local_commits, 0));
        }
        return Err(format!("GIT_FETCH_FAILED: 无法比较分支：{}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = stdout.split_whitespace().collect();
    if parts.len() != 2 {
        return Err("GIT_FETCH_FAILED: 无法解析分支比较结果".to_string());
    }

    let ahead = parts[1]
        .parse::<usize>()
        .map_err(|_| "GIT_FETCH_FAILED: 无法解析 ahead".to_string())?;
    let behind = parts[0]
        .parse::<usize>()
        .map_err(|_| "GIT_FETCH_FAILED: 无法解析 behind".to_string())?;
    Ok((ahead, behind))
}

/// Count commits reachable from a local ref (for the empty-remote case).
fn local_commit_count(repo_root: &Path, local_ref: &str) -> Result<usize, String> {
    let output = crate::services::process_util::silent_command("git")
        .args(["rev-list", "--count", local_ref])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git rev-list：{}", e))?;
    if !output.status.success() {
        return Ok(0);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    stdout
        .parse::<usize>()
        .map_err(|_| "无法解析本地提交数".to_string())
}

/// Compute the sync state between local and remote.
pub fn sync_state(repo_root: &Path, remote_name: &str, branch: &str) -> Result<SyncState, String> {
    let remote_ref = format!("{}/{}", remote_name, branch);
    let (ahead, behind) = ahead_behind(repo_root, &remote_ref, branch)?;

    if ahead > 0 && behind == 0 {
        Ok(SyncState::Ahead { ahead, behind })
    } else if ahead == 0 && behind == 0 {
        Ok(SyncState::InSync)
    } else if ahead == 0 && behind > 0 {
        Ok(SyncState::RemoteAhead { ahead, behind })
    } else {
        Ok(SyncState::Diverged { ahead, behind })
    }
}

/// Validate that the repository is safe to push for the given commit.
pub fn verify_push_eligible(
    repo_root: &Path,
    expected_head: &str,
    branch: &str,
) -> Result<(), String> {
    // No merge/rebase/cherry-pick/bisect in progress.
    verify_no_operation_in_progress(repo_root)?;

    // Not detached HEAD.
    let current = current_branch(repo_root)?
        .ok_or("GIT_DETACHED_HEAD: 当前处于分离 HEAD 状态，无法推送。")?;
    if current != branch {
        return Err(format!(
            "GIT_BRANCH_MISMATCH: 当前分支 {} 不是要推送的分支 {}。",
            current, branch
        ));
    }

    // Branch must be the publish branch.
    if branch != PUBLISH_BRANCH {
        return Err(format!(
            "GIT_BRANCH_MISMATCH: 仅允许推送 {} 分支，当前为 {}。",
            PUBLISH_BRANCH, branch
        ));
    }

    // HEAD must still be the commit we created.
    let head = resolve_head(repo_root)?;
    if head != expected_head {
        return Err(format!(
            "GIT_HEAD_CHANGED: HEAD 已从 {} 变为 {}，请重新检查。",
            expected_head, head
        ));
    }

    Ok(())
}

/// Check that untracked files exist (informational, never blocks).
pub fn untracked_file_count(repo_root: &Path) -> Result<usize, String> {
    let output = crate::services::process_util::silent_command("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git status：{}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter(|line| line.starts_with("?? "))
        .count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn init_repo(dir: &Path) {
        crate::services::process_util::silent_command("git")
            .args(["init"])
            .current_dir(dir)
            .output()
            .unwrap();
        crate::services::process_util::silent_command("git")
            .args(["config", "user.email", "test@test.invalid"])
            .current_dir(dir)
            .output()
            .unwrap();
        crate::services::process_util::silent_command("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    fn commit_file(dir: &Path, name: &str, content: &str, msg: &str) -> String {
        fs::write(dir.join(name), content).unwrap();
        crate::services::process_util::silent_command("git")
            .args(["add", name])
            .current_dir(dir)
            .output()
            .unwrap();
        let out = crate::services::process_util::silent_command("git")
            .args(["commit", "-m", msg])
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(out.status.success());
        let head = crate::services::process_util::silent_command("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8_lossy(&head.stdout).trim().to_string()
    }

    /// Set up a bare remote and add it as `origin`.
    fn setup_remote(dir: &Path, remote_dir: &Path) {
        crate::services::process_util::silent_command("git")
            .args(["init", "--bare"])
            .current_dir(remote_dir)
            .output()
            .unwrap();
        crate::services::process_util::silent_command("git")
            .args(["remote", "add", "origin", remote_dir.to_str().unwrap()])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    #[test]
    fn head_mismatch_rejected() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let head = commit_file(dir.path(), "a.md", "a", "a");
        let err = verify_push_eligible(
            dir.path(),
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            "master",
        )
        .unwrap_err();
        assert!(err.contains("GIT_HEAD_CHANGED"));
        assert!(verify_push_eligible(dir.path(), &head, "master").is_ok());
    }

    #[test]
    fn non_master_branch_rejected() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let head = commit_file(dir.path(), "a.md", "a", "a");
        let err = verify_push_eligible(dir.path(), &head, "dev").unwrap_err();
        assert!(err.contains("GIT_BRANCH_MISMATCH"));
    }

    #[test]
    fn ahead_remote_allowed() {
        let dir = tempdir().unwrap();
        let remote = tempdir().unwrap();
        init_repo(dir.path());
        setup_remote(dir.path(), remote.path());
        let head = commit_file(dir.path(), "a.md", "a", "a");
        crate::services::process_util::silent_command("git")
            .args(["push", "origin", "HEAD:refs/heads/master"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        // Commit another local change so local is ahead.
        commit_file(dir.path(), "b.md", "b", "b");
        let state = sync_state(dir.path(), "origin", "master").unwrap();
        assert!(matches!(
            state,
            SyncState::Ahead {
                ahead: 1,
                behind: 0
            }
        ));
        let _ = head;
    }

    #[test]
    fn remote_ahead_blocks() {
        let dir = tempdir().unwrap();
        let remote = tempdir().unwrap();
        init_repo(dir.path());
        setup_remote(dir.path(), remote.path());
        commit_file(dir.path(), "a.md", "a", "a");
        crate::services::process_util::silent_command("git")
            .args(["push", "origin", "HEAD:refs/heads/master"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        // Make a commit in the remote via a second clone.
        let clone_dir = tempdir().unwrap();
        crate::services::process_util::silent_command("git")
            .args([
                "clone",
                remote.path().to_str().unwrap(),
                clone_dir.path().to_str().unwrap(),
            ])
            .current_dir(dir.path())
            .output()
            .unwrap();
        // A fresh clone does not inherit the working repo's git identity; without
        // it the `git commit` below fails on runners that have no global config.
        crate::services::process_util::silent_command("git")
            .args(["config", "user.email", "test@test.invalid"])
            .current_dir(clone_dir.path())
            .output()
            .unwrap();
        crate::services::process_util::silent_command("git")
            .args(["config", "user.name", "Test"])
            .current_dir(clone_dir.path())
            .output()
            .unwrap();
        fs::write(clone_dir.path().join("remote.md"), "remote change").unwrap();
        crate::services::process_util::silent_command("git")
            .args(["add", "remote.md"])
            .current_dir(clone_dir.path())
            .output()
            .unwrap();
        crate::services::process_util::silent_command("git")
            .args(["commit", "-m", "remote commit"])
            .current_dir(clone_dir.path())
            .output()
            .unwrap();
        crate::services::process_util::silent_command("git")
            .args(["push", "origin", "HEAD:refs/heads/master"])
            .current_dir(clone_dir.path())
            .output()
            .unwrap();

        // Fetch to update origin/master tracking ref.
        crate::services::process_util::silent_command("git")
            .args(["fetch", "origin"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let state = sync_state(dir.path(), "origin", "master").unwrap();
        assert!(
            matches!(state, SyncState::RemoteAhead { .. }),
            "expected remote ahead, got {:?}",
            state
        );
    }

    #[test]
    fn untracked_count_ignores_commits() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        commit_file(dir.path(), "a.md", "a", "a");
        fs::write(dir.path().join("private.md"), "private content").unwrap();
        assert_eq!(untracked_file_count(dir.path()).unwrap(), 1);
    }
}
