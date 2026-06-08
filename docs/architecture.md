# Architecture

## Why a separate companion app

The dashboard is a browser PWA. Browsers can talk to USB printers (WebUSB) on Chrome/Edge, but:

- **Safari and Firefox don't support WebUSB at all.** A restaurant on an iPad or a Firefox-only IT policy can't print without a different path.
- **WebUSB pairing is per-tab-origin.** Re-pair every browser profile or after the cache is cleared.
- **No system print dialog is acceptable.** Operators tap "submit", paper comes out. Anything popping up in front of the cashier breaks the rhythm.

A local tray app behind `http://127.0.0.1:9177` solves all three. Any browser on the same machine can reach it; the OS keeps the USB device claimed regardless of which tab is open; pairing happens once in the tray window. The dashboard's bridge composable (`useSufraBridge`) is the only piece that knows about this server — everything downstream of `usePrinter` is transport-agnostic.

## Process layout

```
sufra-printer/  (the Tauri app's repo root)
├── src/                    ← Vue 3 + Vite — the webview UI for the tray window
│   ├── App.vue             ← single-pane settings + Recent prints + connected-store strip
│   ├── bridge.ts           ← typed fetch wrappers for the local HTTP server (yes, the webview also calls it)
│   ├── i18n.ts             ← AR (default) + EN, RTL-aware
│   └── assets/sufra-logo.png
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         ← entry; wires the tray + window + axum server
│   │   ├── lib.rs
│   │   ├── server.rs       ← axum router; all HTTP endpoints
│   │   ├── state.rs        ← AppState (printers, recent_jobs, connected_store) + dispatch_print
│   │   ├── printer.rs      ← rusb USB enumeration + bulk-OUT writes (sync, runs on spawn_blocking)
│   │   ├── escpos_text.rs  ← strips printable text out of an ESC/POS byte stream for the preview pane
│   │   └── config.rs       ← JSON config persisted next to the binary (printer mapping)
│   ├── tauri.conf.json
│   └── icons/              ← regenerated from sufra logo for tray + window + bundles
├── .github/workflows/release.yml  ← matrix CI (Windows + Linux) via tauri-action
├── README.md
└── docs/
```

## Runtime roles

Three concurrent things live in one process:

1. **The Tauri webview** — the small settings window with role mapping, Recent prints, and the connected-store badge. Hidden by default; shown when the user clicks the tray icon. Closing the window does NOT exit the app — the tray icon stays alive so the HTTP server keeps serving.
2. **The axum HTTP server** — listens on `127.0.0.1:9177` (loopback only, never on a public interface). Started inside a dedicated tokio runtime on app boot (`tauri::async_runtime::spawn`).
3. **USB I/O** — synchronous (rusb is blocking), so every actual write is offloaded with `tokio::task::spawn_blocking`. The dispatch path is in `state.rs:126-226`.

## State

`AppState` lives behind `Arc<AppState>` and is shared between every axum handler. Three `parking_lot::RwLock`-guarded fields:

| Field             | Holds                                                         | Persisted? |
| ----------------- | ------------------------------------------------------------- | ---------- |
| `printers`        | Role → vendor/product ID mapping                              | Yes — JSON in config dir (`config.rs`) |
| `recent_jobs`     | Ring buffer of the last 30 print jobs (with optional `previewHtml`) | No — process lifetime |
| `connected_store` | Last dashboard that called `POST /hello` (name, logo, uuid, last_seen) | No — auto-expires after 1 hour with no refresh |

Mock mode is implicit: if a print arrives for a role with no printer mapped, `dispatch_print` records a `mocked: true` job and returns success. This lets operators verify the dashboard wiring without hardware.

## Threading

- axum handlers run on tokio's multi-threaded runtime (tauri's default).
- `parking_lot::RwLock` rather than `std::sync::RwLock` — fair, no poisoning, fast contended read path. The lock is held for the duration of a `clone()` into the response, never across an `.await`.
- USB writes hop to a blocking thread via `spawn_blocking`. rusb's `Device::open` and `write_bulk` are synchronous; calling them on a tokio worker would starve the runtime under load.

## Bridge UI

The webview's job is settings + observability, not print orchestration. Everything it does it could equally do by `curl`-ing the local server. The Vue layer is just a friendlier surface for:

- **Role assignment** — dropdowns of discovered USB devices per role. Save POSTs `/config`.
- **Recent prints** — paginated cards with role, time (`07/06/2026 · 14:32:01`), byte size, mocked/printed/failed status, and an inline preview (HTML iframe if `previewHtml` is present, otherwise the text extracted by `escpos_text`).
- **Connected store badge** — shows the dashboard's store name + logo as last announced via `/hello`. Auto-hides after an hour of silence so a stale tab doesn't mislead the operator.
- **Live status** — health badge (online/offline of the bridge itself), per-role printer status.
- **Language toggle** — Arabic (default, RTL) / English.

## How a print job flows

```
dashboard browser
  ↓ POST http://127.0.0.1:9177/print  { role, format:"escpos", data, jobId, previewHtml? }
  ↓ axum: server.rs::print
  ↓ base64 decode → Vec<u8>
  ↓ AppState::dispatch_print(jobId, role, bytes, previewHtml)
       ↓ lookup printers.read().find(role)
       │
       ├── None → mock: record RecentJob{ mocked: true }, return Ok
       │
       └── Some(p) → tokio::spawn_blocking:
                       printer::write_escpos(vid, pid, &bytes)
                         ↓ rusb find by vid/pid
                         ↓ open + claim interface
                         ↓ write to bulk-OUT endpoint
                       returns bytes_written
                     ↓
                     record RecentJob{ mocked: false, printer, error? }
                     ↓ return Ok or Err(RecentJob)
  ↓ Json(PrintResponse{ ok, jobId, mocked?, code?, message? })
```

Per-job text extraction (for the Recent prints text preview when no HTML preview is attached) runs synchronously inside `dispatch_print` — it's a stateless scan of the byte stream, cheap.

## Persistence

- **`printers`** — written to a JSON file under Tauri's app config dir (`%APPDATA%\com.sufra.printer\config.json` on Windows). Read once on `AppState::new()`, rewritten on every `PUT /config`. See `config.rs`.
- **Everything else** — process-lifetime memory only. Recent jobs and the connected store survive only until the tray app is restarted.

The bridge intentionally does NOT persist print history. That's the dashboard's job (the Supabase `orders` table). The Recent prints pane is for "did my last test go through?", not audit.

## Boundaries

- **Loopback only.** axum binds `127.0.0.1:9177` — never `0.0.0.0`. A second device on the LAN cannot reach this bridge by design. The dashboard's per-device transport pref reflects this: pairing the bridge is an act done on the specific PC with the printer.
- **CORS permissive within loopback.** Any `localhost:*` / `127.0.0.1:*` origin is allowed plus `https://dashboard.sufra.app` and the bridge's own `tauri.localhost` webview. The reasoning is in `server.rs:96-102`: anyone with local access has bigger trust problems than a forged receipt.
- **No bearer tokens.** The browser-to-bridge link relies on CORS + loopback. The original plan included a paired bearer token; we dropped it because the trust model is "same machine, same user" and a token would have added pairing UX with no real gain.

## Cross-references

- HTTP endpoint reference → [http-contract.md](./http-contract.md)
- Print dispatch + mock mode + Recent prints → [print-flow.md](./print-flow.md)
- CI, bundle layout, dashboard discovery → [build-and-release.md](./build-and-release.md)
- Dashboard side (transport selection, `/hello` trigger, install UI) → `sufra-dashboard/docs/printing.md`
