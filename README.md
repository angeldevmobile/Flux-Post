# Flux

> Modern desktop API client. Local-first, AI-powered, cloud-synced.

Flux is a lightweight desktop app for testing and exploring APIs. Built with Tauri + React — under 30 MB RAM, native performance, no Electron.

---

## Why Flux

| | Postman / Insomnia | Flux |
|---|---|---|
| RAM usage | 200–400 MB | < 30 MB |
| Binary size | ~150 MB | ~5 MB |
| Requires account | Yes | No — offline first |
| AI features | None / paid | Test gen, debug assist, script editing |
| WebSocket | Basic | Full duplex viewer |
| SSE / EventStream | No | Yes — streaming event viewer |
| Cloud sync | Vendor cloud | Optional, your own Supabase |

---

## Features

### HTTP Requests
- All methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Body types: JSON, form, multipart, binary, raw, GraphQL
- Auth: Bearer, API Key, Basic, OAuth 2.0 (auth code + client credentials), AWS SigV4
- Headers, query params, environment variable interpolation `{{VAR}}`
- Pre-request scripts and post-response scripts (`pm` API — set/get env vars, add headers)
- Proxy support (HTTP/HTTPS), SSL verification toggle, client certificates (mTLS)

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
- [x] Distribution — GitHub Actions pipeline for signed installers (Windows, macOS, Linux)
- [x] First-run onboarding tour — custom 7-step walkthrough, triggers once on first login, re-launchable from Settings → General
- [x] Empty states with prefilled examples in each route
- [x] Error visibility — toasts for sync failures and request errors
- [ ] Cookie jar — per-domain cookie management
- [ ] GraphQL schema introspection + Monaco autocomplete

### Shipped
- [x] HTTP requests — all methods, auth types, body types
- [x] Pre/post request scripts with `pm` API
- [x] Collections — import Postman, OpenAPI, cURL
- [x] Collection runner with assertion reporting
- [x] Environment variables + secrets + global vars
- [x] Cloud sync (settings, collections, environments, history)
- [x] WebSocket viewer
- [x] SSE / EventStream viewer
- [x] GraphQL body type (query + variables)
- [x] AWS SigV4 signing
- [x] OAuth 2.0 (auth code + client credentials)
- [x] AI — test generation, debug assist, script editing, fix assertions
- [x] Request history
- [x] Response comparison

### Post-launch
- [ ] Share collections with teammates
- [ ] gRPC support
- [ ] CLI runner for CI/CD pipelines

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
