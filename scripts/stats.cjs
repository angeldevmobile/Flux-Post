const REPO = 'angeldevmobile/Flux-Post';

const PLATFORMS = [
  { name: 'Windows', exts: ['.exe', '.msi'] },
  { name: 'macOS', exts: ['.dmg', '.app.tar.gz'] },
  { name: 'Linux', exts: ['.deb', '.rpm', '.AppImage'] },
];

function platformOf(assetName) {
  const hit = PLATFORMS.find(p => p.exts.some(ext => assetName.endsWith(ext)));
  return hit ? hit.name : null;
}

async function fetchReleases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'flux-stats' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const all = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText}. ` +
        (res.status === 403 ? 'Rate limited, set GITHUB_TOKEN and retry.' : ''));
    }
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

function pad(s, n) { return String(s).padEnd(n); }
function padStart(s, n) { return String(s).padStart(n); }

(async function main() {
  let releases;
  try {
    releases = await fetchReleases();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (releases.length === 0) {
    console.log('No releases published yet.');
    return;
  }

  const byPlatform = new Map(PLATFORMS.map(p => [p.name, 0]));
  let grandTotal = 0;

  console.log(`\nFlux downloads  (${REPO})\n`);

  for (const rel of releases.sort((a, b) => new Date(b.published_at) - new Date(a.published_at))) {
    const installers = rel.assets
      .map(a => ({ name: a.name, count: a.download_count, platform: platformOf(a.name) }))
      .filter(a => a.platform !== null);

    const relTotal = installers.reduce((s, a) => s + a.count, 0);
    grandTotal += relTotal;

    const date = rel.published_at ? rel.published_at.slice(0, 10) : 'draft';
    console.log(`${pad(rel.tag_name, 12)} ${date}   ${padStart(relTotal, 6)} downloads`);

    for (const a of installers.sort((x, y) => y.count - x.count)) {
      byPlatform.set(a.platform, byPlatform.get(a.platform) + a.count);
      console.log(`   ${pad(a.platform, 8)} ${pad(a.name, 46)} ${padStart(a.count, 6)}`);
    }
    console.log('');
  }

  console.log('By platform');
  for (const [name, count] of byPlatform) {
    const pct = grandTotal > 0 ? ((count / grandTotal) * 100).toFixed(1) : '0.0';
    console.log(`   ${pad(name, 10)} ${padStart(count, 6)}  ${padStart(pct, 5)}%`);
  }
  console.log(`\nTotal installers downloaded: ${grandTotal}\n`);
})();
