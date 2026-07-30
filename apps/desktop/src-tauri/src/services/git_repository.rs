use crate::security::git_pathspec::{build_pathspec_args, validate_pathspecs, SafePathspec};
use std::path::Path;
use std::process::Command;

/// Run a git command with the given args in the repository root.
/// Returns stdout on success, or a descriptive error on failure.
fn run_git(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Git 命令执行失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git 命令失败：{}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run a git command with pathspec arguments.
fn run_git_with_pathspecs(
    repo_root: &Path,
    args: &[&str],
    pathspecs: &[SafePathspec],
) -> Result<String, String> {
    let mut full_args = args.to_vec();
    let pathspec_args = build_pathspec_args(pathspecs);
    for pa in &pathspec_args {
        full_args.push(pa.as_str());
    }

    let output = Command::new("git")
        .args(&full_args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Git 命令执行失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git 命令失败：{}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get the diff for specific files (unstaged changes).
pub fn get_diff(repo_root: &Path, paths: &[String]) -> Result<String, String> {
    let validated = validate_pathspecs(paths)?;
    run_git_with_pathspecs(repo_root, &["diff"], &validated)
}

/// Get the staged diff for specific files.
pub fn get_staged_diff(repo_root: &Path, paths: &[String]) -> Result<String, String> {
    let validated = validate_pathspecs(paths)?;
    run_git_with_pathspecs(repo_root, &["diff", "--cached"], &validated)
}

/// Show the diff for a new file (compare to /dev/null).
pub fn get_new_file_diff(repo_root: &Path, path: &str) -> Result<String, String> {
    let safe = validate_pathspecs(&[path.to_string()])?;
    // For new files, use git diff --no-index /dev/null <path>
    let full_path = repo_root.join(&safe[0].relative_path);
    let full_path_str = full_path.to_string_lossy().replace('\\', "/");

    let output = Command::new("git")
        .args(["diff", "--no-index", "/dev/null", &full_path_str])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Git diff 执行失败：{}", e))?;

    // git diff --no-index returns exit code 1 when there IS a difference
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Stage specific files. Uses explicit paths only — never `git add .` or `git add -A`.
pub fn stage_files(repo_root: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有指定要暂存的文件".to_string());
    }
    let validated = validate_pathspecs(paths)?;

    let mut args = vec!["add", "--"];
    let paths_args: Vec<&str> = validated.iter().map(|p| p.relative_path.as_str()).collect();
    args.extend(paths_args);

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Git add 执行失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git add 失败：{}", stderr.trim()));
    }

    Ok(())
}

/// Get the list of staged files.
pub fn staged_files(repo_root: &Path) -> Result<Vec<String>, String> {
    let output = run_git(repo_root, &["diff", "--cached", "--name-only"])?;
    if output.is_empty() {
        return Ok(Vec::new());
    }
    Ok(output.lines().map(|s| s.to_string()).collect())
}

/// Verify that only the expected files are staged.
pub fn verify_staged_files(repo_root: &Path, expected_paths: &[String]) -> Result<(), String> {
    let staged = staged_files(repo_root)?;

    let expected_set: std::collections::HashSet<&str> =
        expected_paths.iter().map(|s| s.as_str()).collect();
    let staged_set: std::collections::HashSet<&str> = staged.iter().map(|s| s.as_str()).collect();

    // Check for files in staged that are not expected
    let extra: Vec<String> = staged_set
        .difference(&expected_set)
        .map(|s| (*s).to_string())
        .collect();
    if !extra.is_empty() {
        return Err(format!(
            "暂存区包含非本次事务的文件：{}。请先处理已有暂存内容。",
            extra.join(", ")
        ));
    }

    // Check for expected files not in staged
    let missing: Vec<String> = expected_set
        .difference(&staged_set)
        .map(|s| (*s).to_string())
        .collect();
    if !missing.is_empty() {
        return Err(format!("以下文件尚未暂存：{}", missing.join(", ")));
    }

    Ok(())
}

/// Commit the staged changes with a validated message.
pub fn commit(repo_root: &Path, message: &str, paths: &[String]) -> Result<CommitResult, String> {
    // Validate the message
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Commit message 不能为空".to_string());
    }
    if trimmed.len() > 200 {
        return Err("Commit message 长度不能超过 200 个字符".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("Commit message 不能包含换行符".to_string());
    }

    let validated = validate_pathspecs(paths)?;

    // Build command: git commit -m <message> -- <pathspecs>
    let mut args = vec!["commit", "-m", trimmed];
    args.push("--");
    for p in &validated {
        args.push(p.relative_path.as_str());
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Git commit 执行失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git commit 失败：{}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // Parse commit hash from output
    let commit_hash_str = parse_commit_hash(&stdout).unwrap_or_default();
    let short_hash = if commit_hash_str.len() >= 7 {
        commit_hash_str[..7].to_string()
    } else if !commit_hash_str.is_empty() {
        commit_hash_str.clone()
    } else {
        "unknown".to_string()
    };

    Ok(CommitResult {
        commit_hash: commit_hash_str,
        short_hash,
        branch: crate::security::repository_guard::current_branch(repo_root)?
            .unwrap_or_else(|| "HEAD".to_string()),
        message: trimmed.to_string(),
        committed_files: paths.to_vec(),
    })
}

/// Result of a successful commit.
#[derive(Debug, Clone)]
pub struct CommitResult {
    pub commit_hash: String,
    pub short_hash: String,
    pub branch: String,
    pub message: String,
    pub committed_files: Vec<String>,
}

/// Parse commit hash from `git commit` output like:
/// "[master (root-commit) abc1234] message"
/// "[master abc1234] message"
fn parse_commit_hash(git_output: &str) -> Option<String> {
    // Look for pattern: "] " followed by a line, where the hash is before "]"
    for line in git_output.lines() {
        // Pattern: [branch (optional) hash] message
        if let Some(start) = line.find('[') {
            let rest = &line[start + 1..];
            if let Some(end) = rest.find(']') {
                let inner = &rest[..end];
                // inner = "branch hash" or "branch (root-commit) hash"
                let parts: Vec<&str> = inner.split_whitespace().collect();
                // The hash is the last part before ']'
                if let Some(&hash) = parts.last() {
                    if hash.len() >= 7 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Some(hash.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Check whether the working tree has unstaged changes to specific files.
pub fn has_uncommitted_changes(repo_root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let validated = validate_pathspecs(paths)?;
    let diff = run_git_with_pathspecs(repo_root, &["diff"], &validated)?;
    let staged_diff = run_git_with_pathspecs(repo_root, &["diff", "--cached"], &validated)?;

    let mut changed = Vec::new();
    if !diff.is_empty() || !staged_diff.is_empty() {
        // Determine which files have changes
        for p in paths {
            #[allow(clippy::cloned_ref_to_slice_refs)]
            let ps = &[p.clone()];
            let file_diff = run_git_with_pathspecs(
                repo_root,
                &["diff", "--name-only"],
                &validate_pathspecs(ps)?,
            )?;
            let file_staged = run_git_with_pathspecs(
                repo_root,
                &["diff", "--cached", "--name-only"],
                &validate_pathspecs(ps)?,
            )?;
            if !file_diff.is_empty() || !file_staged.is_empty() {
                changed.push(p.clone());
            }
        }
    }
    Ok(changed)
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
            .args(["config", "user.email", "test@test.com"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    fn init_commit(dir: &Path) {
        fs::write(dir.join("README.md"), "# repo").unwrap();
        stage_files(dir, &["README.md".to_string()]).unwrap();
        commit(dir, "initial commit", &["README.md".to_string()]).unwrap();
    }

    #[test]
    fn stages_and_commits_files() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());

        // Create initial commit
        init_commit(dir.path());

        // Create a new file
        fs::create_dir_all(dir.path().join("content")).unwrap();
        fs::write(dir.path().join("content/note.md"), "# Note").unwrap();

        // Stage it
        stage_files(dir.path(), &["content/note.md".to_string()]).unwrap();

        // Verify staged
        let staged = staged_files(dir.path()).unwrap();
        assert!(staged.contains(&"content/note.md".to_string()));

        // Commit
        let result = commit(
            dir.path(),
            "docs(test): add test note",
            &["content/note.md".to_string()],
        )
        .unwrap();
        assert!(!result.commit_hash.is_empty());
        assert_eq!(result.message, "docs(test): add test note");
    }

    #[test]
    fn rejects_empty_commit_message() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        assert!(commit(dir.path(), "", &["README.md".to_string()]).is_err());
    }

    #[test]
    fn parses_commit_hash() {
        let output = "[master (root-commit) abc1234def5678] initial commit\n 1 file changed\n";
        assert_eq!(
            parse_commit_hash(output),
            Some("abc1234def5678".to_string())
        );

        let output2 = "[master abc1234def5678] second commit\n";
        assert_eq!(
            parse_commit_hash(output2),
            Some("abc1234def5678".to_string())
        );
    }

    #[test]
    fn rejects_add_dot() {
        // This test verifies that stage_files with paths like "." are rejected
        // since "." doesn't match the explicit path rules
        assert!(validate_pathspecs(&[".".to_string()]).is_err());
        assert!(validate_pathspecs(&["-A".to_string()]).is_err());
        assert!(validate_pathspecs(&["--all".to_string()]).is_err());
    }

    #[test]
    fn gets_diff_for_new_file() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        init_commit(dir.path());

        fs::create_dir_all(dir.path().join("content")).unwrap();
        fs::write(dir.path().join("content/new.md"), "# New").unwrap();

        let diff = get_new_file_diff(dir.path(), "content/new.md").unwrap();
        assert!(diff.contains("# New"));
    }

    #[test]
    fn detects_uncommitted_changes() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        init_commit(dir.path());

        fs::write(dir.path().join("README.md"), "# modified").unwrap();
        let changed = has_uncommitted_changes(dir.path(), &["README.md".to_string()]).unwrap();
        assert!(changed.contains(&"README.md".to_string()));
    }
}
