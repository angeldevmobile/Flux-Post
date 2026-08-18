# Changelog

All notable changes to Flux are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.2.0] — 2026-08-17

### Added
- AI features are free to try: every signed-in account gets 100 AI actions a month, up to 20 a day, running on Claude Haiku 4.5 with no API key and no setup. Prompts on the free tier are relayed through a Flux proxy, which is how the quota is applied; with your own key nothing is relayed and calls go straight from your machine to Anthropic.
- Settings → AI & Claude shows the free-tier consumption for the month and the day, and a toggle chooses between the free tier and your own key without having to delete the key to switch
- Hitting a limit explains which one and when it resets, with a shortcut to add your own key
- "What's new" in the bell: release notes ship inside the binary, with a marker when there is something unread
- Collections now carry the whole request: auth, query params, pre/post-request scripts, variable extractors, GraphQL query and variables, and form bodies. Saving and reopening a request gives back what you built.
- Saving a request whose auth holds a literal token warns before writing it to the file, and offers to move it into the active environment as a masked `{{VAR}}` in one click
- Collection descriptions can be written from the sidebar, and show under the collection when it is expanded
- CLI runner honours the new fields: auth (bearer, basic, api key, OAuth 2.0 client credentials), query params, form and GraphQL bodies, and folders at any depth. A collection that works in the app now works in CI.
- CLI reports what it cannot do instead of running a request that quietly differs: gRPC requests are skipped, pre/post scripts are announced, and AWS SigV4 fails with a message rather than going out unsigned

### Security
- An assertion whose left side was not recognised resolved to null, so `anything.at.all == null` passed against any response — including in CI, where the run exited 0. Unknown paths now fail with `unknown path '…'`. Pipelines that were silently green may start reporting real failures.

### Changed
- One assertion engine, one language. The collection runner, the Tests screen and the CLI used three different implementations: `json.token == null` passed in one and failed in another, `duration < 500` only worked in two of the three. All three now evaluate through the same engine, `json.` and `body.` are interchangeable, and `headers.x` and `headers["x"]` both work. A shared contract table is asserted by both the TypeScript and Rust test suites so they cannot drift apart again.
- Assertion failures now say what they got (`expected status == 404 — got 200`) instead of a bare value
- `body_type` in collection files is now written as `bodyType`, matching the rest of the schema; the old spelling is still read
- The model selector is disabled on the free tier, which always uses `claude-haiku-4-5`, instead of accepting a choice that was silently ignored

---

## [0.1.7] — 2026-08-15

### Added
- `QUERY` method support (RFC 10008) — safe and cacheable like `GET`, but with a request body
- gRPC streaming: server-streaming, client-streaming and bidirectional calls, with a live message log, per-message send, end-of-stream and cancel
- Nested folders in collections, and a stable `id` on every request and folder
- Unit tests for the request core — JSONPath extraction, assertion evaluation, Postman/OpenAPI/cURL import and export, and proto rendering (92 cases)
- Rust tests for collection YAML round-tripping, gRPC descriptors and the proto library on disk (31 cases)
- `CI` workflow: typecheck, tests, build, clippy and `flux-cli` build on every push and pull request
- `npm run test`, `npm run test:watch` and `npm run typecheck` scripts

### Security
- Selecting a collection request, replaying from history, or opening a result from the command palette carried the previously open request's auth, scripts and extractors over to the new one — sending credentials to whatever host was loaded next. All three now reset the request state first.

### Fixed
- Every singular proto3 field was reported as `optional`, so the generated proto marked the whole message optional; only fields declared with the keyword are flagged now (proto2 labels handled separately)
- Enum fields rendered as the literal word `enum` in the proto view instead of their type name
- Collection `description` was parsed but silently dropped on every save
- Request ids were positional, so deleting or reordering renumbered every request below; ids are now written to the collection file and stay stable
- cURL import dropped any body containing double quotes — which is most JSON — and left the method as `GET`
- cURL import could not find the URL unless it came first, so Flux could not re-import its own exported snippets
- JSONPath `$.items[*].field` returned whole objects instead of projecting the field over the array
- Assertions: an *absent* JSON field failed `== null` while an explicitly-null one passed; the branch written to handle it was unreachable
- Version strings had drifted apart across `package.json`, `Cargo.toml`, `tauri.conf.json`, the Settings screen and the docs site; all now derive from one place
- Analytics tagged every event with `0.1.5` while 0.1.6 was the shipped build

### Changed
- `npm run release <version>` now updates every file that carries the version and fails loudly when a target stops matching
- Removed the vestigial root `latest.json`; the updater manifest is generated by `tauri-action` at release time

---

## [0.1.6] — 2026-06-07

### Added
- GitHub integration: browse repositories, sync collections to and from YAML files, commit from inside the app
- gRPC support: `.proto` import, server reflection, unary invoke, metadata editor, persistent proto library
- Mixed collections: a single collection can hold both HTTP and gRPC requests (`kind: http | grpc`)
- AI debug assist with one-click Apply fixes

### Fixed
- gRPC proto ids are now stable across restarts, so saved gRPC requests keep resolving

---

## [0.1.5] — 2026-05-30

### Added
- Screenshot gallery and animated demo on the docs site

### Fixed
- Version strings shown in the app UI

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
