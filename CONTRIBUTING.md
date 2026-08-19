# Contributing to Flux

Thank you for your interest in Flux. Contributions are welcome — bug reports, feature requests, documentation improvements, and code changes.

---

## Before you start

- Search [existing issues](https://github.com/angeldevmobile/Flux-Post/issues) before opening a new one.
- For large changes, open an issue first to discuss the approach before writing code.

---

## Development setup

**Prerequisites**

| Tool | Version |
|------|---------|
| Rust | stable (via `rustup`) |
| Node.js | LTS |
| npm | bundled with Node |
| Tauri CLI | v2 (`npm i -g @tauri-apps/cli`) |

**Clone and run**

```sh
git clone https://github.com/angeldevmobile/Flux-Post.git
cd Flux-Post
npm install
npm run tauri dev
```

The dev server starts Vite for the frontend and Tauri for the native shell. Hot-reload is active for the React frontend; Rust changes require a recompile.

**Build for production**

The desktop app bundles the CLI binary as a resource (see `resources` in
`src-tauri/tauri.conf.json`), so `flux-cli` has to be built in release mode
first. On Windows `build.ps1` does both in order:

```sh
# Windows (PowerShell)
.\build.ps1

# Other platforms
cargo build --release --manifest-path flux-cli/Cargo.toml
npm run tauri build
```

Skipping the CLI build makes the Tauri build fail on a missing resource.

The production build differs from `tauri dev` in ways worth checking before
calling a change done: a stricter Content Security Policy applies, and devtools
are not available. If your change touches the frontend, run it at least once.

---

## Project layout

```
src/              React + TypeScript frontend
  lib/            Logic with no UI: assertions, importers, exporters, scripts
  lib/__tests__/  Vitest suites for the above
src-tauri/        Rust backend (Tauri commands)
flux-cli/         Standalone CLI runner (separate Cargo project)
supabase/         SQL schema, applied by hand in the Supabase SQL editor
docs/             GitHub Pages landing page and documentation
scripts/          Version bump automation
```

Key source files:

| File | Purpose |
|------|---------|
| `src/App.tsx` | Auth flow + app shell |
| `src/components/` | All UI components |
| `src/routes/` | Screen-level components |
| `src/stores/` | Zustand state management |
| `src/lib/` | Pure logic, unit tested |
| `src-tauri/src/commands/` | Tauri command handlers |
| `flux-cli/src/js_shim.js` | The `pm` API for the CLI, mirroring `src/lib/preRequest.ts` |

---

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Keep changes focused — one feature or fix per PR.
3. Run the same checks CI runs (below). Clippy runs with `-D warnings`, so a
   warning fails the build.
4. Write a clear PR description: what changed and why.
5. Open the PR against `main`.

**What CI checks**

```sh
npm run typecheck
npm run test
npm run build

cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
cargo clippy --manifest-path flux-cli/Cargo.toml -- -D warnings
cargo test   --manifest-path src-tauri/Cargo.toml --lib
cargo test   --manifest-path flux-cli/Cargo.toml
```

Behaviour that can be tested without a running app belongs in a test. The
assertion engine, the importers and exporters, and the CLI script runner all
have suites you can extend rather than start from scratch.

---

## Reporting bugs

Open an issue with:

- Flux version (visible in the title bar)
- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Any error text the app showed
- Output from the **Console** tab in the response panel, if a script was involved

---

## Feature requests

Open an issue with the `enhancement` label. Describe the use case, not just the solution.

---

## Releasing

The version lives in several files. `npm run release <version>` updates all of
them and fails loudly if any stops matching, so never bump one by hand. Add the
release to `CHANGELOG.md` and to `src/lib/whatsNew.ts`, which is what the app
shows in the bell menu.

---

## License

By contributing you agree that your changes will be licensed under the [MIT License](LICENSE).
