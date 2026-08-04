//! GitHub Pages deployment tracking via the GitHub CLI (`gh`).
//!
//! Degrades gracefully when `gh` is unavailable or unauthenticated.

use serde::{Deserialize, Serialize};

pub const DEPLOY_WORKFLOW_NAME: &str = "Deploy Pages";

/// Overall deployment status for the UI timeline.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentPhase {
    NotStarted,
    Queued,
    InProgress,
    Success,
    Failed,
    Cancelled,
    Unknown,
}

/// A GitHub Actions workflow run matching a commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub database_id: Option<i64>,
    pub status: Option<String>,
    pub conclusion: Option<String>,
    pub url: Option<String>,
    pub head_sha: Option<String>,
    pub display_title: Option<String>,
}

/// Result of checking `gh` availability.
#[derive(Debug, Clone)]
pub enum GhAvailability {
    Available,
    NotInstalled,
    NotAuthenticated(String),
}

/// Check whether `gh` exists and is authenticated. Never prints tokens.
pub fn check_gh() -> GhAvailability {
    let which = crate::services::process_util::silent_command("gh")
        .arg("--version")
        .output();
    if which.is_err() {
        return GhAvailability::NotInstalled;
    }

    let auth = crate::services::process_util::silent_command("gh")
        .args(["auth", "status"])
        .output();
    match auth {
        Ok(out) if out.status.success() => GhAvailability::Available,
        Ok(_) => GhAvailability::NotAuthenticated("gh 已安装但未登录。".to_string()),
        Err(_) => GhAvailability::NotInstalled,
    }
}

/// List workflow runs for a specific commit via `gh run list`.
/// Returns `None` if `gh` is unavailable (caller should degrade).
pub fn list_runs_for_commit(
    commit_hash: &str,
    workflow_name: &str,
    branch: &str,
) -> Result<Vec<WorkflowRun>, GhAvailability> {
    if matches!(check_gh(), GhAvailability::NotInstalled) {
        return Err(GhAvailability::NotInstalled);
    }
    if matches!(check_gh(), GhAvailability::NotAuthenticated(_)) {
        return Err(GhAvailability::NotAuthenticated("gh 未登录。".to_string()));
    }

    let output = crate::services::process_util::silent_command("gh")
        .args([
            "run",
            "list",
            "--workflow",
            workflow_name,
            "--branch",
            branch,
            "--commit",
            commit_hash,
            "--json",
            "databaseId,status,conclusion,url,headSha,displayTitle",
            "--limit",
            "5",
        ])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            return Err(GhAvailability::NotAuthenticated(format!(
                "gh 查询失败：{}",
                stderr.trim()
            )));
        }
        Err(_) => return Err(GhAvailability::NotInstalled),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let runs: Vec<WorkflowRun> = serde_json::from_str(&stdout).unwrap_or_default();
    Ok(runs)
}

/// Find the workflow run whose head SHA matches the commit.
pub fn find_matching_run(commit_hash: &str, runs: &[WorkflowRun]) -> Option<WorkflowRun> {
    runs.iter()
        .find(|run| run.head_sha.as_deref() == Some(commit_hash))
        .cloned()
        .or_else(|| runs.first().cloned())
}

/// Get the latest status of a specific run.
pub fn get_run_status(run_id: i64) -> Result<WorkflowRun, GhAvailability> {
    if matches!(check_gh(), GhAvailability::NotInstalled) {
        return Err(GhAvailability::NotInstalled);
    }

    let output = crate::services::process_util::silent_command("gh")
        .args([
            "run",
            "view",
            &run_id.to_string(),
            "--json",
            "databaseId,status,conclusion,url,headSha,displayTitle",
        ])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            return Err(GhAvailability::NotAuthenticated(format!(
                "gh 查询失败：{}",
                stderr.trim()
            )));
        }
        Err(_) => return Err(GhAvailability::NotInstalled),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let run: WorkflowRun = serde_json::from_str(&stdout).unwrap_or(WorkflowRun {
        database_id: Some(run_id),
        status: None,
        conclusion: None,
        url: None,
        head_sha: None,
        display_title: None,
    });
    Ok(run)
}

/// Map a raw `gh` status/conclusion to a deployment phase.
pub fn map_phase(status: Option<&str>, conclusion: Option<&str>) -> DeploymentPhase {
    let status = status.unwrap_or("").to_lowercase();
    let conclusion = conclusion.unwrap_or("").to_lowercase();

    if status == "queued" {
        DeploymentPhase::Queued
    } else if status == "in_progress" {
        DeploymentPhase::InProgress
    } else if status == "completed" {
        match conclusion.as_str() {
            "success" => DeploymentPhase::Success,
            "failure" | "startup_failure" => DeploymentPhase::Failed,
            "cancelled" | "timed_out" => DeploymentPhase::Cancelled,
            _ => DeploymentPhase::Unknown,
        }
    } else {
        DeploymentPhase::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(status: &str, conclusion: &str, head_sha: &str) -> WorkflowRun {
        WorkflowRun {
            database_id: Some(1),
            status: Some(status.to_string()),
            conclusion: Some(conclusion.to_string()),
            url: Some("https://github.com/x".to_string()),
            head_sha: Some(head_sha.to_string()),
            display_title: Some("deploy".to_string()),
        }
    }

    #[test]
    fn maps_statuses() {
        assert_eq!(map_phase(Some("queued"), None), DeploymentPhase::Queued);
        assert_eq!(
            map_phase(Some("in_progress"), None),
            DeploymentPhase::InProgress
        );
        assert_eq!(
            map_phase(Some("completed"), Some("success")),
            DeploymentPhase::Success
        );
        assert_eq!(
            map_phase(Some("completed"), Some("failure")),
            DeploymentPhase::Failed
        );
        assert_eq!(
            map_phase(Some("completed"), Some("cancelled")),
            DeploymentPhase::Cancelled
        );
    }

    #[test]
    fn finds_matching_run_by_head_sha() {
        let runs = vec![
            run("completed", "success", "deadbeef"),
            run("completed", "failure", "cafebabe"),
        ];
        let matched = find_matching_run("deadbeef", &runs).unwrap();
        assert_eq!(matched.conclusion.as_deref(), Some("success"));
    }
}
