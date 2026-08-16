// Single source of truth for the app version in the frontend.
// Kept in sync with package.json / Cargo.toml / tauri.conf.json by
// `npm run release <version>` (scripts/bump-version.cjs) — do not edit by hand.
export const APP_VERSION = "0.1.6";
