# HTTP contract

All endpoints live at `http://127.0.0.1:9177`. The server is loopback-bound and CORS-gated; no auth tokens. See [architecture.md](./architecture.md) → "Boundaries" for the trust model.

Every JSON response uses camelCase keys (Rust types use `#[serde(rename = "...")]` where needed). Errors are JSON with `ok: false`, a stable string `code`, and a human `message`.

## Endpoint reference

| Method | Path       | Sent by                          | Returns                                              |
| ------ | ---------- | -------------------------------- | ---------------------------------------------------- |
| GET    | `/health`  | Dashboard probe (every 30s), webview | Liveness, version, printer roles + status, connected store |
| GET    | `/devices` | Webview only                     | List of USB devices discovered via rusb              |
| GET    | `/config`  | Webview only                     | Current role → device mapping                        |
| PUT    | `/config`  | Webview only                     | Replace the role mapping                             |
| GET    | `/jobs`    | Webview only                     | Recent print jobs (most recent first, cap 30)        |
| POST   | `/hello`   | Dashboard (on bridge-online)     | Acknowledges; updates `connected_store` in state     |
| POST   | `/print`   | Dashboard                        | Dispatches ESC/POS bytes to the role's printer       |

## `GET /health`

```jsonc
{
  "ok": true,
  "version": "0.1.0",
  "printers": [
    { "role": "pos",     "name": "EPSON TM-T20III", "status": "online"  },
    { "role": "kitchen", "name": "Star TSP143",     "status": "offline" }
  ],
  "connectedStore": {                       // omitted when no recent /hello
    "name": "Sufra HQ",
    "logoUrl": "https://.../logo.png",      // omitted when null
    "uuid": "0c4f...",                      // omitted when null
    "lastSeenAt": 1717787521000
  }
}
```

- `printers[].status` is computed live: a configured printer is `online` only if rusb currently lists a matching vendor/product ID.
- `connectedStore` is dropped after 1 hour with no fresh `/hello` (see `state.rs:73-81`). Prevents a closed dashboard tab from looking like an active connection.

## `POST /hello`

```jsonc
// request
{
  "name": "Sufra HQ",          // required
  "logoUrl": "https://...",    // optional
  "uuid": "0c4f-..."           // optional
}
// response
{ "ok": true }
```

Idempotent — the bridge just overwrites its `connected_store` slot. The dashboard fires this on every `bridgeOnline` flip (see `useSufraBridge.hello` and the watch in `usePrinterTransport.ts:103-115`).

The bridge's connected-store badge reads off `health.connectedStore` and refreshes whenever the webview polls `/health`. The dashboard does not need to call `/hello` repeatedly; one call per session is enough as long as the user keeps a dashboard tab open. Network failures are non-fatal — see `useSufraBridge.hello`'s empty catch.

## `POST /print`

```jsonc
// request
{
  "role": "pos",               // "pos" | "kitchen"
  "format": "escpos",          // only "escpos" is accepted
  "data": "G0AbYQE...",        // base64 of the ESC/POS byte stream
  "jobId": "5e9f-...",         // surfaced in logs + Recent prints
  "previewHtml": "<!doctype html>..."   // optional, for the webview preview pane
}
// success
{ "ok": true,  "jobId": "5e9f-...", "mocked": false }
// success in mock mode (no printer mapped to role)
{ "ok": true,  "jobId": "5e9f-...", "mocked": true }
// failure
{ "ok": false, "jobId": "5e9f-...", "mocked": false, "code": "print_failed", "message": "..." }
```

Error codes:

| Code                  | Meaning                                                       |
| --------------------- | ------------------------------------------------------------- |
| `unsupported_format`  | `format` is not `"escpos"`.                                   |
| `invalid_base64`      | `data` failed to decode.                                      |
| `print_failed`        | USB write returned an error or the printer reported a failure. |

`previewHtml` is stored verbatim with the recorded `RecentJob` and rendered in the webview inside a sandboxed `<iframe srcdoc>`. The server never executes or parses it. If the dashboard sends a preview, the webview shows the rich HTML; if not, the webview shows the text extracted from the ESC/POS stream by `escpos_text::extract_text`.

## `GET /devices`

```jsonc
{
  "ok": true,
  "devices": [
    { "vendor_id": 1208, "product_id": 514, "name": "EPSON TM-T20III" }
  ]
}
```

Enumerates anything advertising the USB printer class (0x07) via rusb. Runs on a blocking task because rusb is sync.

## `GET /config` and `PUT /config`

```jsonc
// GET response
{
  "ok": true,
  "printers": [
    { "role": "pos",     "name": "EPSON TM-T20III", "vendorId": 1208, "productId": 514 },
    { "role": "kitchen", "name": "Star TSP143",     "vendorId": 1305, "productId": 514 }
  ]
}

// PUT request — same shape as the printers array above
// PUT validates role ∈ {"pos","kitchen"} and persists to config.json
```

Rejection on bad role:

```jsonc
{ "ok": false, "code": "invalid_role", "message": "role must be 'pos' or 'kitchen', got 'foo'" }
```

## `GET /jobs`

```jsonc
{
  "ok": true,
  "jobs": [
    {
      "jobId": "5e9f-...",
      "role": "pos",
      "receivedAt": 1717787521000,
      "bytes": 412,
      "mocked": false,
      "printer": "EPSON TM-T20III",
      "preview": "Order #123\n2 x Margherita\nTOTAL ...",
      "previewHtml": "<!doctype html>...",   // present only when the dashboard sent it
      "error": null
    }
  ]
}
```

Returned newest-first. Capped at 30 (`state.rs:9`).

## CORS

Permissive within loopback. The full allow logic is in `server.rs:96-115`:

- `https://dashboard.sufra.app` (production dashboard origin).
- `http://tauri.localhost` / `https://tauri.localhost` (the bridge's own webview origin under Tauri 2).
- Any `http://localhost:*`, `https://localhost:*`, `http://127.0.0.1:*`, `https://127.0.0.1:*`.

Allowed methods: `GET`, `POST`. Allowed header: `Content-Type`. Preflight max-age: 600s.

## Adding a route

1. Define the request/response structs in `server.rs` with `#[derive(Deserialize)]` / `#[derive(Serialize)]`. Use `#[serde(rename = "camelCase")]` per-field when the Rust name differs (we don't blanket-apply `rename_all` so the rename is explicit at every call site).
2. Add the handler `async fn name(State(state): State<Arc<AppState>>, ...) -> impl IntoResponse`.
3. Mount it on the `Router` in `run()` alongside the existing routes.
4. If the handler does blocking work (file I/O, USB), use `tokio::task::spawn_blocking` — never `.await`-block tokio workers.
5. Update this doc and `useSufraBridge.ts` on the dashboard side if the endpoint is browser-facing.

## Versioning

The bridge does not version its HTTP surface today. `/health.version` reports the Cargo package version so the dashboard can detect old installs and prompt for an upgrade — see `useBridgeReleases` on the dashboard side. If we ever need to ship a breaking change, prefix-route under `/v2/*` and keep `/print`/`/health` working until the dashboard's minimum supported version moves.
