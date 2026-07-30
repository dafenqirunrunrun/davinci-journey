use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Archive profile as stored in archive-profiles.yml
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveProfileEntry {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    pub directory: String,
    #[serde(default)]
    pub default_tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Top-level structure of the archive-profiles.yml file.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ArchiveProfilesConfig {
    #[serde(alias = "archiveProfiles")]
    archive_profiles: Vec<ArchiveProfileEntry>,
}

/// Load the current archive profiles from YAML.
pub fn load_archive_config(path: &Path) -> Result<Vec<ArchiveProfileEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path).map_err(|e| format!("读取归档配置文件失败：{}", e))?;

    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    let config: ArchiveProfilesConfig =
        serde_yaml::from_str(&content).map_err(|e| format!("解析归档配置文件失败：{}", e))?;

    Ok(config.archive_profiles)
}

/// Check whether adding a new profile would conflict with existing ones.
pub fn check_profile_conflicts(
    existing: &[ArchiveProfileEntry],
    new_profile: &ArchiveProfileEntry,
) -> Vec<String> {
    let mut conflicts = Vec::new();

    for existing_profile in existing {
        if existing_profile.id == new_profile.id {
            conflicts.push(format!(
                "ID '{}' 已存在（方案：{}）",
                existing_profile.id, existing_profile.name
            ));
        }
        if existing_profile.name == new_profile.name {
            conflicts.push(format!("名称 '{}' 已存在", existing_profile.name));
        }
        if existing_profile.directory == new_profile.directory {
            conflicts.push(format!(
                "目录 '{}' 已被方案 '{}' 使用",
                existing_profile.directory, existing_profile.name
            ));
        }
    }

    conflicts
}

/// Merge new profiles into existing configuration.
/// Returns the updated profile list.
fn merge_profiles(
    existing: Vec<ArchiveProfileEntry>,
    new_profiles: &[ArchiveProfileEntry],
) -> Vec<ArchiveProfileEntry> {
    let mut merged = existing;
    for profile in new_profiles {
        // Check for existing ID
        if let Some(pos) = merged.iter().position(|p| p.id == profile.id) {
            // Update existing profile
            merged[pos] = profile.clone();
        } else {
            // Add new profile
            merged.push(profile.clone());
        }
    }
    merged
}

/// Write new archive profiles to the config file.
/// Returns the changes made: which profiles were created or updated.
pub fn apply_archive_profiles(
    config_path: &Path,
    new_profiles: &[ArchiveProfileEntry],
) -> Result<ApplyResult, String> {
    let existing = load_archive_config(config_path)?;

    // Check all conflicts first
    let mut all_conflicts = Vec::new();
    for profile in new_profiles {
        let conflicts = check_profile_conflicts(&existing, profile);
        all_conflicts.extend(conflicts);
    }

    // Check if directory already exists (not a blocking conflict, just informational)
    let merged = merge_profiles(existing.clone(), new_profiles);

    let config = ArchiveProfilesConfig {
        archive_profiles: merged,
    };

    // Serialize with stable YAML output
    let yaml = serde_yaml::to_string(&config).map_err(|e| format!("YAML 序列化失败：{}", e))?;

    // Add comment header
    let output = format!(
        "# 归档方案配置\n# 此文件由管理工具维护，请勿手动编辑\n\n{}",
        yaml
    );

    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败：{}", e))?;
    }

    // Write atomically via a temp file
    let tmp_path = config_path.with_extension("yml.tmp");
    fs::write(&tmp_path, &output).map_err(|e| format!("写入临时配置文件失败：{}", e))?;
    fs::rename(&tmp_path, config_path).map_err(|e| format!("写入归档配置文件失败：{}", e))?;

    // Determine what was created vs updated
    let mut created = Vec::new();
    let mut updated = Vec::new();
    for profile in new_profiles {
        if existing.iter().any(|p| p.id == profile.id) {
            updated.push(profile.id.clone());
        } else {
            created.push(profile.id.clone());
        }
    }

    Ok(ApplyResult {
        created,
        updated,
        conflicts: all_conflicts,
    })
}

/// Result of applying archive profile changes.
#[derive(Debug, Clone)]
pub struct ApplyResult {
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub conflicts: Vec<String>,
}

/// Verify that a profile entry is valid before writing.
pub fn validate_profile(profile: &ArchiveProfileEntry) -> Result<(), String> {
    if profile.id.trim().is_empty() {
        return Err("归档方案 ID 不能为空".to_string());
    }
    if profile.name.trim().is_empty() {
        return Err("归档方案名称不能为空".to_string());
    }
    if profile.category.trim().is_empty() {
        return Err("主分类不能为空".to_string());
    }
    if profile.directory.trim().is_empty() {
        return Err("目录不能为空".to_string());
    }
    if profile.id.contains('/') || profile.id.contains('\\') || profile.id.contains(' ') {
        return Err("归档方案 ID 不能包含空格、斜杠或反斜杠".to_string());
    }
    if !profile.directory.starts_with("content/") {
        return Err("归档目录必须以 content/ 开头".to_string());
    }
    Ok(())
}

/// Re-read the archive config to verify it was written correctly.
pub fn verify_write(config_path: &Path) -> Result<bool, String> {
    let profiles = load_archive_config(config_path)?;
    Ok(!profiles.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn loads_empty_config() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("archive-profiles.yml");
        let profiles = load_archive_config(&path).unwrap();
        assert!(profiles.is_empty());
    }

    #[test]
    fn writes_and_reads_config() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("archive-profiles.yml");

        let profile = ArchiveProfileEntry {
            id: "test-profile".to_string(),
            name: "Test / Profile".to_string(),
            category: "Test".to_string(),
            topic: Some("Profile".to_string()),
            directory: "content/test/profile".to_string(),
            default_tags: vec!["Test".to_string()],
            description: Some("A test profile".to_string()),
        };

        apply_archive_profiles(&path, &[profile]).unwrap();

        let loaded = load_archive_config(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test-profile");
    }

    #[test]
    fn detects_conflicts() {
        let existing = vec![ArchiveProfileEntry {
            id: "existing".to_string(),
            name: "Existing / Profile".to_string(),
            category: "Existing".to_string(),
            topic: Some("Profile".to_string()),
            directory: "content/existing/profile".to_string(),
            default_tags: vec![],
            description: None,
        }];

        let new = ArchiveProfileEntry {
            id: "existing".to_string(),
            name: "Different / Name".to_string(),
            category: "Different".to_string(),
            topic: Some("Name".to_string()),
            directory: "content/different/name".to_string(),
            default_tags: vec![],
            description: None,
        };

        let conflicts = check_profile_conflicts(&existing, &new);
        assert!(!conflicts.is_empty());
        assert!(conflicts.iter().any(|c| c.contains("ID")));
    }

    #[test]
    fn validates_profile() {
        let valid = ArchiveProfileEntry {
            id: "valid-profile".to_string(),
            name: "Valid Profile".to_string(),
            category: "Test".to_string(),
            topic: None,
            directory: "content/test".to_string(),
            default_tags: vec![],
            description: None,
        };
        assert!(validate_profile(&valid).is_ok());

        let invalid = ArchiveProfileEntry {
            id: "".to_string(),
            name: "".to_string(),
            category: "Test".to_string(),
            topic: None,
            directory: "evil/outside".to_string(),
            default_tags: vec![],
            description: None,
        };
        assert!(validate_profile(&invalid).is_err());
    }

    #[test]
    fn preserves_existing_profiles_when_adding_new() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("archive-profiles.yml");

        let existing = ArchiveProfileEntry {
            id: "existing".to_string(),
            name: "Existing / Profile".to_string(),
            category: "Existing".to_string(),
            topic: None,
            directory: "content/existing".to_string(),
            default_tags: vec![],
            description: None,
        };

        apply_archive_profiles(&path, &[existing]).unwrap();

        let new = ArchiveProfileEntry {
            id: "new-profile".to_string(),
            name: "New / Profile".to_string(),
            category: "New".to_string(),
            topic: None,
            directory: "content/new".to_string(),
            default_tags: vec![],
            description: None,
        };

        apply_archive_profiles(&path, &[new]).unwrap();

        let loaded = load_archive_config(&path).unwrap();
        assert_eq!(loaded.len(), 2);

        let ids: Vec<&str> = loaded.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"existing"));
        assert!(ids.contains(&"new-profile"));
    }
}
