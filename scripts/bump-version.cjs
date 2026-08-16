#!/usr/bin/env node
// Usage: npm run release <version>
// Example: npm run release 0.1.7
//
// Single entry point for bumping the app version. Every place the version is
// written down is listed in TARGETS below — if you add a new one, add it here
// too, or it will silently drift.
//
// Note: the updater's latest.json is NOT maintained here. tauri-action
// generates it at release time (bundle.createUpdaterArtifacts = true) and
// uploads it as a release asset, which is what the updater endpoint serves.

const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run release <version>');
  console.error('Example: npm run release 0.1.7');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const SEMVER = String.raw`\d+\.\d+\.\d+`;

// Each target: a file plus the patterns whose captured version gets replaced.
// Patterns are anchored to surrounding syntax so we never rewrite an unrelated
// version-shaped string (a dependency range, a date, a proto number).
const TARGETS = [
  {
    file: 'package.json',
    patterns: [new RegExp(String.raw`("version":\s*")${SEMVER}(")`)],
  },
  {
    file: 'src-tauri/tauri.conf.json',
    patterns: [new RegExp(String.raw`("version":\s*")${SEMVER}(")`)],
  },
  {
    file: 'src-tauri/Cargo.toml',
    // Only the [package] version — the first `version =` at line start.
    patterns: [new RegExp(String.raw`(^version = ")${SEMVER}(")`, 'm')],
  },
  {
    file: 'src/lib/version.ts',
    // Frontend single source of truth — analytics tags + Settings UI read this.
    patterns: [new RegExp(String.raw`(APP_VERSION = ")${SEMVER}(")`)],
  },
  {
    file: 'docs/index.html',
    patterns: [
      new RegExp(String.raw`(<span class="badge">v)${SEMVER}(</span>)`),
      // Illustrative User-Agent in the AI-debug demo, kept in sync on purpose.
      new RegExp(String.raw`(Flux/)${SEMVER}()`, 'g'),
    ],
  },
  {
    file: 'docs/docs.html',
    patterns: [new RegExp(String.raw`(<span class="topbar-version">v)${SEMVER}(</span>)`)],
  },
];

let failed = false;

for (const { file, patterns } of TARGETS) {
  const full = path.join(root, file);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    console.error(`  ✗ ${file} — not found`);
    failed = true;
    continue;
  }

  let hits = 0;
  for (const re of patterns) {
    if (!re.test(text)) {
      console.error(`  ✗ ${file} — pattern did not match: ${re}`);
      failed = true;
      continue;
    }
    text = text.replace(re, (_m, before, after) => {
      hits++;
      return `${before}${version}${after}`;
    });
  }

  if (hits > 0) {
    fs.writeFileSync(full, text);
    console.log(`  ✓ ${file} → ${version} (${hits} ${hits === 1 ? 'spot' : 'spots'})`);
  }
}

if (failed) {
  console.error('\nSome targets did not match. Fix the patterns above before tagging —');
  console.error('a silent miss is how versions drift apart.');
  process.exit(1);
}

console.log(`\nVersion bumped to v${version}. Next steps:\n`);
console.log(`  npx tsc --noEmit`);
console.log(`  git add -A`);
console.log(`  git commit -m "chore: bump to v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push && git push origin v${version}`);
