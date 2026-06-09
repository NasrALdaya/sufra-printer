use std::sync::Arc;

use crate::state::AppState;

const RELEASES_API: &str =
    "https://api.github.com/repos/NasrALdaya/sufra-printer/releases/latest";
const CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

pub async fn run(state: Arc<AppState>, app: tauri::AppHandle) {
    let mut notified_for: Option<String> = None;
    loop {
        if let Err(e) = check(&state, &app, &mut notified_for).await {
            tracing::warn!("update check failed: {e}");
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

async fn check(
    state: &AppState,
    app: &tauri::AppHandle,
    notified_for: &mut Option<String>,
) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("sufra-printer/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let resp: serde_json::Value = client
        .get(RELEASES_API)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let tag = resp["tag_name"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing tag_name in GitHub response"))?;

    let latest = tag.trim_start_matches('v').to_string();
    let current = env!("CARGO_PKG_VERSION");

    tracing::debug!(latest = %latest, current = %current, "update check complete");

    state.set_latest_version(latest.clone());

    if is_newer(&latest, current) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(
                format!("Sufra Printer — Update available: v{latest}").as_str(),
            ));
        }

        if notified_for.as_deref() != Some(&latest) {
            *notified_for = Some(latest.clone());
            send_notification(app, &latest);
        }
    }

    Ok(())
}

fn send_notification(app: &tauri::AppHandle, latest: &str) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app
        .notification()
        .builder()
        .title("Sufra Printer — Update Available")
        .body(format!("v{latest} is ready to download."))
        .show()
    {
        tracing::warn!("desktop notification failed: {e}");
    }
}

/// Returns true if `candidate` is a higher semver than `current`.
/// Compares only the three numeric components (major.minor.patch).
pub(crate) fn is_newer(candidate: &str, current: &str) -> bool {
    fn parse(v: &str) -> (u64, u64, u64) {
        let mut parts = v.splitn(3, '.').map(|p| p.parse::<u64>().unwrap_or(0));
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    }
    parse(candidate) > parse(current)
}
