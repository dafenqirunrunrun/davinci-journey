//! Image end-to-end test: verifies that fixture images are correctly processed,
//! written to the repository, staged, committed, and rolled back.
//!
//! Uses a temporary git repository — never writes to the real project content/.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const FIXTURES_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../fixtures/publish");

fn init_test_repo(dir: &Path) {
    Command::new("git")
        .args(["init"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.email", "img-test@test.invalid"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.name", "Image Test"])
        .current_dir(dir)
        .output()
        .unwrap();

    fs::create_dir_all(dir.join("content/ai-agent/langgraph")).unwrap();
    fs::create_dir_all(dir.join("public/assets/notes")).unwrap();
    fs::create_dir_all(dir.join("config")).unwrap();

    let config = r#"archiveProfiles:
  - id: ai-agent-langgraph
    name: AI Agent / LangGraph
    category: AI Agent
    topic: LangGraph
    directory: content/ai-agent/langgraph
    defaultTags: []
"#;
    fs::write(dir.join("config/archive-profiles.yml"), config).unwrap();
    fs::write(dir.join("README.md"), "# Image E2E").unwrap();

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

/// Build a workspace manifest for a test article that includes images.
fn build_manifest(
    _ws_root: &Path,
    ws_id: &str,
    source_md: &Path,
    target_md_path: &str,
    target_asset_dir: &str,
    assets: &[serde_json::Value],
) -> serde_json::Value {
    let bytes = fs::read(source_md).unwrap();
    let fingerprint = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(&bytes))
    };

    serde_json::json!({
        "version": 1,
        "workspace_id": ws_id,
        "created_at": "2026-07-30T10:00:00Z",
        "source_markdown_path": source_md.to_string_lossy().to_string(),
        "target_markdown_path": target_md_path,
        "target_asset_directory": target_asset_dir,
        "archive_profile_id": "ai-agent-langgraph",
        "source_fingerprint": fingerprint,
        "planned_changes": [
            target_md_path,
            target_asset_dir
        ],
        "assets": assets
    })
}

/// Create a minimal real source markdown file.
fn create_source_md(dir: &Path, article_text: &str) -> PathBuf {
    let path = dir.join("sources/article.md");
    fs::create_dir_all(dir.join("sources")).unwrap();
    fs::write(&path, article_text).unwrap();
    path
}

#[test]
fn image_png_to_webp_is_written_and_committed() {
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    // Load fixture PNG
    let png_path = PathBuf::from(FIXTURES_ROOT).join("valid-note/images/architecture.png");
    assert!(
        png_path.exists(),
        "Fixture PNG should exist: {:?}",
        png_path
    );
    let png_bytes = fs::read(&png_path).unwrap();

    // Create source markdown that references the image
    let source_md = create_source_md(dir.path(),
        "---\ntitle: Image E2E Test\nslug: e2e-image-test\n---\n\n# Image E2E\n\n![Architecture](./images/architecture.png)\n![Flow](./images/flow.jpg)\n"
    );
    let source_dir = source_md.parent().unwrap();

    // Copy images next to source md (simulates how the real app resolves them)
    let images_dir = source_dir.join("images");
    fs::create_dir_all(&images_dir).unwrap();
    fs::copy(&png_path, images_dir.join("architecture.png")).unwrap();

    let jpg_path = PathBuf::from(FIXTURES_ROOT).join("valid-note/images/flow.jpg");
    assert!(
        jpg_path.exists(),
        "Fixture JPG should exist: {:?}",
        jpg_path
    );
    fs::copy(&jpg_path, images_dir.join("flow.jpg")).unwrap();

    // Create workspace
    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = dir.path().join(".publish-workspaces").join(&ws_id);
    let ws_public = ws_root.join("public/assets/notes/e2e-image-test");
    fs::create_dir_all(&ws_public).unwrap();

    // Simulate workspace image output (as webp)
    let png_webp_path = ws_public.join("01-architecture.webp");
    {
        let img = image::load_from_memory(&png_bytes).unwrap();
        let mut out = fs::File::create(&png_webp_path).unwrap();
        img.write_to(&mut out, image::ImageFormat::WebP).unwrap();
    }
    let png_webp_bytes = fs::read(&png_webp_path).unwrap();
    // Manifest sha256 must be the SOURCE image fingerprint for verification
    let png_hash = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(&png_bytes))
    };

    let jpg_bytes = fs::read(&jpg_path).unwrap();
    let jpg_webp_path = ws_public.join("02-flow.webp");
    {
        let img = image::load_from_memory(&jpg_bytes).unwrap();
        let mut out = fs::File::create(&jpg_webp_path).unwrap();
        img.write_to(&mut out, image::ImageFormat::WebP).unwrap();
    }
    let jpg_webp_bytes = fs::read(&jpg_webp_path).unwrap();
    // Manifest sha256 must be the SOURCE image fingerprint for verification
    let jpg_hash = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(&jpg_bytes))
    };

    // Build manifest with both images
    let assets = vec![
        serde_json::json!({
            "reference_id": "img-001",
            "source_path": png_path.to_string_lossy().to_string(),
            "target_path": png_webp_path.to_string_lossy().to_string(),
            "public_path": "/assets/notes/e2e-image-test/01-architecture.webp",
            "sha256": png_hash,
            "mime_type": "image/webp",
            "size": png_webp_bytes.len(),
            "status": "written"
        }),
        serde_json::json!({
            "reference_id": "img-002",
            "source_path": jpg_path.to_string_lossy().to_string(),
            "target_path": jpg_webp_path.to_string_lossy().to_string(),
            "public_path": "/assets/notes/e2e-image-test/02-flow.webp",
            "sha256": jpg_hash,
            "mime_type": "image/webp",
            "size": jpg_webp_bytes.len(),
            "status": "written"
        }),
    ];

    let manifest = build_manifest(
        &ws_root,
        &ws_id,
        &source_md,
        "content/ai-agent/langgraph/e2e-image-test.md",
        "public/assets/notes/e2e-image-test",
        &assets,
    );
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    // Write the markdown to workspace too
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();
    fs::write(
        ws_content.join("e2e-image-test.md"),
        "---\ntitle: Image E2E Test\nslug: e2e-image-test\n---\n\n# Image E2E\n\n![Architecture](/assets/notes/e2e-image-test/01-architecture.webp)\n![Flow](/assets/notes/e2e-image-test/02-flow.webp)\n",
    )
    .unwrap();

    // Apply workspace to repository
    let result = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        davinci_journey_desktop::services::repository_publish::ApplyWorkspaceRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    );
    assert!(result.is_ok(), "Should apply workspace: {:?}", result.err());
    let apply = result.unwrap();

    // Check that files exist at expected repo paths
    let md_target = dir
        .path()
        .join("content/ai-agent/langgraph/e2e-image-test.md");
    assert!(md_target.exists(), "Markdown should exist in repo");

    let img1_target = dir
        .path()
        .join("public/assets/notes/e2e-image-test/01-architecture.webp");
    assert!(
        img1_target.exists(),
        "Image 1 (PNG->WebP) should exist in repo"
    );

    let img2_target = dir
        .path()
        .join("public/assets/notes/e2e-image-test/02-flow.webp");
    assert!(
        img2_target.exists(),
        "Image 2 (JPG->WebP) should exist in repo"
    );

    // Verify the webp files are valid
    let img1_bytes = fs::read(&img1_target).unwrap();
    assert!(
        img1_bytes.starts_with(b"RIFF"),
        "WebP should start with RIFF"
    );
    assert_eq!(img1_bytes[8..12], *b"WEBP", "WebP magic bytes should match");

    // Verify the written image is valid WebP (output differs from source, so we
    // verify the output hash is NOT the source hash but the file is valid WebP)
    assert!(
        !img1_bytes.eq(&png_bytes),
        "WebP output should differ from PNG source"
    );

    // Verify markdown references file paths (not absolute, not local)
    let md_content = fs::read_to_string(&md_target).unwrap();
    assert!(
        md_content.contains("/assets/notes/e2e-image-test/01-architecture.webp"),
        "Markdown should reference public URL path, got: {}",
        md_content
    );
    assert!(
        !md_content.contains(":\\"),
        "Markdown should not contain absolute paths"
    );
    assert!(
        !md_content.contains("../"),
        "Markdown should not contain relative traversal"
    );

    // Stage files
    let stage_result = davinci_journey_desktop::services::repository_publish::stage_transaction(
        davinci_journey_desktop::services::repository_publish::StageTransactionRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            transaction_id: apply.transaction_id.clone(),
        },
    );
    assert!(
        stage_result.is_ok(),
        "Stage should succeed: {:?}",
        stage_result.err()
    );
    let stage = stage_result.unwrap();
    assert!(stage.can_commit, "Should be able to commit");

    // Check that images are staged
    assert!(
        stage
            .staged_files
            .iter()
            .any(|f| f.contains("architecture.webp")),
        "PNG->WebP image should be staged"
    );
    assert!(
        stage.staged_files.iter().any(|f| f.contains("flow.webp")),
        "JPG->WebP image should be staged"
    );

    // Commit
    let commit_result = davinci_journey_desktop::services::repository_publish::commit_transaction(
        davinci_journey_desktop::services::repository_publish::CommitTransactionRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            transaction_id: apply.transaction_id,
            message: "docs(langgraph): add image e2e test article with assets".to_string(),
        },
    );
    assert!(
        commit_result.is_ok(),
        "Commit should succeed: {:?}",
        commit_result.err()
    );
    let _commit = commit_result.unwrap();

    // Verify commit via git show
    let output = Command::new("git")
        .args(["show", "--name-only", "--format=", "HEAD"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    let files = String::from_utf8_lossy(&output.stdout);
    assert!(
        files.contains("01-architecture.webp"),
        "Commit should contain architecture.webp"
    );
    assert!(
        files.contains("02-flow.webp"),
        "Commit should contain flow.webp"
    );
    assert!(
        files.contains("e2e-image-test.md"),
        "Commit should contain the markdown"
    );
}

#[test]
fn image_rollback_removes_images() {
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    // Load fixture
    let png_path = PathBuf::from(FIXTURES_ROOT).join("valid-note/images/architecture.png");
    let png_bytes = fs::read(&png_path).unwrap();

    let source_md = create_source_md(
        dir.path(),
        "# Rollback Image Test\n\n![Arch](./images/architecture.png)",
    );
    let images_dir = source_md.parent().unwrap().join("images");
    fs::create_dir_all(&images_dir).unwrap();
    fs::copy(&png_path, images_dir.join("architecture.png")).unwrap();

    // Create workspace
    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = dir.path().join(".publish-workspaces").join(&ws_id);
    let ws_public = ws_root.join("public/assets/notes/rollback-img-test");
    fs::create_dir_all(&ws_public).unwrap();

    let webp_path = ws_public.join("01-architecture.webp");
    {
        let img = image::load_from_memory(&png_bytes).unwrap();
        let mut out = fs::File::create(&webp_path).unwrap();
        img.write_to(&mut out, image::ImageFormat::WebP).unwrap();
    }

    let png_source_hash = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(&png_bytes))
    };
    let assets = vec![serde_json::json!({
        "reference_id": "img-001",
        "source_path": png_path.to_string_lossy().to_string(),
        "target_path": webp_path.to_string_lossy().to_string(),
        "public_path": "/assets/notes/rollback-img-test/01-architecture.webp",
        "sha256": png_source_hash,
        "status": "written",
        "mime_type": "image/webp",
        "size": fs::metadata(&webp_path).unwrap().len()
    })];

    let manifest = build_manifest(
        &ws_root,
        &ws_id,
        &source_md,
        "content/ai-agent/langgraph/rollback-img-test.md",
        "public/assets/notes/rollback-img-test",
        &assets,
    );
    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    // Add a file that was there before publish (should NOT be removed by rollback)
    fs::create_dir_all(dir.path().join("content/other")).unwrap();
    fs::write(dir.path().join("content/other/unrelated.md"), "# Unrelated").unwrap();
    Command::new("git")
        .args(["add", "content/other/unrelated.md"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "add unrelated file"])
        .current_dir(dir.path())
        .output()
        .unwrap();

    // Write workspace markdown
    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();
    fs::write(
        ws_content.join("rollback-img-test.md"),
        "# Rollback\n\n![Arch](/assets/notes/rollback-img-test/01-architecture.webp)",
    )
    .unwrap();

    // Apply
    let result = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        davinci_journey_desktop::services::repository_publish::ApplyWorkspaceRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "create".to_string(),
            archive_profile_changes: vec![],
        },
    );
    assert!(result.is_ok(), "Apply should succeed: {:?}", result.err());
    let apply = result.unwrap();

    // Verify files exist
    let md_file = dir
        .path()
        .join("content/ai-agent/langgraph/rollback-img-test.md");
    let img_file = dir
        .path()
        .join("public/assets/notes/rollback-img-test/01-architecture.webp");
    assert!(md_file.exists(), "Markdown should exist before rollback");
    assert!(img_file.exists(), "Image should exist before rollback");

    // Verify unrelated file still exists
    let unrelated = dir.path().join("content/other/unrelated.md");
    assert!(
        unrelated.exists(),
        "Unrelated file should exist before rollback"
    );

    // Rollback
    let rollback = davinci_journey_desktop::services::repository_publish::rollback_publish(
        davinci_journey_desktop::services::repository_publish::RollbackPublishRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            transaction_id: apply.transaction_id,
        },
    );
    assert!(
        rollback.is_ok(),
        "Rollback should succeed: {:?}",
        rollback.err()
    );

    // Verify files are removed
    assert!(!md_file.exists(), "Markdown should be removed by rollback");
    assert!(!img_file.exists(), "Image should be removed by rollback");

    // Verify unrelated file is NOT removed
    assert!(
        unrelated.exists(),
        "Unrelated file should NOT be removed by rollback"
    );
}

#[test]
fn images_are_not_deleted_on_update() {
    // This test verifies that old images are NOT deleted when updating an article
    let dir = tempfile::tempdir().unwrap();
    init_test_repo(dir.path());

    // Create an existing article with an image in the repo
    let article_dir = dir.path().join("content/ai-agent/langgraph");
    let assets_dir = dir.path().join("public/assets/notes/existing-article");
    fs::create_dir_all(&article_dir).unwrap();
    fs::create_dir_all(&assets_dir).unwrap();

    fs::write(
        article_dir.join("existing-article.md"),
        "# Existing\n\n![Old Image](/assets/notes/existing-article/old-image.webp)",
    )
    .unwrap();
    // Create old image that should NOT be deleted
    let old_img_path = assets_dir.join("old-image.webp");
    let fake_webp = b"RIFF\x00\x00\x00\x00WEBP";
    fs::write(&old_img_path, fake_webp).unwrap();

    Command::new("git")
        .args(["add", "-A"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "add existing article with image"])
        .current_dir(dir.path())
        .output()
        .unwrap();

    // Now simulate a workspace that updates the article with a new image
    let png_path = PathBuf::from(FIXTURES_ROOT).join("valid-note/images/architecture.png");
    let png_bytes = fs::read(&png_path).unwrap();

    let source_md = create_source_md(
        dir.path(),
        "# Updated Article\n\n![New Image](./images/new-image.png)",
    );
    let imgs = source_md.parent().unwrap().join("images");
    fs::create_dir_all(&imgs).unwrap();
    fs::copy(&png_path, imgs.join("new-image.png")).unwrap();

    let ws_id = uuid::Uuid::new_v4().to_string();
    let ws_root = dir.path().join(".publish-workspaces").join(&ws_id);
    let ws_public = ws_root.join("public/assets/notes/existing-article");
    fs::create_dir_all(&ws_public).unwrap();

    let new_webp = ws_public.join("01-new-image.webp");
    {
        let img = image::load_from_memory(&png_bytes).unwrap();
        let mut out = fs::File::create(&new_webp).unwrap();
        img.write_to(&mut out, image::ImageFormat::WebP).unwrap();
    }

    let png_source_hash2 = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(&png_bytes))
    };
    let assets = vec![serde_json::json!({
        "reference_id": "img-001",
        "source_path": png_path.to_string_lossy().to_string(),
        "target_path": new_webp.to_string_lossy().to_string(),
        "public_path": "/assets/notes/existing-article/01-new-image.webp",
        "sha256": png_source_hash2,
        "status": "written",
        "mime_type": "image/webp",
        "size": fs::metadata(&new_webp).unwrap().len()
    })];

    let source_bytes = fs::read(&source_md).unwrap();
    let source_fp = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(&source_bytes))
    };
    let manifest = serde_json::json!({
        "version": 1,
        "workspace_id": ws_id,
        "created_at": "2026-07-30T11:00:00Z",
        "source_markdown_path": source_md.to_string_lossy().to_string(),
        "target_markdown_path": "content/ai-agent/langgraph/existing-article.md",
        "target_asset_directory": "public/assets/notes/existing-article",
        "archive_profile_id": "ai-agent-langgraph",
        "source_fingerprint": source_fp,
        "planned_changes": ["content/ai-agent/langgraph/existing-article.md", "public/assets/notes/existing-article"],
        "assets": assets
    });

    let ws_content = ws_root.join("content/ai-agent/langgraph");
    fs::create_dir_all(&ws_content).unwrap();
    fs::write(
        ws_content.join("existing-article.md"),
        "# Updated\n\n![New](/assets/notes/existing-article/01-new-image.webp)\n![Old](/assets/notes/existing-article/old-image.webp)",
    )
    .unwrap();

    fs::write(
        ws_root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let result = davinci_journey_desktop::services::repository_publish::apply_publish_workspace(
        davinci_journey_desktop::services::repository_publish::ApplyWorkspaceRequest {
            repository_root: dir.path().to_string_lossy().to_string(),
            workspace_id: ws_id,
            operation: "update".to_string(),
            archive_profile_changes: vec![],
        },
    );
    assert!(
        result.is_ok(),
        "Apply update should succeed: {:?}",
        result.err()
    );

    // Verify old image was NOT deleted
    assert!(
        old_img_path.exists(),
        "Old image should NOT be deleted on update"
    );
}
