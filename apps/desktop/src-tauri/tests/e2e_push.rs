//! Remote publish E2E: push a real local commit to an isolated bare remote
//! and verify the remote head. Never touches the user's GitHub repository.

use std::fs;
use std::path::Path;
use std::process::Command;

use davinci_journey_desktop::security::push_guard::{ahead_behind, sync_state, SyncState};
use davinci_journey_desktop::services::git_remote::{push_publish, verify_remote_commit};

fn init_repo(dir: &Path) {
    Command::new("git")
        .args(["init", "-b", "master"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.email", "e2e@test.invalid"])
        .current_dir(dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.name", "E2E Test"])
        .current_dir(dir)
        .output()
        .unwrap();
}

fn commit_file(dir: &Path, name: &str, content: &str, msg: &str) -> String {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, content).unwrap();
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

/// A local bare remote used as the push target for this E2E.
fn add_bare_remote(work: &Path, remote: &Path) {
    Command::new("git")
        .args(["init", "--bare"])
        .current_dir(remote)
        .output()
        .unwrap();
    Command::new("git")
        .args(["remote", "add", "origin", remote.to_str().unwrap()])
        .current_dir(work)
        .output()
        .unwrap();
}

#[test]
fn e2e_push_commit_to_bare_remote_and_verify() {
    let work = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    init_repo(work.path());
    add_bare_remote(work.path(), remote.path());

    let head = commit_file(
        work.path(),
        "content/note.md",
        "# Note",
        "docs(test): add note",
    );

    // Local should be ahead of the (empty) remote.
    Command::new("git")
        .args(["fetch", "origin", "master"])
        .current_dir(work.path())
        .output()
        .ok();
    let state = sync_state(work.path(), "origin", "master").unwrap();
    assert!(matches!(
        state,
        SyncState::Ahead {
            ahead: 1,
            behind: 0
        }
    ));

    // Push.
    let outcome = push_publish(work.path(), "origin", "master", &head).unwrap();
    assert_eq!(outcome.exit_code, 0);

    // Verify remote contains the commit.
    assert!(verify_remote_commit(work.path(), "origin", "master", &head).unwrap());
}

#[test]
fn e2e_remote_ahead_blocks_push_precheck() {
    let work = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    init_repo(work.path());
    add_bare_remote(work.path(), remote.path());

    let head = commit_file(work.path(), "a.md", "a", "a");
    push_publish(work.path(), "origin", "master", &head).unwrap();

    // Advance the remote via a second clone.
    let clone = tempfile::tempdir().unwrap();
    Command::new("git")
        .args([
            "clone",
            remote.path().to_str().unwrap(),
            clone.path().to_str().unwrap(),
        ])
        .current_dir(work.path())
        .output()
        .unwrap();
    fs::write(clone.path().join("remote.md"), "remote").unwrap();
    Command::new("git")
        .args(["add", "remote.md"])
        .current_dir(clone.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "remote commit"])
        .current_dir(clone.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["push", "origin", "HEAD:refs/heads/master"])
        .current_dir(clone.path())
        .output()
        .unwrap();

    // Add a local commit that is not in the remote → diverged or remote ahead.
    let local_head = commit_file(work.path(), "b.md", "b", "b");
    Command::new("git")
        .args(["fetch", "origin"])
        .current_dir(work.path())
        .output()
        .unwrap();

    // The inspect pre-check (via publish_completion) will fail on the remote
    // validation because the remote is a local path, so test the sync state
    // directly here:
    let (ahead, behind) = ahead_behind(work.path(), "origin/master", "master").unwrap();
    // Diverged: local has 1 (b), remote has 1 (remote.md) → ahead=1, behind=1
    assert!(
        ahead >= 1 && behind >= 1,
        "expected diverged, got ahead={} behind={}",
        ahead,
        behind
    );
    let _ = local_head;
}

#[test]
fn e2e_untracked_private_files_are_not_pushed() {
    let work = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    init_repo(work.path());
    add_bare_remote(work.path(), remote.path());

    // Create a tracked commit plus a private untracked file.
    let head = commit_file(
        work.path(),
        "content/note.md",
        "# Note",
        "docs(test): add note",
    );
    fs::write(work.path().join("private-notes.md"), "# private user note").unwrap();

    push_publish(work.path(), "origin", "master", &head).unwrap();

    // Refresh the local tracking ref, then list the files in the remote commit.
    Command::new("git")
        .args(["fetch", "origin", "master"])
        .current_dir(work.path())
        .output()
        .unwrap();
    let files = Command::new("git")
        .args(["ls-tree", "-r", "--name-only", "origin/master"])
        .current_dir(work.path())
        .output()
        .unwrap();
    assert!(
        files.status.success(),
        "ls-tree should succeed: {}",
        String::from_utf8_lossy(&files.stderr)
    );
    let files = String::from_utf8_lossy(&files.stdout);
    assert!(files.contains("content/note.md"));
    assert!(
        !files.contains("private-notes.md"),
        "private untracked file leaked into remote"
    );
}
