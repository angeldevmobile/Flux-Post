# Flux

> Modern desktop API client. Local-first, AI-powered, cloud-synced.

Flux is a lightweight desktop app for testing and exploring APIs. Built with Tauri + React — under 30 MB RAM, native performance, no Electron.

---

## Why Flux

| | Postman | Flux |
|---|---|---|
| RAM usage | 200–400 MB | < 30 MB |
| Binary size | ~150 MB | ~5 MB |
| Requires account | Yes | No — offline first |
| AI test generation | Paid plan | ✅ built-in (Claude) |
| AI debug on errors | No | ✅ 4xx/5xx auto-analysis |
| AI script editing | No | ✅ natural language edits |
| SSE / EventStream | No | ✅ full streaming viewer |
| GraphQL autocomplete | Basic | ✅ schema introspection + Monaco |
| Declarative assertions | No | ✅ `status == 200` without scripts |
| WebSocket | Basic | ✅ full duplex log with timestamps |
| Cloud sync | Postman servers | ✅ your own Supabase — you own the data |
| CLI runner for CI/CD | Newman (paid) | ✅ free, open source |
| Code snippets (curl, fetch, Python…) | Manual copy | ✅ one-click, any language |
| Auto variable extraction (JSONPath) | Paid Team plan | ✅ free, no scripts needed |
| Mock servers | Cloud-hosted, limited free | 🔜 100% local, instant |
| Load testing | Paid plan | 🔜 built-in, no k6 needed |
| Request timeline (DNS → TTFB) | No | 🔜 waterfall like DevTools |

---

## Features

### HTTP Requests
- All methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Body types: JSON, form, multipart, binary, raw, GraphQL
- Auth: Bearer, API Key, Basic, OAuth 2.0 (auth code + client credentials), AWS SigV4
- Headers, query params, environment variable interpolation `{{VAR}}`
- Pre-request scripts and post-response scripts (`pm` API — set/get env vars, add headers)
- Proxy support (HTTP/HTTPS), SSL verification toggle, client certificates (mTLS)
- **Code snippet export** — one-click copy as `curl`, `fetch`, `axios`, `Python requests`, or `Go http`

### Collections
- Import from Postman v2.1, OpenAPI 3.x, cURL
- Folder structure with nested requests
- Per-request test assertions
- Collection runner — run all requests in sequence with assertion reporting
- Cloud sync per user via Supabase

### Environments
- Multiple named environments with key/value variables
- Global variables shared across all environments
- Secret keys — masked in UI, never logged
- Environment variable resolution at send time
- **Variable extractor (JSONPath)** — define `$.data.token → {{token}}` rules; values captured automatically after every request, no scripts needed
- Cloud sync per user

### Tests
- Assertion syntax: `status == 200`, `body.token != null`, `duration < 500`
- AI-generated assertions from Claude — one click after any response
- AI fix suggestion on failing assertions
- Batch test runner across collection requests with pass/fail report
- Post-response scripts: `pm.test(...)` + `pm.expect(...)` Chai-style API

### Real-time Protocols
- **WebSocket** — connect, send/receive messages, full duplex log
- **SSE / Server-Sent Events** — streaming viewer with event type, data, id display, JSON pretty-print

### AI (Claude API — your key)
- Generate test assertions from any response
- Debug assist on 4xx/5xx errors
- AI script editor — edit pre/post scripts with natural language
- Fix failing assertions with one click
- Analyze batch test failures

### Other
- Request history (local SQLite + cloud sync)
- Response comparison between two requests
- Command palette
- Monaco-based code editor with syntax highlighting (JSON, GraphQL, JavaScript)
- Light / dark / system theme, custom accent color, compact mode
- Cloud auth (email + password via Supabase)

---

## Installation

Download the latest release from the [Releases page](https://github.com/angeldevmobile/Flux-Post/releases/latest).

| Platform | File | Notes |
|---|---|---|
| **Windows** | `Flux_x.x.x_x64-setup.exe` | Run the installer. Flux auto-updates in the background. |
| **macOS (Apple Silicon)** | `Flux_x.x.x_aarch64.dmg` | Drag to Applications. First launch: right-click → Open to bypass Gatekeeper. |
| **macOS (Intel)** | `Flux_x.x.x_x86_64.dmg` | Same as above. |
| **Linux (.deb)** | `Flux_x.x.x_amd64.deb` | `sudo dpkg -i Flux_*.deb` |
| **Linux (AppImage)** | `Flux_x.x.x_amd64.AppImage` | `chmod +x Flux_*.AppImage && ./Flux_*.AppImage` |

---

## Quick Start

1. **Send a request** — Type a URL in the top bar, pick a method, press `Ctrl+Enter`.
2. **Save to a collection** — Click the `+` in the sidebar to organize requests in folders.
3. **Use environment variables** — Go to Environments and add `{{BASE_URL}}` style variables to reuse across requests.
4. **Enable AI features** — Add your Claude API key in Settings → AI & Claude to unlock one-click test generation and debug assist.
5. **Import existing work** — Import a Postman collection, OpenAPI spec or cURL command from the sidebar import button.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FLUX DESKTOP                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               UI Layer (React + TypeScript)          │   │
│  │                                                      │   │
│  │  Request Builder · Response Viewer · Collections     │   │
│  │  Environments · Tests · History · WS · SSE · Compare │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           │ Tauri IPC                        │
│  ┌────────────────────────▼─────────────────────────────┐   │
│  │               Core (Rust / Tauri 2.0)                │   │
│  │                                                      │   │
│  │   HTTP (reqwest) · WebSocket · SSE streaming         │   │
│  │   OAuth flows · AWS SigV4 · mTLS                     │   │
│  │   SQLite (history, session) · YAML collections       │   │
│  │   Claude API client (AI features)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │                    │                  │
   Local SQLite          .yaml files        Supabase
   (history)            (collections)       (sync + auth)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.0 |
| Frontend | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Code editor | Monaco Editor |
| HTTP engine | reqwest (Rust) |
| WebSocket | tokio-tungstenite (Rust) |
| Local DB | SQLite via rusqlite (Rust) |
| Collections format | YAML |
| Auth + sync | Supabase |
| AI | Claude API (Sonnet 4.6) |

---

## Project Structure

```
flux/
├── src-tauri/
│   └── src/
│       ├── lib.rs                  # Tauri app entry, state registration
│       └── commands/
│           ├── http.rs             # HTTP request engine
│           ├── websocket.rs        # WebSocket connections
│           ├── sse.rs              # SSE streaming
│           ├── history.rs          # SQLite history + session
│           ├── collections.rs      # YAML collection I/O
│           ├── ai.rs               # Claude API calls
│           └── oauth.rs            # OAuth 2.0 flows
│
├── src/
│   ├── routes/
│   │   ├── requests/               # Main request builder
│   │   ├── environments/           # Environment manager
│   │   ├── collections/ (sidebar)  # Collection tree
│   │   ├── tests/                  # Test runner
│   │   ├── history/                # Request history
│   │   ├── websocket/              # WebSocket viewer
│   │   ├── sse/                    # SSE event viewer
│   │   ├── compare/                # Response diff
│   │   └── settings/               # App settings
│   ├── components/
│   │   ├── request/RequestPanel.tsx
│   │   ├── response/ResponsePanel.tsx
│   │   ├── collections/
│   │   ├── CodeEditor.tsx
│   │   └── CommandPalette.tsx
│   ├── stores/                     # Zustand stores
│   │   ├── request.ts
│   │   ├── collections.ts
│   │   ├── environment.ts
│   │   ├── settings.ts
│   │   └── user.ts
│   └── lib/
│       ├── tauri.ts                # Typed Tauri command wrappers
│       ├── sync.ts                 # Supabase cloud sync
│       ├── preRequest.ts           # pm API runtime
│       ├── importers.ts            # Postman / OpenAPI / cURL
│       └── awsSigV4.ts             # AWS request signing
```

---

## Cloud Sync

Flux syncs to Supabase (optional). All data is scoped to the authenticated user via RLS — the anon key is safe to ship.

Tables synced on login and in real-time:

| Table | What |
|---|---|
| `flux_settings` | App preferences |
| `flux_collections` | All collections and requests |
| `flux_environments` | Environments, variables, global vars |
| `flux_history` | Last 200 request history entries |

The `service_role` key never leaves the server. Device-only values (`claudeApiKey`, client certificates) are excluded from sync.

---

## Pre/Post Request Scripts

Flux runs JavaScript before and after each request. Uses the `pm` API:

```js
// Pre-request: add a header dynamically
pm.request.headers.upsert("X-Timestamp", Date.now().toString());

// Pre-request: read an env var
const token = pm.environment.get("ACCESS_TOKEN");

// Post-response: save a token from the response
const body = pm.response.json();
pm.environment.set("ACCESS_TOKEN", body.token);

// Post-response: write tests
pm.test("returns 200", () => {
  pm.expect(pm.response.status).to.equal(200);
});
```

---

## SSE / EventStream

Connect to any `text/event-stream` endpoint and see events in real time:

- Parses `event:`, `data:`, `id:` fields per the SSE spec
- JSON data is pretty-printed automatically
- Custom headers (for `Authorization`, API keys, etc.)
- Cancellable at any time

---

## Status

> **Pre-launch — actively working toward public release.**

Core features are stable and in daily use. The items below are the remaining blockers before announcing to the community.

---

## Roadmap

### Pre-launch blockers
- [x] Distribution — auto-updater with signed installers (Windows, macOS, Linux)
- [x] First-run onboarding tour — custom 7-step walkthrough, re-launchable from Settings
- [x] Error visibility — toasts, React Error Boundary with crash reporting to Supabase
- [x] Analytics + crash reporting — wired to Supabase, respects privacy settings
- [x] Cookie jar — per-domain cookie management, toggle in Settings
- [x] GraphQL schema introspection + Monaco autocomplete

### Shipped
- [x] HTTP requests — all methods, auth types, body types
- [x] Pre/post request scripts with `pm` API
- [x] Collections — import Postman, OpenAPI, cURL
- [x] Collection runner with assertion reporting
- [x] Environment variables + secrets + global vars
- [x] Variable extractor (JSONPath) — `$.data.token → {{token}}` rules, auto-applied after every response
- [x] Code snippet export — copy any request as `curl`, `fetch`, `axios`, `Python requests`, `Go http`
- [x] Cloud sync (settings, collections, environments, history)
- [x] WebSocket viewer — full duplex log with timestamps
- [x] SSE / EventStream viewer — full spec support, JSON pretty-print
- [x] GraphQL body type (query + variables + schema autocomplete)
- [x] AWS SigV4 signing
- [x] OAuth 2.0 (auth code + client credentials)
- [x] AI — test generation, debug assist, script editing, fix assertions, batch analysis
- [x] Request history (SQLite + cloud sync)
- [x] Environment compare — same request across multiple envs side by side
- [x] Command palette (Ctrl+K)
- [x] Monaco editor — JSON, GraphQL, JavaScript with syntax highlighting

### Post-launch

| Feature | Effort | Community impact | Monetization |
|---|---|---|---|
| ~~CLI runner~~ | ~~Medium (1-2 weeks)~~ | ⭐⭐⭐⭐⭐ — viral in CI/CD | ~~Pro feature~~ |
| ~~Code snippet generator~~ | ~~Low (1-2 days)~~ | ⭐⭐⭐⭐⭐ — daily use | ~~Free~~ |
| ~~Variable extractor (JSONPath)~~ | ~~Low-Medium (3-5 days)~~ | ⭐⭐⭐⭐⭐ — enables chaining | ~~Free (Postman charges)~~ |
| Local mock server | High (2-3 weeks) | ⭐⭐⭐⭐ | Pro feature |
| Load test | Medium (1 week) | ⭐⭐⭐⭐ | Pro feature |
| Request timeline (waterfall) | Medium (1 week) | ⭐⭐⭐⭐ | Free |
| gRPC support | High (3-4 weeks) | ⭐⭐⭐ | Pro feature |
| Team workspaces | Very high | ⭐⭐⭐⭐⭐ | Core paid tier |

- [x] **CLI runner** — `flux run collection.yaml --env BASE_URL=https://...` for CI/CD pipelines. Free alternative to Postman Newman. JSON report output, exit code 1 on failures, installable via Settings → CLI Tools.
- [x] **Code snippet generator** — One-click copy as `curl`, `fetch`, `axios`, `Python requests`, `Go http`. Works from any request via the `</>` button next to Send.
- [x] **Variable extractor (JSONPath)** — Define `$.data.token → {{token}}` rules in the Extract tab. Flux captures values automatically after every response and writes them to the active environment. No scripts needed — free, unlike Postman Team plan.
- [ ] **Local mock server** — Spin up a localhost server from any collection. Define status codes, response bodies, and latency per endpoint. 100% offline, zero latency, AI-generated response bodies on request.
- [ ] **Load test** — Run any request N times with C concurrent workers. See min / max / avg / p95 latency, error rate, and throughput in a live chart. No external tools (k6, wrk, ab) required.
- [ ] **Request timeline (waterfall)** — DNS lookup → TCP connect → TLS handshake → TTFB → download time breakdown on every response. Same level of detail as Chrome DevTools Network tab, built directly into the response panel.
- [ ] **gRPC support** — `.proto` import, Monaco editor for request messages, server reflection. Free unlike Postman Team plan.
- [ ] **Team workspaces** — Shared collections with real-time sync via Supabase Realtime. Your data, your infrastructure.

---

## Development

```bash
# Prerequisites: Node.js 20+, Rust 1.75+

git clone https://github.com/your-org/flux
cd flux

npm install
npm run tauri dev

# Build
npm run tauri build
```

---

## License

MIT

---

Built with [Tauri](https://tauri.app) · [React](https://react.dev) · [Claude](https://anthropic.com) · Rust
