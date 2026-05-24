# Flux

> The modern API client for developers. Local-first, git-native, AI-powered.

Flux is a lightweight desktop API client built with Tauri + React. Your collections live in your repo as plain files, the app uses under 30MB of RAM, and Claude AI generates tests from your responses automatically.

---

## Why Flux

| Problem | Postman / Insomnia | Flux |
|---|---|---|
| RAM usage | 200–400 MB | < 30 MB |
| Collections storage | Vendor cloud | Local files in your repo |
| Git workflow | Manual export | Native — commit alongside code |
| AI features | None | Test generation, debug assist |
| Requires account | Yes | No — offline first |
| Binary size | ~150 MB | ~5 MB |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FLUX DESKTOP                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 UI Layer (React + TS)                │   │
│  │                                                      │   │
│  │   Request Builder  │  Response Viewer  │  Settings   │   │
│  │   Collection Tree  │  Test Runner      │  Env Mgr    │   │
│  └───────────────────────────┬──────────────────────────┘   │
│                              │ Tauri IPC (commands)          │
│  ┌───────────────────────────▼──────────────────────────┐   │
│  │                  Core (Rust / Tauri)                 │   │
│  │                                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │  │ HTTP Engine │  │  File System │  │  SQLite    │  │   │
│  │  │  (reqwest)  │  │  (collections│  │  (history) │  │   │
│  │  │             │  │   .yaml)     │  │            │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────┘  │   │
│  │                                                      │   │
│  │  ┌─────────────────────────────────────────────────┐ │   │
│  │  │            Claude API Client (AI)               │ │   │
│  │  └─────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │                    │                  │
    .yaml files           SQLite DB          Claude API
    (your repo)          (local only)       (anthropic.com)
```

### Layer responsibilities

**UI Layer — React + TypeScript**
Renders the interface only. No networking, no file I/O. All side effects go through Tauri IPC commands to the Rust core.

**Core — Rust via Tauri 2.0**
Owns all sensitive operations: HTTP requests, file system access, database reads/writes, and API calls to Claude. This is what keeps the binary small and RAM low — no Chromium bundled, no Node.js runtime.

**Storage — Local files + SQLite**
- Collections → `.yaml` files inside your project directory. Committable, diffable, reviewable in PRs.
- Request history → SQLite database, stored locally, never leaves the machine.

**AI — Claude API (Anthropic)**
The Rust core calls Claude with the raw request + response as context. Claude returns generated test assertions. No data is stored by Anthropic beyond the standard API usage terms.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Desktop shell | Tauri 2.0 | Uses OS WebView — no bundled Chromium |
| Frontend | React 18 + TypeScript | Familiar DX, strong ecosystem |
| Build tool | Vite | Fast HMR during development |
| UI components | Tailwind CSS v4 | Utility-first, zero runtime overhead |
| State management | Zustand | Minimal, no boilerplate |
| HTTP engine | reqwest (Rust) | Native TLS, async, battle-tested |
| Local database | SQLite via rusqlite (Rust) | Zero-config, embedded, bundled |
| Collections format | YAML | Human-readable, git-friendly |
| AI | Claude API — Sonnet 4.6 | Best balance of speed and capability |
| Auth | GitHub OAuth + email/password | Covers both developer personas |

---

## Project Structure

```
flux/
├── src-tauri/                  # Rust core (Tauri backend)
│   ├── src/
│   │   ├── main.rs             # Tauri app entry point
│   │   ├── commands/           # IPC command handlers
│   │   │   ├── http.rs         # Send HTTP requests
│   │   │   ├── collections.rs  # Read/write .yaml collections
│   │   │   ├── history.rs      # SQLite request history
│   │   │   └── ai.rs           # Claude API integration
│   │   ├── engine/             # HTTP engine (reqwest)
│   │   │   ├── client.rs       # Request builder + sender
│   │   │   ├── auth.rs         # Auth schemes (Bearer, API Key, Basic)
│   │   │   └── proxy.rs        # Proxy + SSL configuration
│   │   └── db/                 # SQLite layer (sqlx)
│   │       ├── migrations/
│   │       └── models.rs
│   └── Cargo.toml
│
├── src/                        # React frontend
│   ├── app/
│   │   ├── layout.tsx          # Root layout with nav rail
│   │   └── routes/
│   │       ├── requests/       # Main request builder screen
│   │       ├── environments/   # Environment variables manager
│   │       ├── tests/          # AI-generated test runner
│   │       ├── history/        # Request history
│   │       └── settings/       # Settings sub-screens
│   ├── components/
│   │   ├── request/            # URL bar, method selector, body editor
│   │   ├── response/           # Response viewer, status, AI panel
│   │   ├── collections/        # Sidebar tree, endpoint rows
│   │   └── ui/                 # shadcn/ui primitives
│   ├── stores/                 # Zustand stores
│   │   ├── request.ts          # Active request state
│   │   ├── collections.ts      # Collection tree state
│   │   └── environment.ts      # Active environment + variables
│   ├── lib/
│   │   ├── tauri.ts            # Typed Tauri command wrappers
│   │   └── yaml.ts             # Collection serialization helpers
│   └── main.tsx
│
├── collections/                # Example: your API collections live here
│   └── my-api/
│       ├── auth.yaml
│       ├── users.yaml
│       └── products.yaml
│
└── package.json
```

---

## Collection Format

Collections are plain `.yaml` files that live in your project repository.

```yaml
# collections/auth.yaml
name: Auth
description: Authentication endpoints
baseUrl: "{{BASE_URL}}"

requests:
  - name: Login
    method: POST
    path: /auth/login
    headers:
      Content-Type: application/json
    body:
      email: "{{TEST_EMAIL}}"
      password: "{{TEST_PASSWORD}}"
    tests:
      - assert: status == 200
      - assert: body.success == true
      - assert: body.token != null

  - name: Logout
    method: POST
    path: /auth/logout
    headers:
      Authorization: "Bearer {{AUTH_TOKEN}}"
    tests:
      - assert: status == 204
```

No vendor lock-in. Edit with any text editor. Diff in any Git client.

---

## AI Features

### Test Generation
After sending a request, Flux sends the request + response to Claude with a structured prompt. Claude returns assertions in the collection format shown above. You review them, accept or discard, and they are written back to the `.yaml` file.

### Debug Assist
On a 4xx or 5xx response, the AI panel explains the likely cause and suggests fixes based on the request headers, body, and response error message.

### Prompt structure (simplified)
```
Given this HTTP request and response, generate test assertions.

Request:
  POST /auth/login
  Body: { "email": "...", "password": "..." }

Response:
  Status: 200
  Body: { "success": true, "token": "eyJ...", "user": { ... } }

Return YAML assertions only. No explanation.
```

---

## Environments

Environments are stored as `.yaml` files alongside collections. Variables are resolved at request time by the Rust core, never exposed to the network in raw form.

```yaml
# environments/development.yaml
name: Development
variables:
  BASE_URL: https://api.dev.myapp.com
  API_KEY: sk-dev-xxxxxxxxxxxx
  TIMEOUT_MS: 5000
  DEBUG_MODE: true
```

Production environments can be marked as `protected: true` — Flux shows a red indicator and requires confirmation before sending requests.

---

## Roadmap

### v0.1 — MVP (free, open source)
- [x] Send HTTP requests (GET, POST, PUT, PATCH, DELETE)
- [x] Collections as local `.yaml` files
- [x] Environment variables
- [x] Request history (SQLite)
- [x] AI test generation via Claude API
- [x] Email/password login + sign up

### v0.2 — Developer Experience
- [x] Keyboard shortcuts (Ctrl+Enter to send, Ctrl+S to save)
- [x] Pre-request scripts (JavaScript) — `pm` API for headers and env vars
- [ ] Response comparison between environments
- [ ] GraphQL support
- [ ] WebSocket support
- [ ] gRPC support

### v1.0 — Team Features (paid)
- [ ] Collection sync across devices (Flux Cloud)
- [ ] Shared environments for teams
- [ ] PR-linked collection diffs
- [ ] Team test run history

---

## Monetization

**Free forever** — individual developers.
- All core features unlocked
- AI test generation (uses your own Claude API key)
- Local-only, no account required

**Flux Teams — $8/user/month**
- Collection sync via Flux Cloud
- Shared environments with role-based access
- Team test history and reporting
- Priority support

---

## Development Setup

```bash
# Prerequisites: Node.js 20+, Rust 1.75+, Tauri CLI

git clone https://github.com/your-org/flux
cd flux

# Install frontend dependencies
npm install

# Install Tauri CLI
cargo install tauri-cli

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

---

## License

MIT — free to use, fork, and self-host.

---

Built with [Tauri](https://tauri.app) · [React](https://react.dev) · [Claude](https://anthropic.com) · Rust
