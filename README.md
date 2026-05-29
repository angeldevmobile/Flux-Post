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
| Mock servers | Cloud-hosted, limited free | ✅ 100% local, instant, AI-generated bodies |
| Load testing | Paid plan | ✅ built-in, no k6 needed |
| Request timeline (DNS → TTFB) | No | ✅ waterfall like DevTools |
| gRPC support | Basic | 🔜 .proto import + server reflection |
| Team workspaces | Postman servers | 🔜 your own Supabase Realtime |

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

### Local Mock Server
- Spin up a localhost HTTP server directly from the app — no external tools
- Define any number of endpoints: method, path, status code, response body, content type, and delay
- Wildcard path matching (`/api/users/*` matches any sub-path)
- CORS headers injected automatically — works immediately from a browser or any HTTP client
- Hot-reload: add or edit endpoints while the server is running, no restart needed
- **AI-generated bodies** — click the ✦ button on any endpoint and Claude writes a realistic response for you
- 100% offline — runs inside the Tauri process on `127.0.0.1`

### Load Test
- Run any request N times with C concurrent workers — no k6, wrk, or ab needed
- Configurable: total requests, concurrency, per-request timeout
- Live progress bar with real-time req/s and average latency
- Final report: min / avg / P50 / P95 / P99 / max latency, throughput (req/s), error rate
- Latency distribution histogram — see exactly where the slow tail is
- Pre-fills from the current request in the builder

### Request Timeline
- Every response now includes a timing waterfall in the **Timeline** tab of the response panel
- **Connect + Waiting (TTFB)** — time from send to first response byte (DNS + TCP + TLS + server processing)
- **Download** — time to receive the full response body after headers
- Proportional bar chart with exact millisecond values for each phase
- Summary table: TTFB, download, total, size, status

### AI (Claude API — your key)
- Generate test assertions from any response
- Debug assist on 4xx/5xx errors
- AI script editor — edit pre/post scripts with natural language
- Fix failing assertions with one click
- Analyze batch test failures
- Generate realistic mock response bodies from endpoint context

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
6. **Mock an API** — Go to Mock Server, add endpoints, hit Start. Your local server is live on `http://localhost:3001`.
7. **Stress-test an endpoint** — Go to Load Test, set total requests and concurrency, hit Run.

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
│  │  Load Test · Mock Server · Request Timeline          │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           │ Tauri IPC                        │
│  ┌────────────────────────▼─────────────────────────────┐   │
│  │               Core (Rust / Tauri 2.0)                │   │
│  │                                                      │   │
│  │   HTTP (reqwest) · WebSocket · SSE streaming         │   │
│  │   OAuth flows · AWS SigV4 · mTLS                     │   │
│  │   SQLite (history, session) · YAML collections       │   │
│  │   Claude API client (AI features)                    │   │
│  │   Load test engine (tokio + semaphore)               │   │
│  │   Mock HTTP server (axum, in-process)                │   │
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
| Mock server | axum (Rust, in-process) |
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
│           ├── http.rs             # HTTP request engine + timing waterfall
│           ├── websocket.rs        # WebSocket connections
│           ├── sse.rs              # SSE streaming
│           ├── history.rs          # SQLite history + session
│           ├── collections.rs      # YAML collection I/O
│           ├── ai.rs               # Claude API calls
│           ├── oauth.rs            # OAuth 2.0 flows
│           ├── loadtest.rs         # Concurrent load test engine
│           └── mock.rs             # Local axum HTTP mock server
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
│   │   ├── loadtest/               # Load test UI + live chart
│   │   ├── mock/                   # Mock server configuration
│   │   └── settings/               # App settings
│   ├── components/
│   │   ├── request/RequestPanel.tsx
│   │   ├── response/ResponsePanel.tsx  # + Timeline tab
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

## Mock Server

Define endpoints and start a local HTTP server in one click:

```
GET  /api/users        → 200  {"users": [...]}
POST /api/users        → 201  {"id": 42, "created": true}
GET  /api/products/*   → 200  {"product": {...}}   (wildcard path)
GET  /api/slow         → 200  {"data": "..."}       delay: 800ms
```

The server runs on `127.0.0.1` — it never reaches the internet. Endpoints can be updated live without restarting.

---

## Load Test

```
URL:         https://api.example.com/users
Method:      GET
Total:       500 requests
Concurrency: 25 workers

Results
────────────────────────────────────────
Min     Avg     P95     P99     Max
12ms    47ms    182ms   341ms   892ms

Throughput: 43.2 req/s   Errors: 2 (0.4%)
```

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
- [x] **Local mock server** — axum HTTP server inside the app, AI-generated bodies, hot-reload endpoints, wildcard paths
- [x] **Load test** — concurrent request runner, live progress, P50/P95/P99/throughput, latency histogram
- [x] **Request timeline (waterfall)** — TTFB + download breakdown on every response, built into the response panel

### Post-launch

| Feature | Effort | Community impact | Monetization |
|---|---|---|---|
| ~~CLI runner~~ | ~~Medium (1-2 weeks)~~ | ⭐⭐⭐⭐⭐ — viral in CI/CD | ~~Pro feature~~ |
| ~~Code snippet generator~~ | ~~Low (1-2 days)~~ | ⭐⭐⭐⭐⭐ — daily use | ~~Free~~ |
| ~~Variable extractor (JSONPath)~~ | ~~Low-Medium (3-5 days)~~ | ⭐⭐⭐⭐⭐ — enables chaining | ~~Free (Postman charges)~~ |
| ~~Local mock server~~ | ~~High (2-3 weeks)~~ | ⭐⭐⭐⭐ | ~~Pro feature~~ |
| ~~Load test~~ | ~~Medium (1 week)~~ | ⭐⭐⭐⭐ | ~~Pro feature~~ |
| ~~Request timeline (waterfall)~~ | ~~Medium (1 week)~~ | ⭐⭐⭐⭐ | ~~Free~~ |
| gRPC support | High (3-4 weeks) | ⭐⭐⭐ | Pro feature |
| Team workspaces | Very high | ⭐⭐⭐⭐⭐ | Core paid tier |

- [x] **CLI runner** — `flux run collection.yaml --env BASE_URL=https://...` for CI/CD pipelines. Free alternative to Postman Newman. JSON report output, exit code 1 on failures, installable via Settings → CLI Tools.
- [x] **Code snippet generator** — One-click copy as `curl`, `fetch`, `axios`, `Python requests`, `Go http`. Works from any request via the `</>` button next to Send.
- [x] **Variable extractor (JSONPath)** — Define `$.data.token → {{token}}` rules in the Extract tab. Flux captures values automatically after every response and writes them to the active environment. No scripts needed — free, unlike Postman Team plan.
- [x] **Local mock server** — Spin up a localhost server from the Mock Server screen. Define method, path, status, body, content type, and delay per endpoint. Wildcard paths supported. Hot-reload endpoints without restarting. AI button generates realistic response bodies via Claude. 100% offline.
- [x] **Load test** — Run any request N times with C concurrent workers. See min / avg / P50 / P95 / P99 / max latency, error rate, and throughput in a live chart. No external tools (k6, wrk, ab) required.
- [x] **Request timeline (waterfall)** — Connect + Waiting (TTFB) and Download phases shown as proportional bars in the Timeline tab of every response. Same detail level as Chrome DevTools Network tab, built directly into the response panel.
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
