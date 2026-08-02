//! Git remote operations for publishing: fetch, push, and remote-ref checks.
//!
//! All commands use explicit argument arrays (`std::process::Command`), never
//! shell-string concatenation, and never force flags.

use std::path::Path;
use std::process::Command;

fn run_git(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git 命令：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Fetch the remote branch so `origin/master` tracking ref is up to date.
pub fn fetch_remote(repo_root: &Path, remote_name: &str, branch: &str) -> Result<(), String> {
    // git fetch <remote> <branch>
    let output = Command::new("git")
        .args(["fetch", remote_name, branch])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git fetch：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "GIT_FETCH_FAILED: 无法同步远程分支：{}",
            stderr.trim()
        ));
    }
    Ok(())
}

/// Push the current branch to the remote without force flags.
/// `expected_head` is verified before pushing to guard against races.
pub fn push_publish(
    repo_root: &Path,
    remote_name: &str,
    branch: &str,
    expected_head: &str,
) -> Result<PushOutcome, String> {
    // Re-verify HEAD before pushing.
    let head = crate::security::repository_guard::resolve_head(repo_root)?;
    if head != expected_head {
        return Err(format!(
            "GIT_HEAD_CHANGED: 推送前 HEAD 已变化（期望 {}，实际 {}）。",
            expected_head, head
        ));
    }

    // git push <remote> HEAD:refs/heads/<branch>
    let refspec = format!("HEAD:refs/heads/{}", branch);
    let output = Command::new("git")
        .args(["push", remote_name, &refspec])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git push：{}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        // Never leak credentials; sanitize any URL-like token fragments.
        let message = sanitize_log(&format!("GIT_PUSH_FAILED: 推送失败：{}", stderr.trim()));
        return Err(message);
    }

    Ok(PushOutcome {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: sanitize_log(&stdout),
        stderr: sanitize_log(&stderr),
        local_head_before: expected_head.to_string(),
    })
}

/// Result of a push operation (non-sensitive fields only).
#[derive(Debug, Clone)]
pub struct PushOutcome {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub local_head_before: String,
}

/// Read the remote branch head via `git ls-remote <remote> refs/heads/<branch>`.
pub fn ls_remote_head(
    repo_root: &Path,
    remote_name: &str,
    branch: &str,
) -> Result<Option<String>, String> {
    let refspec = format!("refs/heads/{}", branch);
    let output = run_git(repo_root, &["ls-remote", remote_name, &refspec])?;

    if output.is_empty() {
        return Ok(None);
    }

    // Output is "<sha>\t<ref>"
    let first = output.lines().next().unwrap_or("");
    let sha = first.split_whitespace().next().unwrap_or("").to_string();
    if sha.is_empty() {
        return Ok(None);
    }
    Ok(Some(sha))
}

/// Verify the remote head matches an expected commit hash.
pub fn verify_remote_commit(
    repo_root: &Path,
    remote_name: &str,
    branch: &str,
    expected_commit: &str,
) -> Result<bool, String> {
    let remote_head = ls_remote_head(repo_root, remote_name, branch)?;
    match remote_head {
        Some(sha) => Ok(sha == expected_commit),
        None => Err(format!(
            "GIT_REMOTE_VERIFY_FAILED: 远程分支 {} 上找不到提交。",
            branch
        )),
    }
}

/// Strip anything that looks like a credential from log output.
fn sanitize_log(text: &str) -> String {
    // Redact URLs that contain credentials (https://user:pass@...).
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        let pos_https = rest.find("https://");
        let pos_http = rest.find("http://");

        let (pos, scheme) = match (pos_https, pos_http) {
            (Some(h), Some(o)) if h <= o => (h, "https://"),
            (Some(h), Some(_)) => (h, "https://"),
            (Some(h), None) => (h, "https://"),
            (None, Some(o)) => (o, "http://"),
            (None, None) => {
                out.push_str(rest);
                break;
            }
        };

        out.push_str(&rest[..pos]);
        out.push_str(scheme);
        rest = &rest[pos + scheme.len()..];
        if let Some(at) = rest.find('@') {
            out.push_str("***");
            rest = &rest[at..]; // keep the '@'
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn init_repo(dir: &Path) {
        Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.invalid"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    fn commit_file(dir: &Path, name: &str, content: &str, msg: &str) -> String {
        fs::write(dir.join(name), content).unwrap();
        Command::new("git")
            .args(["add", name])
            .current_dir(dir)
            .output()
            .unwrap();
        let out = Command::new("git")
            .args(["commit", "-m", msg])
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(out.status.success());
        let head = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8_lossy(&head.stdout).trim().to_string()
    }

    #[test]
    fn push_to_bare_remote_and_verify() {
        let dir = tempdir().unwrap();
        let remote = tempdir().unwrap();
        init_repo(dir.path());
        Command::new("git")
            .args(["init", "--bare"])
            .current_dir(remote.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["remote", "add", "origin", remote.path().to_str().unwrap()])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let head = commit_file(dir.path(), "a.md", "a", "a");
        push_publish(dir.path(), "origin", "master", &head).unwrap();

        // Verify remote contains the commit.
        assert!(verify_remote_commit(dir.path(), "origin", "master", &head).unwrap());
    }

    #[test]
    fn push_rejects_head_change() {
        let dir = tempdir().unwrap();
        let remote = tempdir().unwrap();
        init_repo(dir.path());
        Command::new("git")
            .args(["init", "--bare"])
            .current_dir(remote.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["remote", "add", "origin", remote.path().to_str().unwrap()])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let head = commit_file(dir.path(), "a.md", "a", "a");
        // Add another commit so HEAD differs from `head`.
        commit_file(dir.path(), "b.md", "b", "b");
        let err = push_publish(dir.path(), "origin", "master", &head).unwrap_err();
        assert!(err.contains("GIT_HEAD_CHANGED"));
    }

    #[test]
    fn sanitizes_credentials() {
        let msg = sanitize_log("https://user:secret@github.com/foo/bar.git rejected");
        assert!(!msg.contains("secret"));
        assert!(msg.contains("https://***@github.com"));
    }
}
