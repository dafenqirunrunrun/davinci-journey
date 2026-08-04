//! Remote repository validation for publishing.
//!
//! Only the project's own remote is allowed as a push target.

use std::path::Path;

/// The expected GitHub owner/repo for the project's public remote.
pub const EXPECTED_REPO_OWNER: &str = "dafenqirunrunrun";
pub const EXPECTED_REPO_NAME: &str = "davinci-journey";

/// Normalized view of a validated remote.
#[derive(Debug, Clone)]
pub struct ValidatedRemote {
    pub name: String,
    pub url: String,
    pub owner: String,
    pub repo: String,
}

/// Result of checking a remote URL.
#[derive(Debug, Clone)]
pub enum RemoteCheck {
    /// The remote is the expected project remote.
    Match(ValidatedRemote),
    /// The remote exists but points to a different repository.
    Mismatch { url: String },
    /// The remote does not exist.
    NotFound,
}

/// Get a remote URL from the repository.
pub fn get_remote_url(repo_root: &Path, remote_name: &str) -> Result<String, String> {
    let output = crate::services::process_util::silent_command("git")
        .args(["remote", "get-url", remote_name])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法执行 Git 命令：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("unknown")
            || stderr.to_lowercase().contains("does not appear")
        {
            return Err(format!(
                "GIT_REMOTE_NOT_FOUND: 远程 {} 不存在。",
                remote_name
            ));
        }
        return Err(format!(
            "GIT_REMOTE_NOT_FOUND: 无法读取远程 {}：{}",
            remote_name,
            stderr.trim()
        ));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if url.is_empty() {
        return Err(format!(
            "GIT_REMOTE_NOT_FOUND: 远程 {} 没有配置地址。",
            remote_name
        ));
    }
    Ok(url)
}

/// Parse a GitHub HTTPS or SSH URL into owner/repo.
fn parse_github_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches('/');
    // https://github.com/owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() >= 2 {
            let repo = parts[1].trim_end_matches(".git").to_string();
            return Some((parts[0].to_string(), repo));
        }
    }
    // git@github.com:owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() >= 2 {
            let repo = parts[1].trim_end_matches(".git").to_string();
            return Some((parts[0].to_string(), repo));
        }
    }
    // ssh://git@github.com/owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("ssh://git@github.com/") {
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() >= 2 {
            let repo = parts[1].trim_end_matches(".git").to_string();
            return Some((parts[0].to_string(), repo));
        }
    }
    None
}

/// Validate a remote against the expected project repository.
pub fn validate_remote(repo_root: &Path, remote_name: &str) -> Result<ValidatedRemote, String> {
    let url = get_remote_url(repo_root, remote_name)?;

    let Some((owner, repo)) = parse_github_url(&url) else {
        return Err(format!(
            "GIT_REMOTE_URL_UNSAFE: 远程地址无法识别为 GitHub 仓库：{}",
            url
        ));
    };

    if owner != EXPECTED_REPO_OWNER || repo != EXPECTED_REPO_NAME {
        return Err(format!(
            "GIT_REMOTE_MISMATCH: 远程指向其他仓库 {}/{}，不是本项目的 {}",
            owner, repo, EXPECTED_REPO_NAME
        ));
    }

    Ok(ValidatedRemote {
        name: remote_name.to_string(),
        url,
        owner,
        repo,
    })
}

/// Soft check that returns an enum (for tests / informational UI).
pub fn check_remote(repo_root: &Path, remote_name: &str) -> RemoteCheck {
    match get_remote_url(repo_root, remote_name) {
        Err(e) if e.contains("GIT_REMOTE_NOT_FOUND") => RemoteCheck::NotFound,
        Err(_) => RemoteCheck::NotFound,
        Ok(url) => match parse_github_url(&url) {
            Some((owner, repo)) if owner == EXPECTED_REPO_OWNER && repo == EXPECTED_REPO_NAME => {
                RemoteCheck::Match(ValidatedRemote {
                    name: remote_name.to_string(),
                    url,
                    owner,
                    repo,
                })
            }
            _ => RemoteCheck::Mismatch { url },
        },
    }
}

/// The expected public site base URL.
pub fn public_site_base_url() -> String {
    format!(
        "https://{}.github.io/{}/",
        EXPECTED_REPO_OWNER, EXPECTED_REPO_NAME
    )
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

    #[test]
    fn parses_https_url() {
        assert_eq!(
            parse_github_url("https://github.com/dafenqirunrunrun/davinci-journey.git"),
            Some((
                "dafenqirunrunrun".to_string(),
                "davinci-journey".to_string()
            ))
        );
        assert_eq!(
            parse_github_url("https://github.com/dafenqirunrunrun/davinci-journey"),
            Some((
                "dafenqirunrunrun".to_string(),
                "davinci-journey".to_string()
            ))
        );
    }

    #[test]
    fn parses_ssh_url() {
        assert_eq!(
            parse_github_url("git@github.com:dafenqirunrunrun/davinci-journey.git"),
            Some((
                "dafenqirunrunrun".to_string(),
                "davinci-journey".to_string()
            ))
        );
        assert_eq!(
            parse_github_url("ssh://git@github.com/other/repo.git"),
            Some(("other".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn rejects_unknown_url() {
        assert_eq!(parse_github_url("https://example.com/foo/bar.git"), None);
        assert_eq!(parse_github_url("not-a-url"), None);
    }

    #[test]
    fn remote_not_found() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let check = check_remote(dir.path(), "origin");
        assert!(matches!(check, RemoteCheck::NotFound));
    }

    #[test]
    fn remote_mismatch_rejected() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        crate::services::process_util::silent_command("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/other/repo.git",
            ])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(validate_remote(dir.path(), "origin").is_err());
        let check = check_remote(dir.path(), "origin");
        assert!(matches!(check, RemoteCheck::Mismatch { .. }));
    }

    #[test]
    fn matching_remote_accepted() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        crate::services::process_util::silent_command("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/dafenqirunrunrun/davinci-journey.git",
            ])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let remote = validate_remote(dir.path(), "origin").unwrap();
        assert_eq!(remote.owner, "dafenqirunrunrun");
        assert_eq!(remote.repo, "davinci-journey");
    }

    #[test]
    fn untracked_files_do_not_block() {
        // Creating a repo with an untracked file and verifying remote is valid
        // shows untracked files never affect remote checks.
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        crate::services::process_util::silent_command("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/dafenqirunrunrun/davinci-journey.git",
            ])
            .current_dir(dir.path())
            .output()
            .unwrap();
        fs::write(dir.path().join("untracked.md"), "# private").unwrap();
        assert!(validate_remote(dir.path(), "origin").is_ok());
    }
}
