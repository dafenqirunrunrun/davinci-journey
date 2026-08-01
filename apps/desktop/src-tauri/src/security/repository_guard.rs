use std::path::{Path, PathBuf};
use std::process::Command;

/// Snapshot of the git repository state before any publish operation.
#[derive(Debug, Clone)]
pub struct GitRepositoryStatus {
    pub repository_root: PathBuf,
    pub branch: Option<String>,
    pub head: String,
    pub detached_head: bool,
    pub merge_in_progress: bool,
    pub rebase_in_progress: bool,
    pub cherry_pick_in_progress: bool,
    pub bisect_in_progress: bool,
    /// Files with tracked changes (unstaged modifications, staged changes).
    pub tracked_changes: Vec<GitChange>,
    /// Untracked files (names only, no content).
    pub untracked_files: Vec<String>,
}

/// A single git change entry (parsed from `git status --porcelain`).
#[derive(Debug, Clone)]
pub struct GitChange {
    pub staged: String,
    pub unstaged: String,
    pub path: String,
}

/// Check that `dir` is inside a git repository and return its root.
pub fn find_repository_root(dir: &Path) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("无法执行 Git 命令：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("当前目录不在 Git 仓库中：{}", stderr.trim()));
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(PathBuf::from(root))
}

/// Check git lock file existence.
pub fn has_git_lock(repo_root: &Path) -> bool {
    repo_root.join(".git").join("index.lock").exists()
}

/// Run `git rev-parse HEAD` and return the full SHA.
pub fn resolve_head(repo_root: &Path) -> Result<String, String> {
    run_git(repo_root, &["rev-parse", "HEAD"])
}

/// Run `git rev-parse --abbrev-ref HEAD` to get the branch name.
/// Returns None if HEAD is detached.
pub fn current_branch(repo_root: &Path) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("无法获取当前分支：{}", e))?;

    if !output.status.success() {
        return Err("无法解析当前分支".to_string());
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch == "HEAD" {
        Ok(None) // detached
    } else {
        Ok(Some(branch))
    }
}

/// Check if a git operation is in progress by looking for specific marker files.
pub fn check_operations_in_progress(repo_root: &Path) -> (bool, bool, bool, bool) {
    let git_dir = repo_root.join(".git");
    let merge = git_dir.join("MERGE_HEAD").exists();
    let rebase = git_dir.join("REBASE_HEAD").exists()
        || git_dir.join("rebase-apply").exists()
        || git_dir.join("rebase-merge").exists();
    let cherry_pick = git_dir.join("CHERRY_PICK_HEAD").exists();
    let bisect = git_dir.join("BISECT_LOG").exists();
    (merge, rebase, cherry_pick, bisect)
}

/// Run `git status --porcelain` and parse the output.
pub fn parse_status(repo_root: &Path) -> Result<(Vec<GitChange>, Vec<String>), String> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("Git status 执行失败：{}", e))?;

    if !output.status.success() {
        return Err("Git status 执行失败".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes = Vec::new();
    let mut untracked = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let staged = &line[..1];
        let unstaged = &line[1..2];
        let path = &line[3..];
        if is_publish_workspace_status_path(path) {
            continue;
        }

        if staged == "?" && unstaged == "?" {
            untracked.push(path.to_string());
        } else {
            changes.push(GitChange {
                staged: staged.to_string(),
                unstaged: unstaged.to_string(),
                path: path.to_string(),
            });
        }
    }

    Ok((changes, untracked))
}

fn is_publish_workspace_status_path(path: &str) -> bool {
    let normalized = path.trim_matches('"').replace('\\', "/");
    normalized == ".publish-workspaces" || normalized.starts_with(".publish-workspaces/")
}

/// Gather the full repository status.
pub fn inspect_repository(repo_root: &Path) -> Result<GitRepositoryStatus, String> {
    let root = find_repository_root(repo_root)?;
    let head = resolve_head(&root)?;
    let branch = current_branch(&root)?;
    let detached = branch.is_none();
    let (merge, rebase, cherry, bisect) = check_operations_in_progress(&root);
    let (changes, untracked) = parse_status(&root)?;

    Ok(GitRepositoryStatus {
        repository_root: root,
        branch,
        head,
        detached_head: detached,
        merge_in_progress: merge,
        rebase_in_progress: rebase,
        cherry_pick_in_progress: cherry,
        bisect_in_progress: bisect,
        tracked_changes: changes,
        untracked_files: untracked,
    })
}

/// Resolve the repository root from a starting directory, returning a structured result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRootResult {
    pub repository_root: String,
    pub display_path: String,
    pub branch: Option<String>,
    pub head: String,
    pub valid: bool,
    pub message: Option<String>,
    pub errors: Vec<String>,
}

/// Resolve and validate a repository root from a candidate path.
/// Returns a structured result suitable for IPC.
pub fn resolve_repository_root(candidate: &str) -> RepositoryRootResult {
    let path = PathBuf::from(candidate);

    if candidate.trim().is_empty() {
        return RepositoryRootResult {
            repository_root: String::new(),
            display_path: String::new(),
            branch: None,
            head: String::new(),
            valid: false,
            message: Some(
                "未指定目标网站仓库。请选择“达芬奇的奇妙之旅”所在的 Git 仓库。".to_string(),
            ),
            errors: vec!["未指定目标网站仓库。".to_string()],
        };
    }

    if !path.exists() {
        return RepositoryRootResult {
            repository_root: candidate.to_string(),
            display_path: candidate.to_string(),
            branch: None,
            head: String::new(),
            valid: false,
            message: Some(format!("目录不存在：{}", candidate)),
            errors: vec![format!("目录不存在：{}", candidate)],
        };
    }

    if !path.is_dir() {
        return RepositoryRootResult {
            repository_root: candidate.to_string(),
            display_path: candidate.to_string(),
            branch: None,
            head: String::new(),
            valid: false,
            message: Some(format!("路径不是目录：{}", candidate)),
            errors: vec![format!("路径不是目录：{}", candidate)],
        };
    }

    match find_repository_root(&path) {
        Ok(root) => {
            let branch = current_branch(&root).ok().flatten();
            let head = resolve_head(&root).unwrap_or_default();
            let root_display = root.to_string_lossy().replace('\\', "/");
            RepositoryRootResult {
                repository_root: root_display.clone(),
                display_path: root_display,
                branch,
                head,
                valid: true,
                message: None,
                errors: Vec::new(),
            }
        }
        Err(e) => RepositoryRootResult {
            repository_root: candidate.to_string(),
            display_path: candidate.to_string(),
            branch: None,
            head: String::new(),
            valid: false,
            message: Some(e),
            errors: vec!["目录不是有效的 Git 仓库。".to_string()],
        },
    }
}

/// Validate that the selected directory is the target website repository root.
pub fn validate_repository_root(candidate: &str) -> RepositoryRootResult {
    let mut result = resolve_repository_root(candidate);
    if !result.valid {
        return result;
    }

    let root = PathBuf::from(&result.repository_root);
    let mut errors = Vec::new();
    if !root.join(".git").exists() {
        errors.push("目标目录必须是 Git 仓库根目录，并包含 .git。".to_string());
    }
    if !root.join("content").is_dir() {
        errors.push("目标仓库缺少 content/ 目录。".to_string());
    }
    if !root.join("public").join("assets").join("notes").is_dir() {
        errors.push("目标仓库缺少 public/assets/notes/ 目录。".to_string());
    }
    if !root.join("config").join("archive-profiles.yml").is_file() {
        errors.push("目标仓库缺少 config/archive-profiles.yml。".to_string());
    }

    if !errors.is_empty() {
        result.valid = false;
        result.message = Some("目标网站仓库结构不完整，请选择正确的仓库根目录。".to_string());
        result.errors = errors;
    }
    result
}

/// Check that HEAD has not changed since we last inspected. Used before commit.
pub fn verify_head_unchanged(repo_root: &Path, expected_head: &str) -> Result<(), String> {
    let current = resolve_head(repo_root)?;
    if current != expected_head {
        return Err(format!(
            "HEAD 已发生变化：期望 {}，实际 {}。请重新检查仓库状态。",
            expected_head, current
        ));
    }
    Ok(())
}

/// Check that no merge/rebase/bisect is in progress.
pub fn verify_no_operation_in_progress(repo_root: &Path) -> Result<(), String> {
    let (merge, rebase, cherry, bisect) = check_operations_in_progress(repo_root);
    if merge {
        return Err("正在进行 Git Merge，请先完成或取消合并。".to_string());
    }
    if rebase {
        return Err("正在进行 Git Rebase，请先完成或取消变基。".to_string());
    }
    if cherry {
        return Err("正在进行 Git Cherry-pick，请先完成或取消。".to_string());
    }
    if bisect {
        return Err("正在进行 Git Bisect，请先结束二分查找。".to_string());
    }
    Ok(())
}

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

    fn init_target_repo(dir: &Path) {
        init_repo(dir);
        fs::create_dir_all(dir.join("content")).unwrap();
        fs::create_dir_all(dir.join("public").join("assets").join("notes")).unwrap();
        fs::create_dir_all(dir.join("config")).unwrap();
        fs::write(
            dir.join("config/archive-profiles.yml"),
            "archiveProfiles: []\n",
        )
        .unwrap();
        fs::write(dir.join("README.md"), "# Target").unwrap();
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

    #[test]
    fn finds_repo_root() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let root = find_repository_root(dir.path()).unwrap();
        // On Windows, canonicalize adds \\?\ prefix, but git returns normal paths.
        // Just check the path exists and ends with the same directory name.
        let dir_name = dir.path().file_name().unwrap();
        assert!(
            root.to_string_lossy()
                .contains(dir_name.to_string_lossy().as_ref()),
            "Expected root {} to contain {}",
            root.display(),
            dir_name.to_string_lossy()
        );
    }

    #[test]
    fn rejects_non_repo() {
        // Use a non-existent path to verify git rejects it
        let non_existent = PathBuf::from(r"\\?\C:\__non_existent_repo_test__");
        let result = find_repository_root(&non_existent);
        assert!(
            result.is_err(),
            "Expected error for non-repo path, got: {:?}",
            result
        );
    }

    #[test]
    fn detects_lock() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        assert!(!has_git_lock(dir.path()));
    }

    #[test]
    fn parses_empty_status() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let (changes, untracked) = parse_status(dir.path()).unwrap();
        assert!(changes.is_empty());
        assert!(untracked.is_empty());
    }

    #[test]
    fn ignores_publish_workspaces_status() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        fs::create_dir_all(dir.path().join(".publish-workspaces").join("workspace-1")).unwrap();
        fs::write(
            dir.path()
                .join(".publish-workspaces")
                .join("workspace-1")
                .join("manifest.json"),
            "{}",
        )
        .unwrap();

        let (changes, untracked) = parse_status(dir.path()).unwrap();

        assert!(changes.is_empty());
        assert!(untracked.is_empty());
    }

    #[test]
    fn detects_branch() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        // Create a commit first so branch resolves
        std::fs::write(dir.path().join("test.md"), "# test").unwrap();
        std::process::Command::new("git")
            .args(["add", "test.md"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let branch = current_branch(dir.path()).unwrap();
        assert!(branch.is_some(), "Expected branch to exist after commit");
    }

    #[test]
    fn validates_explicit_target_repository_structure() {
        let dir = tempdir().unwrap();
        init_target_repo(dir.path());
        let result = validate_repository_root(&dir.path().to_string_lossy());
        assert!(result.valid);
        assert!(result.errors.is_empty());
        assert!(result
            .display_path
            .contains(dir.path().file_name().unwrap().to_string_lossy().as_ref()));
    }

    #[test]
    fn rejects_target_without_required_content_structure() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let result = validate_repository_root(&dir.path().to_string_lossy());
        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| error.contains("content/")));
    }

    #[test]
    fn head_is_available() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        // initial repo has no commits yet, so HEAD may not resolve
        // let's create a commit first
        fs::write(dir.path().join("readme.md"), "# test").unwrap();
        Command::new("git")
            .args(["add", "readme.md"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let head = resolve_head(dir.path()).unwrap();
        assert_eq!(head.len(), 40);
    }
}
