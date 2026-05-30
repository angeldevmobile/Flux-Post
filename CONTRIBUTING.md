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

```sh
# Windows (PowerShell)
.\build.ps1

# Other platforms
npm run tauri build
```

---

## Project layout

```
src/              React + TypeScript frontend
src-tauri/        Rust backend (Tauri commands)
flux-cli/         Standalone CLI runner (separate Cargo project)
docs/             GitHub Pages landing page
scripts/          Version bump automation
```

Key source files:

| File | Purpose |
|------|---------|
| `src/App.tsx` | Auth flow + app shell |
| `src/components/` | All UI components |
| `src/routes/` | Screen-level components |
| `src/stores/` | Zustand state management |
| `src-tauri/src/commands/` | Tauri command handlers |

---

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Keep changes focused — one feature or fix per PR.
3. Test your changes manually before opening the PR.
4. Write a clear PR description: what changed and why.
5. Open the PR against `main`.

---

## Reporting bugs

Open an issue with:

- Flux version (visible in the title bar)
- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Logs from **Settings → Logs** if applicable

---

## Feature requests

Open an issue with the `enhancement` label. Describe the use case, not just the solution.

---

## License

By contributing you agree that your changes will be licensed under the [MIT License](LICENSE).
