# Sufra Printer

Silent ESC/POS thermal printer bridge for the [Sufra](https://sufra.app) restaurant dashboard.

A small Tauri tray app that runs on the restaurant PC and exposes
`http://127.0.0.1:9177` so the dashboard browser can print receipts and
kitchen tickets without ever showing the system print dialog. **Works fully
offline** — no Sufra server involvement; CORS to the dashboard origin is the
trust boundary.

> Full architecture, decisions, and progress live in
> [`PRINTER_BRIDGE_PLAN.md`](../sufra/PRINTER_BRIDGE_PLAN.md) in the sibling
> `sufra` monorepo. Read that doc before contributing.

## Development

Prerequisites: Rust 1.96+, Node 22+, pnpm 10+, MSVC Build Tools (Windows) or
build-essential + webkit2gtk-4.1 (Linux).

```bash
pnpm install
pnpm tauri dev
```

The dev build of the Rust side takes 10+ minutes on first run while the
crate graph compiles. Subsequent runs are fast.

## HTTP contract

| Method | Path     | Body                                           | Purpose                       |
| ------ | -------- | ---------------------------------------------- | ----------------------------- |
| GET    | `/health`| —                                              | Liveness + version + printers |
| POST   | `/print` | `{ role, format: "escpos", data, jobId }`      | Send ESC/POS bytes to printer |

CORS allowlist: `https://dashboard.sufra.app`, `http://localhost:3000`.
