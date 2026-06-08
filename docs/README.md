# Sufra Printer — Documentation

The companion tray app that gives the Sufra Dashboard silent thermal printing — no system print dialog, no browser USB pairing, works fully offline.

A small Tauri (Rust + Vue) app runs in the system tray and exposes `http://127.0.0.1:9177`. The dashboard browser POSTs ESC/POS bytes; the bridge dispatches them to the right physical printer based on a role (`pos` or `kitchen`).

These docs are written for collaborators who already know Tauri + axum. They focus on *why* this app exists as a separate process and the decisions that shape it — not on re-explaining the frameworks.

## Suggested reading order

1. **[architecture.md](./architecture.md)** — process layout (Rust backend, Vue webview, HTTP server), state, threading model.
2. **[http-contract.md](./http-contract.md)** — every endpoint, request/response shapes, CORS rules, error codes.
3. **[print-flow.md](./print-flow.md)** — what happens between `POST /print` and the printer cutting paper; mock mode; recent jobs.
4. **[build-and-release.md](./build-and-release.md)** — CI matrix, bundle outputs, how the dashboard discovers them.

## At a glance

| Topic                                | Where it lives                                        |
| ------------------------------------ | ----------------------------------------------------- |
| Why a separate companion app         | [architecture.md](./architecture.md) → "Why"          |
| HTTP endpoint reference              | [http-contract.md](./http-contract.md)                |
| How mock mode works                  | [print-flow.md](./print-flow.md) → "Mock dispatch"    |
| Connected-store strip (`/hello`)     | [http-contract.md](./http-contract.md) → "/hello"     |
| Adding a new endpoint                | [http-contract.md](./http-contract.md) → "Adding routes" |
| Building a release                   | [build-and-release.md](./build-and-release.md)        |

## Companion docs in the dashboard

The browser side of this story lives in `sufra-dashboard/docs/printing.md`. Read it for transport selection, the WebUSB fallback, and how the dashboard triggers `/hello`.

## Out of scope

- The Laravel API at `sufra-dashboard-api/` (unused).
- The customer menu app, admin site, marketing site.
- Database schema (Supabase) — the bridge never touches Supabase directly.
