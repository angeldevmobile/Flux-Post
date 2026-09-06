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

// Patterns are anchored to surrounding syntax so an unrelated version-shaped
// string (a dependency range, a date) is never rewritten.
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
    // Only the [package] version.
    patterns: [new RegExp(String.raw`(^version = ")${SEMVER}(")`, 'm')],
  },
  {
    file: 'flux-cli/Cargo.toml',
    // Only the [package] version. The CLI ships inside the app as a resource,
    // so `flux --version` has to agree with the app it came in.
    patterns: [new RegExp(String.raw`(^version = ")${SEMVER}(")`, 'm')],
  },
  {
    file: 'src/lib/version.ts',
    patterns: [new RegExp(String.raw`(APP_VERSION = ")${SEMVER}(")`)],
  },
  {
    file: 'docs/index.html',
    patterns: [
      new RegExp(String.raw`(<span class="badge">v)${SEMVER}(</span>)`),
      // Illustrative User-Agent in the AI-debug demo.
      new RegExp(String.raw`(Flux/)${SEMVER}()`, 'g'),
      // Direct download links in the platform cards, plus the installer URL
      // inside the main-download script. These are real asset names: get one
      // wrong and the link 404s, which is why every file has its own pattern.
      new RegExp(String.raw`(/download/Flux_)${SEMVER}(_x64-setup.exe)`, 'g'),
      new RegExp(String.raw`(/download/Flux_)${SEMVER}(_aarch64.dmg)`, 'g'),
      new RegExp(String.raw`(/download/Flux_)${SEMVER}(_x64.dmg)`, 'g'),
      new RegExp(String.raw`(/download/Flux_)${SEMVER}(_amd64.deb)`, 'g'),
      new RegExp(String.raw`(/download/Flux_)${SEMVER}(_amd64.AppImage)`, 'g'),
      new RegExp(String.raw`(/download/Flux-)${SEMVER}(-1.x86_64.rpm)`, 'g'),
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
