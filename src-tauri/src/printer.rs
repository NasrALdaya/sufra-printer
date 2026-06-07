use std::time::Duration;

use anyhow::{anyhow, Context};
use rusb::{Device, Direction, GlobalContext, TransferType};
use serde::Serialize;

const PRINTER_CLASS: u8 = 0x07;
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const STRING_DESCRIPTOR_TIMEOUT: Duration = Duration::from_millis(250);

/// A USB device that exposes a USB printer-class interface (0x07).
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredPrinter {
    pub vendor_id: u16,
    pub product_id: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
}

impl DiscoveredPrinter {
    /// Best-effort human-readable label, e.g. "Epson TM-T20III (04b8:0e28)".
    /// Used by the settings UI (task #5) — silenced until then.
    #[allow(dead_code)]
    pub fn display_name(&self) -> String {
        let m = self.manufacturer.as_deref().unwrap_or("").trim();
        let p = self.product.as_deref().unwrap_or("").trim();
        let pretty = match (m.is_empty(), p.is_empty()) {
            (false, false) => format!("{m} {p}"),
            (true, false) => p.to_string(),
            (false, true) => m.to_string(),
            (true, true) => "USB printer".to_string(),
        };
        format!("{pretty} ({:04x}:{:04x})", self.vendor_id, self.product_id)
    }
}

/// Enumerate every USB device on the system that advertises a printer-class
/// interface. Used by the settings UI (task #5) to populate the role→device
/// mapping picker.
pub fn list_printers() -> anyhow::Result<Vec<DiscoveredPrinter>> {
    let mut out = Vec::new();
    for device in rusb::devices()?.iter() {
        if !device_is_printer(&device) {
            continue;
        }
        let desc = match device.device_descriptor() {
            Ok(d) => d,
            Err(_) => continue,
        };
        let (manufacturer, product, serial) = read_strings(&device, &desc);
        out.push(DiscoveredPrinter {
            vendor_id: desc.vendor_id(),
            product_id: desc.product_id(),
            manufacturer,
            product,
            serial,
        });
    }
    Ok(out)
}

fn device_is_printer(device: &Device<GlobalContext>) -> bool {
    let Ok(config) = device.active_config_descriptor() else {
        return false;
    };
    config
        .interfaces()
        .flat_map(|i| i.descriptors())
        .any(|d| d.class_code() == PRINTER_CLASS)
}

fn read_strings(
    device: &Device<GlobalContext>,
    desc: &rusb::DeviceDescriptor,
) -> (Option<String>, Option<String>, Option<String>) {
    // Opening the device is best-effort — if it's claimed by the printer
    // driver we just return empty strings and the caller falls back to
    // a generic label.
    let Ok(handle) = device.open() else {
        return (None, None, None);
    };
    let lang = handle
        .read_languages(STRING_DESCRIPTOR_TIMEOUT)
        .ok()
        .and_then(|langs| langs.into_iter().next());
    let Some(lang) = lang else {
        return (None, None, None);
    };
    let m = handle
        .read_manufacturer_string(lang, desc, STRING_DESCRIPTOR_TIMEOUT)
        .ok();
    let p = handle
        .read_product_string(lang, desc, STRING_DESCRIPTOR_TIMEOUT)
        .ok();
    let s = handle
        .read_serial_number_string(lang, desc, STRING_DESCRIPTOR_TIMEOUT)
        .ok();
    (m, p, s)
}

/// Open a USB printer by VID/PID, find its bulk-OUT endpoint, write the
/// ESC/POS payload, and release the interface. Slow path (~50 ms) per print
/// but avoids keeping handles open and dealing with disconnect races.
pub fn write_escpos(vendor_id: u16, product_id: u16, bytes: &[u8]) -> anyhow::Result<usize> {
    let device = rusb::devices()?
        .iter()
        .find(|d| {
            d.device_descriptor()
                .map(|desc| desc.vendor_id() == vendor_id && desc.product_id() == product_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            anyhow!(
                "printer {:04x}:{:04x} not found on this PC",
                vendor_id,
                product_id
            )
        })?;

    let config = device
        .active_config_descriptor()
        .context("read active config descriptor")?;
    let mut interface_no: Option<u8> = None;
    let mut endpoint: Option<u8> = None;
    'outer: for iface in config.interfaces() {
        for d in iface.descriptors() {
            if d.class_code() != PRINTER_CLASS {
                continue;
            }
            for ep in d.endpoint_descriptors() {
                if ep.direction() == Direction::Out && ep.transfer_type() == TransferType::Bulk {
                    interface_no = Some(d.interface_number());
                    endpoint = Some(ep.address());
                    break 'outer;
                }
            }
        }
    }
    let interface_no = interface_no
        .ok_or_else(|| anyhow!("device has no printer-class interface with a bulk-OUT endpoint"))?;
    let endpoint = endpoint.expect("endpoint set when interface_no set");

    let handle = device.open().context("open USB device")?;

    #[cfg(target_os = "linux")]
    {
        if handle.kernel_driver_active(interface_no).unwrap_or(false) {
            let _ = handle.detach_kernel_driver(interface_no);
        }
    }

    handle
        .claim_interface(interface_no)
        .context("claim USB interface")?;

    let written = handle
        .write_bulk(endpoint, bytes, WRITE_TIMEOUT)
        .context("write ESC/POS bytes to bulk-OUT endpoint")?;

    let _ = handle.release_interface(interface_no);
    Ok(written)
}
