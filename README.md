# Flux

Modern desktop API client. Local-first, AI-powered, cloud-synced.

Flux is a lightweight desktop app for testing and exploring APIs, built with Tauri and React. Under 30 MB RAM, native performance, no Electron.

---

## Why Flux

| | Postman | Flux |
|---|---|---|
| RAM usage | 200–400 MB | < 30 MB |
| Installer size | ~150 MB | ~9 MB |
| Requires account | Yes | Yes, free — email or GitHub |
| AI test generation | Paid plan | Built-in (Claude) |
| AI debug on errors | No | 4xx/5xx analysis + one-click Apply fixes |
| AI script editing | No | Natural language edits |
| SSE / EventStream | No | Full streaming viewer |
| GraphQL autocomplete | Basic | Schema introspection + Monaco |
| Declarative assertions | No | `status == 200` without scripts |
| WebSocket | Basic | Full duplex log with timestamps |
| Cloud sync | Postman servers | Your own Supabase, you own the data |
| CLI runner for CI/CD | Newman (paid) | Free, open source |
| Code snippets | Manual copy | One-click, any language |
| Auto variable extraction | Paid Team plan | Free, no scripts needed |
| Mock servers | Cloud-hosted, limited free | 100% local, instant, AI-generated bodies |
| Load testing | Paid plan | Built-in, no k6 needed |
| Request timeline | No | Waterfall like DevTools |

---

## Features

### HTTP Requests
- All methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Body types: JSON, form, multipart, binary, raw, GraphQL
- Auth: Bearer, API Key, Basic, OAuth 2.0 (auth code and client credentials), AWS SigV4
- Headers, query params, environment variable interpolation `{{VAR}}`
- Pre-request and post-response scripts with the `pm` API
- Proxy support, SSL verification toggle, client certificates (mTLS)
- Code snippet export: copy as `curl`, `fetch`, `axios`, `Python requests`, or `Go http`

### Collections
- Import from Postman v2.1, OpenAPI 3.x, cURL
- Export as Postman v2.1 or OpenAPI 3.0
- Folder structure with nested requests
- Per-request test assertions
- Collection runner with assertion reporting
- Cloud sync per user via Supabase

### Environments
- Multiple named environments with key/value variables
- Global variables shared across all environments
- Secret keys, masked in UI and never logged
- Environment variable resolution at send time
- Variable extractor (JSONPath): define `$.data.token -> {{token}}` rules, values captured automatically after every request

### Tests
- Assertion syntax: `status == 200`, `body.token != null`, `duration < 500`
- AI-generated assertions from Claude, one click after any response
- AI fix suggestion on failing assertions — Apply button applies the fix directly to the request (header or body)
- Batch test runner across collection requests with pass/fail report
- Post-response scripts with `pm.test()` and `pm.expect()` Chai-style API

### Real-time Protocols
- WebSocket: connect, send and receive messages, full duplex log
- SSE / Server-Sent Events: streaming viewer with event type, data, id display and JSON pretty-print

### Local Mock Server
- Spin up a localhost HTTP server directly from the app, no external tools
- Define any number of endpoints: method, path, status code, response body, content type, and delay
- Wildcard path matching (`/api/users/*` matches any sub-path)
- CORS headers injected automatically
- Hot-reload: add or edit endpoints while the server is running, no restart needed
- AI-generated bodies: click the button on any endpoint and Claude writes a realistic response
- 100% offline, runs inside the Tauri process on `127.0.0.1`

### Load Test
- Run any request N times with C concurrent workers, no k6, wrk, or ab needed
- Configurable: total requests, concurrency, per-request timeout
- Live progress bar with real-time req/s and average latency
- Final report: min, avg, P50, P95, P99, max latency, throughput (req/s), error rate
- Latency distribution histogram

### Request Timeline
- Timing waterfall in the Timeline tab of every response
- Connect and Waiting (TTFB): time from send to first response byte
- Download: time to receive the full response body after headers
- Proportional bar chart with exact millisecond values

### AI (Claude API, your key)
- Generate test assertions from any response
- Debug assist on 4xx/5xx errors: Flux-aware analysis with structured explanation (what, cause, steps) and one-click Apply fixes — suggested headers, params, or body values are applied directly to the request without leaving the panel
- Edit pre/post scripts with natural language
- Fix failing assertions: AI suggests the corrected value and an Apply button applies it to the request headers or body automatically
- Analyze batch test failures
- Generate realistic mock response bodies from endpoint context

### Other
- Request history (local SQLite and cloud sync)
- Response comparison between two requests
- Command palette
- Monaco-based code editor with syntax highlighting for JSON, GraphQL, and JavaScript
- Light, dark, and system theme, custom accent color, compact mode
- Cloud auth via Supabase

---

## Installation

Download the latest release from the [Releases page](https://github.com/angeldevmobile/Flux-Post/releases/latest).

| Platform | File | Notes |
|---|---|---|
| Windows | `Flux_x.x.x_x64-setup.exe` | Run the installer. Flux auto-updates in the background. |
| macOS (Apple Silicon) | `Flux_x.x.x_aarch64.dmg` | Drag to Applications. First launch: right-click, Open to bypass Gatekeeper. |
| macOS (Intel) | `Flux_x.x.x_x86_64.dmg` | Same as above. |
| Linux (.deb) | `Flux_x.x.x_amd64.deb` | `sudo dpkg -i Flux_*.deb` |
| Linux (AppImage) | `Flux_x.x.x_amd64.AppImage` | `chmod +x Flux_*.AppImage && ./Flux_*.AppImage` |

---

## Quick Start

1. **Send a request** — type a URL in the top bar, pick a method, press `Ctrl+Enter`.
2. **Save to a collection** — click the `+` in the sidebar to organize requests in folders.
3. **Use environment variables** — go to Environments and add `{{BASE_URL}}` style variables to reuse across requests.
4. **Enable AI features** — add your Claude API key in Settings, AI and Claude, to unlock one-click test generation and debug assist.
5. **Import existing work** — import a Postman collection, OpenAPI spec, or cURL command from the sidebar import button.
6. **Mock an API** — go to Mock Server, add endpoints, hit Start. Your local server is live on `http://localhost:3001`.
7. **Stress-test an endpoint** — go to Load Test, set total requests and concurrency, hit Run.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FLUX DESKTOP                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               UI Layer (React + TypeScript)          │   │
│  │                                                      │   │
│  │  Request Builder, Response Viewer, Collections       │   │
│  │  Environments, Tests, History, WS, SSE, Compare      │   │
│  │  Load Test, Mock Server, Request Timeline            │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           │ Tauri IPC                        │
│  ┌────────────────────────▼─────────────────────────────┐   │
│  │               Core (Rust / Tauri 2.0)                │   │
│  │                                                      │   │
│  │   HTTP (reqwest), WebSocket, SSE streaming           │   │
│  │   OAuth flows, AWS SigV4, mTLS                       │   │
│  │   SQLite (history, session), YAML collections        │   │
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

## Roadmap

### Shipped
- HTTP requests with all methods, auth types, and body types
- Pre/post request scripts with `pm` API
- Collections: import from Postman, OpenAPI, cURL; export to Postman v2.1 and OpenAPI 3.0
- Collection runner with assertion reporting
- Environment variables, secrets, and global vars
- Variable extractor (JSONPath): `$.data.token -> {{token}}` rules, auto-applied after every response
- Code snippet export: copy any request as `curl`, `fetch`, `axios`, `Python requests`, `Go http`
- Cloud sync for settings, collections, environments, and history
- WebSocket viewer with full duplex log and timestamps
- SSE / EventStream viewer with full spec support and JSON pretty-print
- GraphQL body type with query, variables, and schema autocomplete
- AWS SigV4 signing
- OAuth 2.0 (auth code and client credentials)
- AI test generation, debug assist with one-click Apply fixes, script editing, fix assertions with Apply button, batch analysis
- Request history (SQLite and cloud sync)
- Environment compare across multiple environments side by side
- Command palette (Ctrl+K)
- Monaco editor with syntax highlighting for JSON, GraphQL, and JavaScript
- Local mock server with AI-generated bodies, hot-reload endpoints, and wildcard paths
- Load test with concurrent runner, live progress, P50/P95/P99/throughput, latency histogram
- Request timeline (waterfall): TTFB and download breakdown on every response
- CLI runner: `flux run collection.yaml --env BASE_URL=https://...` for CI/CD pipelines
- OpenAPI 3.0 export from any collection
- gRPC: `.proto` import, server reflection, persistent proto library, unary calls, and server / client / bidirectional streaming
- GitHub integration: browse repos and sync collections as YAML

### In progress
- Team workspaces: shared collections with real-time sync via Supabase Realtime

### Planned
- Native CI/CD integrations: GitHub Actions, GitLab CI, Jenkins — trigger collection runs and post results directly from the pipeline UI
- Slack and webhook notifications: send pass/fail summaries after a collection run to any channel or endpoint
- API monitoring: schedule collection runs on a cron, get alerted when an endpoint goes down or a test regresses
- Postman-compatible public workspace / template gallery: browse and fork community collections from inside the app
- Browser extension: capture requests from DevTools and send them directly to Flux

---

## Pre/Post Request Scripts

Flux runs JavaScript before and after each request using the `pm` API:

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

## Development

```bash
# Prerequisites: Node.js 20+, Rust 1.75+

git clone https://github.com/angeldevmobile/Flux-Post
cd Flux-Post

npm install
npm run tauri dev

# Build
npm run tauri build
```

---

## License

MIT

---

Built with [Tauri](https://tauri.app), [React](https://react.dev), and Rust
