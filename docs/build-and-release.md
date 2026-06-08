# Build and release

## Local development

```bash
pnpm install
pnpm tauri dev
```

First `cargo build` is 10+ minutes — the Tauri crate graph is large. Subsequent runs are sub-30s.

The dev profile launches the Vue app via Vite on `http://localhost:1420` and points the Tauri webview at it. The HTTP server still binds `127.0.0.1:9177`, so you can hit it from a regular browser tab during development (`curl http://127.0.0.1:9177/health`).

### Windows prerequisites

- Rust 1.96+ (`rustup default stable`).
- MSVC Build Tools 2022 with the "Desktop development with C++" workload + the Windows 11 SDK. The Tauri 2 + rusb build needs `link.exe` and the platform headers.
- Node 22+, pnpm 10+.

### Linux prerequisites

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libusb-1.0-0-dev \
  patchelf
```

`libusb-1.0-0-dev` is mandatory — rusb needs it at link time. Without it the build fails late with `error: could not find native static library 'usb-1.0'`.

## Production build

```bash
pnpm tauri build
```

Outputs land under `src-tauri/target/release/bundle/`:

| Platform | Bundle                                                                     |
| -------- | -------------------------------------------------------------------------- |
| Windows  | `msi/Sufra Printer_<version>_x64_en-US.msi`  (~4 MB)                       |
| Linux    | `appimage/sufra-printer_<version>_amd64.AppImage`, `deb/sufra-printer_<version>_amd64.deb` |

The MSI registers the tray app to auto-start on login. The `.deb` integrates with the user-level systemd unit; the `.AppImage` is portable and runs without install.

## CI matrix

`.github/workflows/release.yml` runs on every `v*` tag push (and manual `workflow_dispatch`). It builds both Windows and Linux in parallel via `tauri-apps/tauri-action@v0`, which under the hood:

1. Runs `pnpm tauri build` on each runner.
2. Uploads every produced bundle as a release asset for the tag.
3. Publishes the GitHub Release as non-draft.

The workflow's `releaseName` and `releaseBody` are fixed — no auto-generated changelog. If you want notes, hand-edit the release after CI publishes it, or add a step that posts the diff since the previous tag.

### Re-running a tag

If a release needs a do-over (typical: tagged too early, missing a feature):

```bash
git tag -d v0.1.0
git push origin :v0.1.0
git tag v0.1.0   # or git tag -f v0.1.0 <commit>
git push origin v0.1.0
```

`tauri-action` will overwrite the existing release's assets.

## How the dashboard finds your release

The dashboard's `useBridgeReleases` composable (`sufra-dashboard/app/composables/useBridgeReleases.ts`) hits `https://api.github.com/repos/NasrALdaya/sufra-printer/releases/latest` and picks the first asset whose filename ends in:

- `.msi` → Windows download
- `.appimage` → Linux portable
- `.deb` → Debian/Ubuntu

Match is case-insensitive and on the suffix only — so the version number embedded in the filename is fine. If you change the bundle naming, double-check `useBridgeReleases.pickAsset` still picks the right one.

The `/settings/printer-bridge` page renders the install buttons hidden until `useBridgeReleases.release` resolves, then shows whichever assets exist for the latest tag. The release page link (`releasePageUrl`) is always visible as a fallback so operators can always reach the manual download list.

## Repo visibility

`useBridgeReleases` calls GitHub anonymously (60 req/h per IP). The composable caches the result for the session, so a single dashboard load is one request. If the repo is private the API returns 404 and the download buttons stay hidden — the install page falls back to "no release available yet" copy. The repo was flipped to public on 2026-06-04 specifically to make this work without a token.

## Versioning

`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` both carry a `version` field. Keep them in sync — Tauri uses the conf value for the bundle name, Cargo uses its value for `env!("CARGO_PKG_VERSION")` which the bridge reports via `/health`. The dashboard compares the reported version with the latest GitHub tag (eventually — TODO #14, updater).

The single source-of-truth tag is the git tag (`v0.1.0`). Bumps:

1. Edit both `Cargo.toml` and `tauri.conf.json` (without leading `v`).
2. Commit + push.
3. `git tag v0.1.1 && git push origin v0.1.1`.
4. CI publishes the release.

## Cross-references

- Architecture, runtime model, why this is a separate process → [architecture.md](./architecture.md)
- HTTP endpoint reference → [http-contract.md](./http-contract.md)
- Dashboard install page + auto-discovery → `sufra-dashboard/docs/printing.md` → "Installing the bridge"
