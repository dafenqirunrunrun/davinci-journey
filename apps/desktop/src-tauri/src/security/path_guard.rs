use std::path::{Component, Path, PathBuf};

/// Possible outcomes of a path safety check.
#[derive(Debug, Clone, PartialEq)]
pub enum PathSafety {
    Safe,
    Unsafe(String),
}

/// Normalize a path by resolving `.` and `..` components without following symlinks
/// or requiring the path to exist.
pub fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                components.pop();
            }
            Component::CurDir => { /* skip */ }
            other => components.push(other),
        }
    }
    components.iter().collect()
}

/// Check whether `child` is a descendant of `parent` after normalization.
pub fn is_child_of(parent: &Path, child: &Path) -> bool {
    let parent_norm = normalize_path(parent);
    let child_norm = normalize_path(child);
    child_norm.starts_with(&parent_norm) && child_norm != parent_norm
}

/// Ensure that `child` is strictly inside `parent`. Returns Err if not.
pub fn ensure_child(parent: &Path, child: &Path) -> Result<(), String> {
    if is_child_of(parent, child) {
        Ok(())
    } else {
        Err(format!(
            "路径越界：{} 不在允许的根目录 {} 内",
            child.display(),
            parent.display()
        ))
    }
}

/// Check if a path tries to traverse outside its container via `..`.
pub fn has_traversal(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

/// Check whether a path contains components that could be used for symlink-based
/// escape. This does *not* resolve symlinks itself – call `is_symlink` separately.
pub fn has_suspicious_components(path: &Path) -> bool {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if name.starts_with('.') && name.len() > 1 {
            return true;
        }
    }
    false
}

/// Check if a path is a symlink (calls fs::symlink_metadata).
pub fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Allowed root directories for writing content into the repository.
pub const ALLOWED_CONTENT_ROOTS: &[&str] = &["content/", "public/assets/notes/", "config/"];

/// Verify that a relative target path falls inside one of the allowed roots.
/// Returns `Ok(())` if the path is safe, or an error explanation.
pub fn verify_allowed_target(relative_path: &Path) -> Result<(), String> {
    let normal = normalize_path(relative_path);
    let normal_str = normal.to_string_lossy().replace('\\', "/");

    if normal_str.is_empty() {
        return Err("目标路径为空".to_string());
    }

    if has_traversal(&normal) {
        return Err(format!("路径包含 .. 越界片段：{}", normal_str));
    }

    if normal.is_absolute() {
        return Err(format!("不允许使用绝对目标路径：{}", normal_str));
    }

    for root in ALLOWED_CONTENT_ROOTS {
        let root_norm = root.replace('\\', "/");
        if normal_str.starts_with(&root_norm) || normal_str == root_norm.trim_end_matches('/') {
            return Ok(());
        }
    }

    Err(format!(
        "目标路径 {} 不在允许的写入根目录内。允许：{:?}",
        normal_str, ALLOWED_CONTENT_ROOTS
    ))
}

/// Verify that a file path is safe to read: not a symlink, not traversing, regular file.
pub fn verify_safe_read(path: &Path) -> Result<(), String> {
    if is_symlink(path) {
        return Err(format!("符号链接不允许读取：{}", path.display()));
    }
    if has_traversal(path) {
        return Err(format!("路径包含 .. 越界片段：{}", path.display()));
    }
    let meta =
        std::fs::metadata(path).map_err(|e| format!("无法访问文件 {}：{}", path.display(), e))?;
    if !meta.is_file() {
        return Err(format!("不是普通文件：{}", path.display()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_dot_and_dotdot() {
        let p = Path::new("a/b/../c/./d");
        assert_eq!(normalize_path(p), PathBuf::from("a/c/d"));
    }

    #[test]
    fn is_child_of_works() {
        let parent = Path::new("/repo/content");
        let child = Path::new("/repo/content/ai-agent/langgraph/note.md");
        assert!(is_child_of(parent, child));
    }

    #[test]
    fn is_not_child_of_parent() {
        let parent = Path::new("/repo/content");
        assert!(!is_child_of(parent, parent));
    }

    #[test]
    fn rejects_traversal_outside() {
        let parent = Path::new("/repo/content");
        let child = Path::new("/repo/config/secret.yml");
        assert!(!is_child_of(parent, child));
    }

    #[test]
    fn allowed_targets_pass() {
        assert!(verify_allowed_target(Path::new("content/ai-agent/note.md")).is_ok());
        assert!(verify_allowed_target(Path::new("public/assets/notes/slug/image.webp")).is_ok());
        assert!(verify_allowed_target(Path::new("config/archive-profiles.yml")).is_ok());
    }

    #[test]
    fn disallowed_targets_fail() {
        assert!(verify_allowed_target(Path::new("secret.txt")).is_err());
        assert!(verify_allowed_target(Path::new("apps/desktop/src/lib.rs")).is_err());
        assert!(verify_allowed_target(Path::new(".git/config")).is_err());
    }

    #[test]
    fn traversal_rejected() {
        assert!(verify_allowed_target(Path::new("content/../../.git/config")).is_err());
    }

    #[test]
    fn absolute_rejected() {
        assert!(verify_allowed_target(Path::new("/etc/passwd")).is_err());
    }
}
