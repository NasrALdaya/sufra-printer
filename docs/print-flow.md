# Print flow

What happens between `POST /print` arriving on the bridge and paper coming out of (or not coming out of) the printer.

The full path is in `src-tauri/src/state.rs::dispatch_print` (lines 126-226) and `src-tauri/src/printer.rs::write_escpos`. This doc is the narrative version.

## The two outcomes

For every accepted request, the bridge records exactly one `RecentJob` and returns one HTTP response. Outcomes:

| Outcome  | When                                              | `mocked` | `error`              | HTTP   |
| -------- | ------------------------------------------------- | -------- | -------------------- | ------ |
| Printed  | Role mapped to a connected printer; write OK      | `false`  | `null`               | 200    |
| Failed   | Role mapped, but rusb open / write returned an error | `false`  | message              | 500    |
| Mocked   | Role has no mapped printer in config              | `true`   | `null`               | 200    |

Mock mode is not a flag — it's the default behavior when no printer is mapped to a role. This is what lets operators verify "did the dashboard wire up correctly?" with zero hardware: the bridge accepts the request, runs the same code path up to the dispatch, records a job, and surfaces it in the webview's Recent prints pane.

## Step by step

```
POST /print { role, format, data:base64, jobId, previewHtml? }
  │
  ├─ format != "escpos"  → 400 unsupported_format        (server.rs)
  ├─ base64 decode fail  → 400 invalid_base64            (server.rs)
  │
  ▼
state.dispatch_print(jobId, role, bytes, previewHtml)    (state.rs:126)
  │
  ├─ config = printers.read().find(|p| p.role == role)
  ├─ preview = escpos_text::extract_text(&bytes)         ← always; for the text fallback in Recent prints
  ├─ received_at = now_ms()
  │
  ├─ config is None
  │     └─ RecentJob{ mocked: true, printer: None, preview, previewHtml, error: None }
  │        push_job; return Ok(job)                      → 200 { ok:true, mocked:true }
  │
  └─ config is Some(p)
        │
        ├─ spawn_blocking(|| printer::write_escpos(p.vendor_id, p.product_id, &bytes))
        │     ├─ rusb::devices().find(vid, pid)
        │     ├─ device.open()
        │     ├─ device.claim_interface(0)
        │     ├─ find bulk-OUT endpoint on interface 0
        │     ├─ write_bulk(ep, &bytes, timeout)
        │     └─ returns bytes_written
        │
        ├─ Ok(written)
        │     └─ RecentJob{ mocked: false, printer: Some(p.name), preview, previewHtml, error: None }
        │        push_job; return Ok(job)                → 200 { ok:true, mocked:false }
        │
        └─ Err(e)
              └─ RecentJob{ mocked: false, printer: Some(p.name), preview, previewHtml, error: Some(e) }
                 push_job; return Err(job)               → 500 { ok:false, code:"print_failed", message:e }
```

## Why `spawn_blocking`

rusb is synchronous — `open`, `claim_interface`, `write_bulk` are blocking syscalls. Calling them on a tokio worker thread would starve other handlers (the periodic `/health` probe, an in-flight `/hello`). `tokio::task::spawn_blocking` hands the work to tokio's blocking pool, leaving the multi-threaded runtime free for I/O.

The same reasoning applies to `/devices` (also wraps `printer::list_printers` in `spawn_blocking`) and the `connected` enumeration inside `printer_statuses()` — though that one runs inline because it's quick and only fires on `/health`.

## The text preview

The webview's Recent prints pane needs to show *something* meaningful when no `previewHtml` is attached. `escpos_text::extract_text` runs a stateless scan of the byte stream and pulls out printable runs, skipping ESC/POS command sequences. Result is a single string stored on the `RecentJob`.

When the dashboard sends `previewHtml`, the webview uses it instead — the text fallback is still recorded but hidden. The dashboard's `<InvoicePreview />` produces a faithful HTML render that matches the on-screen invoice exactly; see `sufra-dashboard/docs/printing.md` → "Receipt rendering parity".

## Job retention

`recent_jobs` is a `VecDeque<RecentJob>` capped at 30 (`state.rs:9`). On overflow, the oldest entry is popped before the new one is pushed (`push_job`, `state.rs:228-234`). The cap is process-lifetime: restarting the tray app clears history.

If you need long-term print history, it lives in the dashboard's `orders` table (Supabase). The bridge intentionally does not persist jobs — duplicating that surface would add a sync problem with zero customer value.

## Logging

Every meaningful event logs a `tracing` event with structured fields:

- `print job received` — info, with `job_id`, `role`, `bytes` (request landed).
- `mocked print (no printer mapped)` — info, fires on the no-config branch.
- `print ok` — info, with `bytes_in` and `bytes_written` (matches a happy USB transaction).
- `print failed` — warn, with the rusb error.

Run `pnpm tauri dev` to see them on stdout. The released bundle's stdout is captured by Tauri's default log target (a rotating file under the app's local data dir on Windows; `~/.local/share/com.sufra.printer/` on Linux).

## What the dashboard expects back

The dashboard's `useSufraBridge.print` (in `sufra-dashboard/app/composables/useSufraBridge.ts`) only treats `r.ok === true` HTTP as success. `mocked: true` is *also* success — the dashboard does not distinguish "printed" from "mocked" at the call site. The distinction only matters in the bridge's own Recent prints UI, where operators want to confirm whether hardware actually fired.

A 500 with `code: "print_failed"` flips `bridgeOnline` to true (the bridge is reachable) but surfaces `lastError` to the dashboard's offline banner so the operator knows printing didn't go through. A network-level failure (timeout, connection refused) flips `bridgeOnline` to false, which triggers the dashboard's "bridge not running" UI.

## Cross-references

- HTTP request/response shapes → [http-contract.md](./http-contract.md)
- Why the bridge exists at all + state model → [architecture.md](./architecture.md)
- Browser side (transport selection, ESC/POS byte builder) → `sufra-dashboard/docs/printing.md`
