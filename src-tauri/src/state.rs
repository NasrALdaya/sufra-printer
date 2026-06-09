use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use serde::Serialize;

use crate::{config, escpos_text, printer};

const RECENT_JOBS_CAP: usize = 30;

#[derive(Clone, Debug)]
pub struct PrinterConfig {
    pub role: String,
    pub name: String,
    pub vendor_id: u16,
    pub product_id: u16,
}

#[derive(Serialize)]
pub struct PrinterStatus {
    pub role: String,
    pub name: String,
    pub status: &'static str,
}

#[derive(Clone, Serialize)]
pub struct RecentJob {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub role: String,
    #[serde(rename = "receivedAt")]
    pub received_at: u64,
    pub bytes: usize,
    pub mocked: bool,
    pub printer: Option<String>,
    pub preview: String,
    #[serde(rename = "previewHtml", skip_serializing_if = "Option::is_none")]
    pub preview_html: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct ConnectedStore {
    pub name: String,
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(rename = "uuid", skip_serializing_if = "Option::is_none")]
    pub uuid: Option<String>,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: u64,
}

pub struct AppState {
    printers: RwLock<Vec<PrinterConfig>>,
    recent_jobs: RwLock<VecDeque<RecentJob>>,
    /// Last dashboard that called POST /hello on this bridge. Treated as
    /// "the connected store" in the UI. Cleared after an hour with no
    /// new hello to avoid showing stale info.
    connected_store: RwLock<Option<ConnectedStore>>,
    /// Latest release tag (without "v" prefix) fetched from GitHub.
    /// None until the first update check completes.
    latest_version: RwLock<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        let stored = config::load();
        let printers = stored.printers.into_iter().map(Into::into).collect();
        Self {
            printers: RwLock::new(printers),
            recent_jobs: RwLock::new(VecDeque::with_capacity(RECENT_JOBS_CAP)),
            connected_store: RwLock::new(None),
            latest_version: RwLock::new(None),
        }
    }

    pub fn connected_store(&self) -> Option<ConnectedStore> {
        let store = self.connected_store.read().clone()?;
        // Hide after an hour without a refresh — keeps stale info from
        // lingering when the dashboard tab is closed for a while.
        if now_ms().saturating_sub(store.last_seen_at) > 60 * 60 * 1000 {
            return None;
        }
        Some(store)
    }

    pub fn latest_version(&self) -> Option<String> {
        self.latest_version.read().clone()
    }

    pub fn set_latest_version(&self, version: String) {
        *self.latest_version.write() = Some(version);
    }

    pub fn set_connected_store(&self, name: String, logo_url: Option<String>, uuid: Option<String>) {
        *self.connected_store.write() = Some(ConnectedStore {
            name,
            logo_url,
            uuid,
            last_seen_at: now_ms(),
        });
    }

    pub fn printers(&self) -> Vec<PrinterConfig> {
        self.printers.read().clone()
    }

    pub fn recent_jobs(&self) -> Vec<RecentJob> {
        self.recent_jobs.read().iter().rev().cloned().collect()
    }

    pub fn replace_printers(&self, new_printers: Vec<PrinterConfig>) -> anyhow::Result<()> {
        *self.printers.write() = new_printers.clone();
        let stored = config::StoredConfig {
            printers: new_printers.iter().map(Into::into).collect(),
        };
        config::save(&stored)
    }

    pub fn printer_statuses(&self) -> Vec<PrinterStatus> {
        let configs: Vec<PrinterConfig> = self.printers.read().clone();
        let connected = printer::list_printers().unwrap_or_default();
        configs
            .into_iter()
            .map(|p| {
                let online = connected
                    .iter()
                    .any(|d| d.vendor_id == p.vendor_id && d.product_id == p.product_id);
                PrinterStatus {
                    role: p.role,
                    name: p.name,
                    status: if online { "online" } else { "offline" },
                }
            })
            .collect()
    }

    pub async fn dispatch_print(
        &self,
        job_id: String,
        role: String,
        bytes: Vec<u8>,
        preview_html: Option<String>,
    ) -> Result<RecentJob, RecentJob> {
        let config = self
            .printers
            .read()
            .iter()
            .find(|p| p.role == role)
            .cloned();

        let preview = escpos_text::extract_text(&bytes);
        let received_at = now_ms();
        let byte_count = bytes.len();

        match config {
            // No printer mapped — record as mocked, succeed
            None => {
                let job = RecentJob {
                    job_id,
                    role,
                    received_at,
                    bytes: byte_count,
                    mocked: true,
                    printer: None,
                    preview,
                    preview_html,
                    error: None,
                };
                tracing::info!(
                    job_id = %job.job_id,
                    role = %job.role,
                    bytes = byte_count,
                    "mocked print (no printer mapped)"
                );
                self.push_job(job.clone());
                Ok(job)
            }
            Some(p) => {
                let vid = p.vendor_id;
                let pid = p.product_id;
                let name = p.name.clone();

                let result = tokio::task::spawn_blocking(move || {
                    printer::write_escpos(vid, pid, &bytes)
                })
                .await
                .map_err(|e| anyhow::anyhow!("print task panicked: {e}"))
                .and_then(|inner| inner);

                match result {
                    Ok(written) => {
                        tracing::info!(
                            role = %role,
                            printer = %name,
                            bytes_in = byte_count,
                            bytes_written = written,
                            "print ok"
                        );
                        let job = RecentJob {
                            job_id,
                            role,
                            received_at,
                            bytes: byte_count,
                            mocked: false,
                            printer: Some(name),
                            preview,
                            preview_html,
                            error: None,
                        };
                        self.push_job(job.clone());
                        Ok(job)
                    }
                    Err(e) => {
                        tracing::warn!(
                            role = %role,
                            printer = %name,
                            error = %e,
                            "print failed"
                        );
                        let job = RecentJob {
                            job_id,
                            role,
                            received_at,
                            bytes: byte_count,
                            mocked: false,
                            printer: Some(name),
                            preview,
                            preview_html,
                            error: Some(e.to_string()),
                        };
                        self.push_job(job.clone());
                        Err(job)
                    }
                }
            }
        }
    }

    fn push_job(&self, job: RecentJob) {
        let mut jobs = self.recent_jobs.write();
        if jobs.len() == RECENT_JOBS_CAP {
            jobs.pop_front();
        }
        jobs.push_back(job);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
