# Changelog

All notable changes to Flux are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.1.4] — 2026-05-30

### Fixed
- Add `createUpdaterArtifacts: true` to bundle config — enables `.sig` generation for auto-updater
- Releases now publish automatically (non-draft)

---

## [0.1.3] — 2026-05-30

### Fixed
- Regenerate signing keypair and update public key — restores auto-updater signature verification
- Correct pubkey in `tauri.conf.json` to match new signing credentials

---

## [0.1.2] — 2026-05-29

### Fixed
- Move bundle targets to the correct level in `tauri.windows.conf.json`
- Skip WiX/MSI on Windows and use NSIS only — WiX ICE rejects bundled `.exe` resources
- Build `flux-cli` before `tauri bundle` in CI and normalize binary path across platforms

---

## [0.1.1] — 2026-05-28

### Added
- CLI runner integration bundled as a resource inside the app
- Settings → AI & CLI section for CLI configuration
- In-app documentation and user installation guide

### Fixed
- Strip UTF-8 BOM from YAML files before parsing collections
- Rename bundled CLI resource to `flux-cli.exe` to avoid overwriting the main binary
- OAuth dynamic port assignment

### Changed
- GitHub Pages documentation site launched at `/docs`
- Favicon added to docs site

---

## [0.1.0] — 2026-05-26

### Added — Initial public release

**HTTP Requests**
- All methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Body types: JSON, form-urlencoded, multipart/form-data, GraphQL, binary, raw
- Auth: Bearer, API Key, Basic, OAuth 2.0 (auth code + client credentials), AWS SigV4
- Environment variable interpolation with `{{VAR}}` in URLs, headers, and body
- Pre-request and post-response JavaScript scripts with the `pm` API
- Cookie Jar: automatic per-domain cookie storage and sending

**Collections**
- Create collections and organize requests in folders
- Import from Postman v2.1 JSON, OpenAPI 3.x (JSON/YAML), or cURL
- Collection Runner with pass/fail report
- Cloud sync via Supabase (optional)

**Environments**
- Multiple named environments (Development, Staging, Production, …)
- Global variables shared across environments
- Secret keys masked in the UI and excluded from cloud sync
- Environment switcher in the top bar

**Tests & Assertions**
- Declarative assertions without scripting: `status == 200`, `body.id != null`, `duration < 500`
- AI-generated test suites from any response (Claude API key required)
- Post-response scripts with `pm.test()` / `pm.expect()` (Chai-style)
- AI fix suggestions when assertions fail
- Batch runner across an entire collection

**Real-time protocols**
- WebSocket client: connect to `ws://` / `wss://`, send JSON or text, timestamped log
- SSE client: `text/event-stream` with field parsing and JSON pretty-print

**Local Mock Server**
- Localhost HTTP server, no Docker or external tools
- Wildcard path matching (`/api/users/*`)
- Hot-reload — add endpoints while the server is running
- AI-generated response bodies per endpoint (Claude API key required)

**Load Test**
- Concurrent request runner: configurable total requests, concurrency, and timeout
- Live progress with req/s and average latency
- Final report: min / avg / P50 / P95 / P99 / max, throughput, error rate
- Latency distribution histogram

**Request Timeline**
- Waterfall breakdown on every response (Connect + TTFB + Download)
- Exact millisecond values and size per phase

**AI Features** _(requires your own Claude API key)_
- Test generation from response body
- Debug assist on 4xx / 5xx errors
- Natural-language script editor
- Batch failure analysis

**Application**
- Command Palette (Ctrl+K) — search collections and history
- Request history with replay, search, and clear
- Monaco Editor for request body, GraphQL, scripts, and response (VS Code engine)
- Cloud sync via Supabase (optional, your own project)
- Auto-updater with cryptographic signature verification
- Native binary: < 30 MB RAM, ~5 MB installer, no Electron

---

[0.1.2]: https://github.com/angeldevmobile/Flux-Post/releases/tag/v0.1.2
[0.1.1]: https://github.com/angeldevmobile/Flux-Post/releases/tag/v0.1.1
[0.1.0]: https://github.com/angeldevmobile/Flux-Post/releases/tag/v0.1.0
