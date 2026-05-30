#!/usr/bin/env node
// Usage: node scripts/bump-version.js <version>
// Example: node scripts/bump-version.js 0.1.2

const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/bump-version.js <version>');
  console.error('Example: node scripts/bump-version.js 0.1.2');
  process.exit(1);
}

const root = path.join(__dirname, '..');

// package.json
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`  package.json          → ${version}`);

// tauri.conf.json
const tauriPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
tauri.version = version;
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');
console.log(`  src-tauri/tauri.conf.json → ${version}`);

// src-tauri/Cargo.toml
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
let cargo = fs.readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargo);
console.log(`  src-tauri/Cargo.toml  → ${version}`);

console.log(`\nVersion bumped to v${version}. Next steps:\n`);
console.log(`  git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json`);
console.log(`  git commit -m "chore: bump to v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push && git push origin v${version}`);
