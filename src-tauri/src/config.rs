use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::state::PrinterConfig;

const CONFIG_DIR_NAME: &str = "Safra Printer";
const CONFIG_FILE_NAME: &str = "config.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StoredConfig {
    #[serde(default)]
    pub printers: Vec<StoredPrinter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPrinter {
    pub role: String,
    pub name: String,
    #[serde(rename = "vendorId")]
    pub vendor_id: u16,
    #[serde(rename = "productId")]
    pub product_id: u16,
}

impl From<&PrinterConfig> for StoredPrinter {
    fn from(p: &PrinterConfig) -> Self {
        Self {
            role: p.role.clone(),
            name: p.name.clone(),
            vendor_id: p.vendor_id,
            product_id: p.product_id,
        }
    }
}

impl From<StoredPrinter> for PrinterConfig {
    fn from(p: StoredPrinter) -> Self {
        Self {
            role: p.role,
            name: p.name,
            vendor_id: p.vendor_id,
            product_id: p.product_id,
        }
    }
}

/// Resolve the on-disk config path. Windows: `%APPDATA%\Safra Printer\config.json`,
/// Linux: `~/.config/Safra Printer/config.json`, macOS: `~/Library/Application Support/Safra Printer/config.json`.
pub fn config_path() -> anyhow::Result<PathBuf> {
    let dir = dirs::config_dir().context("could not resolve config dir for current user")?;
    Ok(dir.join(CONFIG_DIR_NAME).join(CONFIG_FILE_NAME))
}

pub fn load() -> StoredConfig {
    let Ok(path) = config_path() else {
        return StoredConfig::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return StoredConfig::default();
    };
    match serde_json::from_str::<StoredConfig>(&raw) {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::warn!("config at {} is malformed ({e}); using defaults", path.display());
            StoredConfig::default()
        }
    }
}

pub fn save(cfg: &StoredConfig) -> anyhow::Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let pretty = serde_json::to_string_pretty(cfg).context("serialize config")?;
    fs::write(&path, pretty).with_context(|| format!("write {}", path.display()))?;
    tracing::info!("saved config to {}", path.display());
    Ok(())
}

fn ensure_dir(p: &Path) -> anyhow::Result<()> {
    if !p.exists() {
        fs::create_dir_all(p).with_context(|| format!("create dir {}", p.display()))?;
    }
    Ok(())
}
