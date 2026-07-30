use std::path::Path;

/// Validated pathspec that is safe to pass to `git add` or `git diff`.
#[derive(Debug, Clone)]
pub struct SafePathspec {
    /// The validated, normalized path relative to repository root.
    pub relative_path: String,
}

/// Result of validating a pathspec candidate.
#[derive(Debug)]
pub enum PathspecValidation {
    /// The pathspec is safe to use.
    Valid(SafePathspec),
    /// The pathspec is rejected for the given reason.
    Rejected(String),
}

/// Check whether a pathspec string appears safe for use with `git add` / `git diff`.
///
/// Rules:
/// - Must not be empty
/// - Must not start with `-` (could be an option injection)
/// - Must not contain `*` or `?` or `[` glob patterns (only explicit paths)
/// - Must not contain `..` traversal
/// - Must not contain shell metacharacters
/// - Must not be an absolute path
/// - Must be within the repository root
pub fn validate_pathspec(pathspec: &str) -> PathspecValidation {
    if pathspec.trim().is_empty() {
        return PathspecValidation::Rejected("路径不能为空".to_string());
    }

    let trimmed = pathspec.trim();

    if trimmed.starts_with('-') {
        return PathspecValidation::Rejected(format!(
            "路径以 '-' 开头，可能是 Git 选项注入：{}",
            trimmed
        ));
    }

    // Reject glob patterns — we only allow explicit paths
    if trimmed.contains('*') || trimmed.contains('?') || trimmed.contains('[') {
        return PathspecValidation::Rejected(format!(
            "不允许使用通配符，请使用明确路径：{}",
            trimmed
        ));
    }

    // Reject traversal
    if trimmed.contains("..") {
        return PathspecValidation::Rejected(format!("路径包含 .. 片段：{}", trimmed));
    }

    // Reject shell metacharacters
    if trimmed.contains('|')
        || trimmed.contains(';')
        || trimmed.contains('`')
        || trimmed.contains('$')
        || trimmed.contains('(')
        || trimmed.contains(')')
        || trimmed.contains('{')
        || trimmed.contains('}')
    {
        return PathspecValidation::Rejected(format!("路径包含危险字符：{}", trimmed));
    }

    // Reject absolute paths (both with drive letter like C:\ and Unix-style /)
    let path_obj = Path::new(trimmed);
    if path_obj.is_absolute() || trimmed.starts_with('/') {
        return PathspecValidation::Rejected(format!("不允许使用绝对路径：{}", trimmed));
    }

    // Reject "." pathspec (implicit "add all")
    if trimmed == "." || trimmed == "./" || trimmed == ".\\" {
        return PathspecValidation::Rejected("不允许使用 '.' 路径，请使用明确路径。".to_string());
    }

    PathspecValidation::Valid(SafePathspec {
        relative_path: trimmed.to_string(),
    })
}

/// Validate a list of pathspecs. Returns all safe paths or the first error.
pub fn validate_pathspecs(pathspecs: &[String]) -> Result<Vec<SafePathspec>, String> {
    let mut valid = Vec::new();
    for ps in pathspecs {
        match validate_pathspec(ps) {
            PathspecValidation::Valid(safe) => valid.push(safe),
            PathspecValidation::Rejected(reason) => return Err(reason),
        }
    }
    Ok(valid)
}

/// Build the `-- <pathspec>` args for a git command from validated pathspecs.
pub fn build_pathspec_args(pathspecs: &[SafePathspec]) -> Vec<String> {
    let mut args = vec!["--".to_string()];
    args.extend(pathspecs.iter().map(|p| p.relative_path.clone()));
    args
}

/// Check that no pathspec matches `.git` directory or user protected files.
pub fn is_protected_path(pathspec: &str) -> bool {
    let lower = pathspec.to_lowercase();
    lower.starts_with(".git/")
        || lower == ".git"
        || lower.starts_with(".publish-workspaces/")
        || lower.starts_with(".publish-transactions/")
        || lower.starts_with("target/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_path_rejected() {
        assert!(matches!(
            validate_pathspec(""),
            PathspecValidation::Rejected(_)
        ));
    }

    #[test]
    fn glob_rejected() {
        assert!(matches!(
            validate_pathspec("content/*.md"),
            PathspecValidation::Rejected(_)
        ));
        assert!(matches!(
            validate_pathspec("content/**"),
            PathspecValidation::Rejected(_)
        ));
    }

    #[test]
    fn option_injection_rejected() {
        assert!(matches!(
            validate_pathspec("--help"),
            PathspecValidation::Rejected(_)
        ));
    }

    #[test]
    fn traversal_rejected() {
        assert!(matches!(
            validate_pathspec("content/../.git/config"),
            PathspecValidation::Rejected(_)
        ));
    }

    #[test]
    fn shell_meta_rejected() {
        assert!(matches!(
            validate_pathspec("content/note.md; rm -rf /"),
            PathspecValidation::Rejected(_)
        ));
    }

    #[test]
    fn absolute_rejected() {
        assert!(matches!(
            validate_pathspec("/etc/passwd"),
            PathspecValidation::Rejected(_)
        ));
    }

    #[test]
    fn valid_path_accepted() {
        assert!(matches!(
            validate_pathspec("content/ai-agent/langgraph/note.md"),
            PathspecValidation::Valid(_)
        ));
    }

    #[test]
    fn valid_path_with_spaces() {
        assert!(matches!(
            validate_pathspec("content/my notes/file.md"),
            PathspecValidation::Valid(_)
        ));
    }

    #[test]
    fn protects_git_dir() {
        assert!(is_protected_path(".git/config"));
        assert!(is_protected_path(".publish-workspaces/abc"));
    }
}
