use std::fs;
use std::path::Path;
use std::process::Command;

/// Helper to initialize a minimal test git repository.
fn init_test_repo(dir: &Path) {
    Command::new("git")
        .args(["init"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.email", "test@davinci.test"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(dir)
        .output()
        .unwrap();

    fs::create_dir_all(dir.join("content")).unwrap();
    fs::create_dir_all(dir.join("public").join("assets").join("notes")).unwrap();
    fs::create_dir_all(dir.join("config")).unwrap();

    let config = r#"archiveProfiles:
  - id: ai-agent-langgraph
    name: AI Agent / LangGraph
    category: AI Agent
    topic: LangGraph
    directory: content/ai-agent/langgraph
    defaultTags:
      - AI Agent
      - LangGraph
"#;
    fs::write(dir.join("config/archive-profiles.yml"), config).unwrap();

    fs::write(dir.join("README.md"), "# Test Repo").unwrap();
    Command::new("git")
        .args(["add", "README.md", "config/archive-profiles.yml"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "initial commit"])
        .current_dir(dir)
        .output()
        .unwrap();
}

use davinci_journey_desktop::security::repository_guard::inspect_repository;
use davinci_journey_desktop::services::repository_publish::{
    commit_transaction, pre_publish_check, stage_transaction, ApplyWorkspaceRequest,
    CommitTransactionRequest, PrePublishCheckRequest, RollbackPublishRequest,
    StageTransactionRequest,
};

#[test]
fn e2e_git_repository_status() {
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    let status = inspect_repository(dir.path()).expect("Should inspect repo");
    assert!(status.branch.is_some(), "Branch should be detected");
    assert!(!status.merge_in_progress, "No merge in progress");
    assert!(!status.detached_head, "HEAD not detached");
    assert_eq!(status.head.len(), 40, "HEAD should be 40-char SHA");
}

#[test]
fn e2e_pre_publish_check_rejects_nonexistent_workspace() {
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    let result = pre_publish_check(PrePublishCheckRequest {
        repository_root: dir.path().to_string_lossy().to_string(),
        workspace_id: "nonexistent".to_string(),
    });
    assert!(result.is_err(), "Should reject non-existent workspace");
}

#[test]
fn e2e_full_publish_workflow() {
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    // Create workspace
    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = dir.path().join(".publish-workspaces").join(&ws_id);
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    let ws_public = ws_root.join("public/assets/notes/e2e-test-article");
    fs::create_dir_all(&ws_content).unwrap();
    fs::create_dir_all(&ws_public).unwrap();

    // Write workspace markdown
    let md_content =
        "---\ntitle: E2E Test Article\nslug: e2e-test-article\n---\n\n# E2E Test\n\nTest content.";
    let md_path = ws_content.join("e2e-test-article.md");
    fs::write(&md_path, md_content).unwrap();

    // Create real source markdown file (so source_markdown_path is valid)
    let source_md = dir.path().join("sources/source-note.md");
    fs::create_dir_all(dir.path().join("sources")).unwrap();
    let src_content =
        "---\ntitle: E2E Test Article\nslug: e2e-test-article\n---\n\n# E2E Test\n\nTest content.";
    fs::write(&source_md, src_content).unwrap();
    let src_fingerprint = {
        use sha2::Digest;
        let bytes = fs::read(&source_md).unwrap();
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };
    let source_md_str = source_md.to_string_lossy().to_string();

    // Write workspace manifest
    let manifest = serde_json::json!({
        "version": 1,
        "workspace_id": ws_id,
        "created_at": "2026-07-30T10:00:00Z",
        "source_markdown_path": source_md_str,
        "target_markdown_path": "content/ai-agent/langgraph/e2e-test-article.md",
        "target_asset_directory": "public/assets/notes/e2e-test-article",
        "archive_profile_id": "ai-agent-langgraph",
        "source_fingerprint": src_fingerprint,
        "planned_changes": [
            "content/ai-agent/langgraph/e2e-test-article.md",
            "public/assets/notes/e2e-test-article"
        ],
        "assets": []
    });
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    // Apply workspace to repository
    let result = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        ApplyWorkspaceRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    );
    if let Err(ref e) = result {
        // Print some debug info
        let manifest_rt = fs::read_to_string(ws_root.join("manifest.json")).unwrap();
        println!("Error: {}", e);
        println!("Manifest content: {}", manifest_rt);
    }
    assert!(result.is_ok(), "Should apply workspace: {:?}", result.err());
    let apply = result.unwrap();

    // Verify file was written to repo
    let target = dir
        .path()
        .join("content/ai-agent/langgraph/e2e-test-article.md");
    assert!(target.exists(), "Target markdown should exist");
    let written = fs::read_to_string(&target).unwrap();
    assert!(written.contains("E2E Test Article"), "Content should match");

    // Stage the file
    let stage_result = stage_transaction(StageTransactionRequest {
        repository_root: dir.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id.clone(),
    });
    assert!(
        stage_result.is_ok(),
        "Should stage: {:?}",
        stage_result.err()
    );
    let stage = stage_result.unwrap();
    assert!(stage.can_commit, "Should be able to commit");
    assert!(!stage.staged_files.is_empty(), "Files should be staged");

    // Commit
    let commit_result = commit_transaction(CommitTransactionRequest {
        repository_root: dir.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id,
        message: "docs(langgraph): add e2e test article with assets".to_string(),
    });
    assert!(
        commit_result.is_ok(),
        "Should commit: {:?}",
        commit_result.err()
    );
    let commit = commit_result.unwrap();
    assert!(!commit.commit_hash.is_empty(), "Commit hash should exist");
    assert_eq!(commit.branch, "master", "Should commit to master");

    // Verify commit with git log
    let log = Command::new("git")
        .args(["log", "--oneline", "-1"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    let log_output = String::from_utf8_lossy(&log.stdout);
    assert!(
        log_output.contains(&commit.short_hash),
        "Commit should be in git log"
    );
}

#[test]
fn e2e_unrelated_untracked_files_do_not_enter_stage_or_commit() {
    let target = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    init_test_repo(target.path());

    fs::write(target.path().join("private-a.md"), "# private a").unwrap();
    fs::write(target.path().join("private-b.md"), "# private b").unwrap();

    let source_md = source.path().join("note.md");
    fs::write(&source_md, "# Source").unwrap();
    let source_fingerprint = {
        use sha2::Digest;
        let bytes = fs::read(&source_md).unwrap();
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };

    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = target.path().join(".publish-workspaces").join(&ws_id);
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();
    fs::write(
        ws_content.join("untracked-safe.md"),
        "---\ntitle: Untracked Safe\narchiveProfile: ai-agent-langgraph\nslug: untracked-safe\n---\n\n# Safe",
    )
    .unwrap();
    let manifest = serde_json::json!({
        "version": 1,
        "workspaceId": ws_id,
        "createdAt": "2026-08-01T00:00:00Z",
        "sourceMarkdownPath": source_md.to_string_lossy().to_string(),
        "targetMarkdownPath": "content/ai-agent/langgraph/untracked-safe.md",
        "targetAssetDirectory": "public/assets/notes/untracked-safe",
        "archiveProfileId": "ai-agent-langgraph",
        "sourceFingerprint": source_fingerprint,
        "plannedChanges": ["content/ai-agent/langgraph/untracked-safe.md"],
        "assets": []
    });
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let precheck = pre_publish_check(PrePublishCheckRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        workspace_id: ws_id.clone(),
    })
    .expect("precheck with unrelated untracked files should pass");
    assert_eq!(precheck.git_status.unrelated_untracked_count, 2);
    assert_eq!(precheck.git_status.unrelated_staged_count, 0);
    assert!(precheck.git_status.unrelated_staged_files.is_empty());
    assert!(precheck.git_status.safe_to_publish);

    let apply = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        ApplyWorkspaceRequest {
            repository_root: target.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    )
    .expect("apply should ignore unrelated untracked files");

    let stage = stage_transaction(StageTransactionRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id.clone(),
    })
    .expect("stage should use explicit transaction paths only");
    assert!(stage.can_commit);
    assert!(!stage.staged_files.contains(&"private-a.md".to_string()));
    assert!(!stage.staged_files.contains(&"private-b.md".to_string()));

    let commit = commit_transaction(CommitTransactionRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id,
        message: "docs(langgraph): add untracked safe note".to_string(),
    })
    .expect("commit should exclude unrelated untracked files");
    assert!(!commit.committed_files.contains(&"private-a.md".to_string()));
    assert!(!commit.committed_files.contains(&"private-b.md".to_string()));

    let show = Command::new("git")
        .args(["show", "--name-only", "--format=", "HEAD"])
        .current_dir(target.path())
        .output()
        .unwrap();
    let committed_paths = String::from_utf8_lossy(&show.stdout);
    assert!(!committed_paths.contains("private-a.md"));
    assert!(!committed_paths.contains("private-b.md"));
}

#[test]
fn e2e_unrelated_staged_file_blocks_transaction_stage() {
    let target = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    init_test_repo(target.path());

    fs::write(target.path().join("staged-unrelated.md"), "# staged").unwrap();
    Command::new("git")
        .args(["add", "staged-unrelated.md"])
        .current_dir(target.path())
        .output()
        .unwrap();

    let source_md = source.path().join("note.md");
    fs::write(&source_md, "# Source").unwrap();
    let source_fingerprint = {
        use sha2::Digest;
        let bytes = fs::read(&source_md).unwrap();
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };

    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = target.path().join(".publish-workspaces").join(&ws_id);
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();
    fs::write(
        ws_content.join("staged-block.md"),
        "---\ntitle: Staged Block\narchiveProfile: ai-agent-langgraph\nslug: staged-block\n---\n\n# Block",
    )
    .unwrap();
    let manifest = serde_json::json!({
        "version": 1,
        "workspaceId": ws_id,
        "createdAt": "2026-08-01T00:00:00Z",
        "sourceMarkdownPath": source_md.to_string_lossy().to_string(),
        "targetMarkdownPath": "content/ai-agent/langgraph/staged-block.md",
        "targetAssetDirectory": "public/assets/notes/staged-block",
        "archiveProfileId": "ai-agent-langgraph",
        "sourceFingerprint": source_fingerprint,
        "plannedChanges": ["content/ai-agent/langgraph/staged-block.md"],
        "assets": []
    });
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let precheck = pre_publish_check(PrePublishCheckRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        workspace_id: ws_id.clone(),
    })
    .expect("precheck should report unrelated staged files");
    assert_eq!(precheck.git_status.unrelated_staged_count, 1);
    assert_eq!(
        precheck.git_status.unrelated_staged_files,
        vec!["staged-unrelated.md".to_string()]
    );

    let apply = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        ApplyWorkspaceRequest {
            repository_root: target.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    )
    .expect("apply still writes transaction workspace files");

    let stage = stage_transaction(StageTransactionRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id,
    })
    .expect("stage should return a blocking result");
    assert!(!stage.can_commit);
    assert!(stage.has_unrelated_staged);
    assert_eq!(
        stage.unrelated_files,
        vec!["staged-unrelated.md".to_string()]
    );
}

#[test]
fn e2e_target_file_uncommitted_change_still_blocks_precheck() {
    let target = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    init_test_repo(target.path());

    let target_md = target.path().join("content/ai-agent/langgraph/conflict.md");
    fs::create_dir_all(target_md.parent().unwrap()).unwrap();
    fs::write(&target_md, "# Existing").unwrap();
    Command::new("git")
        .args(["add", "content/ai-agent/langgraph/conflict.md"])
        .current_dir(target.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "docs(langgraph): add existing conflict"])
        .current_dir(target.path())
        .output()
        .unwrap();
    fs::write(&target_md, "# User change").unwrap();

    let source_md = source.path().join("note.md");
    fs::write(&source_md, "# Source").unwrap();
    let source_fingerprint = {
        use sha2::Digest;
        let bytes = fs::read(&source_md).unwrap();
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };

    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = target.path().join(".publish-workspaces").join(&ws_id);
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();
    fs::write(
        ws_content.join("conflict.md"),
        "---\ntitle: Conflict\narchiveProfile: ai-agent-langgraph\nslug: conflict\n---\n\n# Conflict",
    )
    .unwrap();
    let manifest = serde_json::json!({
        "version": 1,
        "workspaceId": ws_id,
        "createdAt": "2026-08-01T00:00:00Z",
        "sourceMarkdownPath": source_md.to_string_lossy().to_string(),
        "targetMarkdownPath": "content/ai-agent/langgraph/conflict.md",
        "targetAssetDirectory": "public/assets/notes/conflict",
        "archiveProfileId": "ai-agent-langgraph",
        "sourceFingerprint": source_fingerprint,
        "plannedChanges": ["content/ai-agent/langgraph/conflict.md"],
        "assets": []
    });
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let precheck = pre_publish_check(PrePublishCheckRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        workspace_id: ws_id,
    })
    .expect("precheck should return conflict details");

    assert!(!precheck.target_conflicts.can_proceed);
    assert!(precheck
        .target_conflicts
        .uncommitted_files
        .contains(&"content/ai-agent/langgraph/conflict.md".to_string()));
}

#[test]
fn e2e_external_source_git_writes_only_to_explicit_target_repo() {
    let target = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    init_test_repo(target.path());
    init_test_repo(source.path());

    let source_md = source.path().join("notes/checkpoint.md");
    fs::create_dir_all(source.path().join("notes")).unwrap();
    fs::write(
        &source_md,
        "# LangGraph Checkpoint\n\nSource repo must stay untouched.",
    )
    .unwrap();
    let source_fingerprint = {
        use sha2::Digest;
        let bytes = fs::read(&source_md).unwrap();
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };

    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = target.path().join(".publish-workspaces").join(&ws_id);
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    let ws_public = ws_root.join("public/assets/notes/langgraph-checkpoint");
    fs::create_dir_all(&ws_content).unwrap();
    fs::create_dir_all(&ws_public).unwrap();
    fs::write(
        ws_content.join("langgraph-checkpoint.md"),
        "---\ntitle: LangGraph Checkpoint\narchiveProfile: ai-agent-langgraph\nslug: langgraph-checkpoint\n---\n\n# LangGraph Checkpoint\n\n![Architecture](/assets/notes/langgraph-checkpoint/architecture.webp)",
    )
    .unwrap();
    fs::write(ws_public.join("architecture.webp"), b"webp-bytes").unwrap();

    let manifest = serde_json::json!({
        "version": 1,
        "workspace_id": ws_id,
        "created_at": "2026-07-30T10:00:00Z",
        "source_markdown_path": source_md.to_string_lossy().to_string(),
        "target_markdown_path": "content/ai-agent/langgraph/langgraph-checkpoint.md",
        "target_asset_directory": "public/assets/notes/langgraph-checkpoint",
        "archive_profile_id": "ai-agent-langgraph",
        "source_fingerprint": source_fingerprint,
        "planned_changes": [
            "content/ai-agent/langgraph/langgraph-checkpoint.md",
            "public/assets/notes/langgraph-checkpoint"
        ],
        "assets": [
            {
                "reference_id": "image-001",
                "source_path": null,
                "target_path": "public/assets/notes/langgraph-checkpoint/architecture.webp",
                "public_path": "/assets/notes/langgraph-checkpoint/architecture.webp",
                "sha256": null,
                "status": "written",
                "warning": null
            }
        ]
    });
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let apply = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        ApplyWorkspaceRequest {
            repository_root: target.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    )
    .expect("apply external source workspace to explicit target");

    assert!(target
        .path()
        .join("content/ai-agent/langgraph/langgraph-checkpoint.md")
        .exists());
    assert!(target
        .path()
        .join("public/assets/notes/langgraph-checkpoint/architecture.webp")
        .exists());
    assert!(!source
        .path()
        .join("content/ai-agent/langgraph/langgraph-checkpoint.md")
        .exists());
    assert!(!source.path().join(".publish-workspaces").exists());

    let stage = stage_transaction(StageTransactionRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id.clone(),
    })
    .expect("stage explicit target transaction");
    assert!(stage.can_commit);
    assert!(stage
        .staged_files
        .iter()
        .any(|path| path == "content/ai-agent/langgraph/langgraph-checkpoint.md"));
    assert!(stage
        .staged_files
        .iter()
        .any(|path| path == "public/assets/notes/langgraph-checkpoint/architecture.webp"));

    let commit = commit_transaction(CommitTransactionRequest {
        repository_root: target.path().to_string_lossy().to_string(),
        transaction_id: apply.transaction_id,
        message: "docs(langgraph): add separated source smoke note".to_string(),
    })
    .expect("commit explicit target transaction");
    assert!(!commit.short_hash.is_empty());

    assert!(
        fs::read_to_string(&source_md)
            .unwrap()
            .contains("Source repo must stay untouched."),
        "source markdown should remain unchanged"
    );
}

#[test]
fn e2e_rollback_test() {
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = dir.path().join(".publish-workspaces").join(&ws_id);
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();

    let md_content = "# Rollback Test";
    let md_path = ws_content.join("rollback-test.md");
    fs::write(&md_path, md_content).unwrap();

    // Create real source file
    let rollback_source = dir.path().join("sources/rollback-note.md");
    fs::create_dir_all(dir.path().join("sources")).unwrap();
    fs::write(&rollback_source, "# Rollback Source").unwrap();
    let rb_fingerprint = {
        use sha2::Digest;
        let bytes = fs::read(&rollback_source).unwrap();
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };

    let manifest = serde_json::json!({
        "version": 1,
        "workspace_id": ws_id,
        "created_at": "2026-07-30T10:00:00Z",
        "source_markdown_path": rollback_source.to_string_lossy().to_string(),
        "target_markdown_path": "content/ai-agent/langgraph/rollback-test.md",
        "target_asset_directory": "public/assets/notes/rollback-test",
        "archive_profile_id": "ai-agent-langgraph",
        "source_fingerprint": rb_fingerprint,
        "planned_changes": [],
        "assets": []
    });
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let result = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        ApplyWorkspaceRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    );

    if let Ok(apply) = result {
        // Rollback
        let rollback = davinci_journey_desktop::services::repository_publish::rollback_publish(
            RollbackPublishRequest {
                repository_root: dir.path().to_string_lossy().to_string(),
                transaction_id: apply.transaction_id,
            },
        );
        assert!(rollback.is_ok(), "Should rollback: {:?}", rollback.err());
    }
}
