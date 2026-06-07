import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { GitBranch, Search, Lock, Globe, ArrowDown, ArrowUp, Check, Loader2, AlertCircle, LogOut, RefreshCw, X, ExternalLink } from "lucide-react";
import { githubListYamlFiles, githubWriteYamlFile } from "@/lib/tauri";
import { loadCollections } from "@/lib/tauri";
import { useCollectionsStore } from "@/stores/collections";

const GH_TOKEN_KEY  = "flux_github_token";
const GH_USER_KEY   = "flux_github_user";
const COLLECTIONS_DIR_KEY = "flux_collections_dir";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
  public_repos: number;
  total_private_repos: number;
}

interface GitHubContentItem {
  name: string;
  type: "file" | "dir";
  download_url: string | null;
  sha: string;
  path: string;
}

type SyncStatus = { kind: "idle" } | { kind: "loading"; msg: string } | { kind: "ok"; msg: string } | { kind: "error"; msg: string };
type LogLine = { text: string; kind: "info" | "ok" | "error" };

function ghFetch(token: string, path: string, opts?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts?.headers ?? {}),
    },
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

/* ── Connect Panel ───────────────────────────────────────────── */

function ConnectPanel({ onConnected }: { onConnected: (token: string, user: GitHubUser) => void }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle" });

  async function openTokenPage() {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("https://github.com/settings/tokens/new?scopes=repo&description=Flux+API+Client");
  }

  async function handleConnect() {
    if (!token.trim()) return;
    setStatus({ kind: "loading", msg: "Verifying token…" });
    try {
      const res = await ghFetch(token.trim(), "/user");
      if (!res.ok) throw new Error("Invalid token — make sure it has `repo` scope");
      const user: GitHubUser = await res.json();
      localStorage.setItem(GH_TOKEN_KEY, token.trim());
      localStorage.setItem(GH_USER_KEY, JSON.stringify(user));
      onConnected(token.trim(), user);
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 px-8" style={{ maxWidth: 460, margin: "0 auto" }}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center justify-center rounded-2xl" style={{ width: 64, height: 64, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
          <GitBranch size={28} style={{ color: "var(--color-accent)" }} />
        </div>
        <h2 className="text-[18px] font-semibold" style={{ color: "var(--color-fg)" }}>Connect to GitHub</h2>
        <p className="text-[13px]" style={{ color: "var(--color-fg-3)", lineHeight: 1.6 }}>
          Sync your collections directly from GitHub repos. Pull to import, push to save changes — no commands needed.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[12px] font-medium" style={{ color: "var(--color-fg-3)" }}>Personal Access Token</label>
            <button
              onClick={openTokenPage}
              className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
              style={{ color: "var(--color-accent)" }}
            >
              Create token <ExternalLink size={11} />
            </button>
          </div>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleConnect()}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            className="w-full px-3 rounded-lg text-[13px]"
            style={{
              height: 40, background: "var(--color-input)",
              border: "1px solid var(--color-border)", color: "var(--color-fg-2)",
              fontFamily: "Geist Mono, monospace",
            }}
            autoFocus
          />
          <p className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
            Needs <code style={{ background: "var(--color-card)", padding: "0 4px", borderRadius: 3 }}>repo</code> scope. Token is stored locally on this device only.
          </p>
        </div>

        {status.kind === "error" && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[12px]"
            style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
            <AlertCircle size={13} /> {status.msg}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={!token.trim() || status.kind === "loading"}
          className="flex items-center justify-center gap-2 w-full rounded-lg font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ height: 42, fontSize: 14, background: "var(--color-accent)" }}
        >
          {status.kind === "loading"
            ? <><Loader2 size={14} className="animate-spin" /> Connecting…</>
            : <><GitBranch size={14} /> Connect to GitHub</>}
        </button>
      </div>
    </div>
  );
}

/* ── Sync Panel (appears when repo selected) ─────────────────── */

function SyncPanel({
  token, repo, onClose,
}: {
  token: string;
  repo: GitHubRepo;
  onClose: () => void;
}) {
  const collectionsDir = localStorage.getItem(COLLECTIONS_DIR_KEY);
  const [path, setPath] = useState("collections");
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle" });
  const [log, setLog] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  function addLog(text: string, kind: LogLine["kind"] = "info") {
    flushSync(() => setLog(p => [...p, { text, kind }]));
  }

  async function handlePull() {
    if (!collectionsDir) { setStatus({ kind: "error", msg: "Set a collections folder first in the Collections sidebar" }); return; }
    setStatus({ kind: "loading", msg: "Fetching files from GitHub…" });
    setLog([]);
    setProgress(null);
    try {
      const url = `/repos/${repo.full_name}/contents/${path.trim()}`;
      const res = await ghFetch(token, url);
      if (!res.ok) throw new Error(`Folder not found in repo (${res.status}). Check the path.`);
      const items: GitHubContentItem[] = await res.json();
      const yaml = items.filter(i => i.type === "file" && (i.name.endsWith(".yaml") || i.name.endsWith(".yml")));
      if (yaml.length === 0) throw new Error("No .yaml files found in that folder");

      setProgress({ done: 0, total: yaml.length });
      for (let idx = 0; idx < yaml.length; idx++) {
        const file = yaml[idx];
        if (!file.download_url) continue;
        addLog(`↓ ${file.name}`, "info");
        const content = await fetch(file.download_url).then(r => r.text());
        await githubWriteYamlFile(collectionsDir, file.name, content);
        addLog(`✓ ${file.name} — saved`, "ok");
        setProgress({ done: idx + 1, total: yaml.length });
      }

      addLog(`─── Reloading collections…`, "info");
      const loaded = await loadCollections(collectionsDir);
      useCollectionsStore.setState({ collections: loaded });
      addLog(`✓ Collections updated`, "ok");

      setStatus({ kind: "ok", msg: `${yaml.length} file${yaml.length !== 1 ? "s" : ""} pulled and reloaded` });
      setProgress(null);
    } catch (e) {
      addLog(`✗ ${String(e)}`, "error");
      setStatus({ kind: "error", msg: String(e) });
      setProgress(null);
    }
  }

  async function handlePush() {
    if (!collectionsDir) { setStatus({ kind: "error", msg: "Set a collections folder first in the Collections sidebar" }); return; }
    setStatus({ kind: "loading", msg: "Reading local collections…" });
    setLog([]);
    setProgress(null);
    try {
      const files = await githubListYamlFiles(collectionsDir);
      if (files.length === 0) throw new Error("No .yaml files found in collections folder");

      const basePath = path.trim().replace(/\/$/, "");
      setProgress({ done: 0, total: files.length });

      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const filePath = basePath ? `${basePath}/${file.name}` : file.name;
        addLog(`↑ ${file.name}`, "info");

        const bytes = new TextEncoder().encode(file.content);
        let binary = "";
        bytes.forEach(b => (binary += String.fromCharCode(b)));
        const contentB64 = btoa(binary);

        const checkRes = await ghFetch(token, `/repos/${repo.full_name}/contents/${filePath}`);
        const sha = checkRes.ok ? (await checkRes.json()).sha as string : undefined;

        const body: Record<string, string> = {
          message: `sync: update ${file.name} via Flux`,
          content: contentB64,
          branch: repo.default_branch,
        };
        if (sha) body.sha = sha;

        const putRes = await ghFetch(token, `/repos/${repo.full_name}/contents/${filePath}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!putRes.ok) throw new Error(`Failed to push ${file.name}: ${putRes.status}`);
        addLog(`✓ ${file.name} — pushed`, "ok");
        setProgress({ done: idx + 1, total: files.length });
      }

      setStatus({ kind: "ok", msg: `${files.length} file${files.length !== 1 ? "s" : ""} pushed to ${repo.full_name}` });
      setProgress(null);
    } catch (e) {
      addLog(`✗ ${String(e)}`, "error");
      setStatus({ kind: "error", msg: String(e) });
      setProgress(null);
    }
  }

  const logColor = (kind: LogLine["kind"]) =>
    kind === "ok" ? "#22C55E" : kind === "error" ? "#EF4444" : "var(--color-fg-3)";

  return (
    <div className="flex flex-col rounded-xl overflow-hidden shrink-0"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 shrink-0" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
        {repo.private ? <Lock size={13} style={{ color: "var(--color-fg-4)" }} /> : <Globe size={13} style={{ color: "var(--color-fg-4)" }} />}
        <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: "var(--color-fg)" }}>{repo.full_name}</span>
        <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: "var(--color-topbar)", color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
          {repo.default_branch}
        </span>
        <button onClick={onClose} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, color: "var(--color-fg-4)" }}>
          <X size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Path */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] shrink-0" style={{ color: "var(--color-fg-3)" }}>Folder path</span>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="collections"
            className="flex-1 px-3 rounded-lg text-[12px]"
            style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}
          />
        </div>

        {!collectionsDir && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: "#F59E0B15", border: "1px solid #F59E0B30", color: "#F59E0B" }}>
            <AlertCircle size={12} /> Open Collections and set a local folder first
          </div>
        )}

        {/* Progress bar */}
        {progress && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px]" style={{ color: "var(--color-fg-4)" }}>
              <span>Syncing…</span>
              <span>{progress.done}/{progress.total} files</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: "var(--color-border)" }}>
              <div className="h-full rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--color-accent)" }} />
            </div>
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="rounded-lg p-3 text-[11px] overflow-y-auto"
            style={{ background: "var(--color-topbar)", border: "1px solid var(--color-border)", fontFamily: "Geist Mono, monospace", lineHeight: 1.9, maxHeight: 180 }}>
            {log.map((l, i) => (
              <div key={i} style={{ color: logColor(l.kind) }}>{l.text}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Status */}
        {status.kind === "ok" && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: "#22C55E15", border: "1px solid #22C55E30", color: "#22C55E" }}>
            <Check size={12} /> {status.msg}
          </div>
        )}
        {status.kind === "error" && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
            <AlertCircle size={12} /> {status.msg}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handlePull}
            disabled={!collectionsDir || status.kind === "loading"}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ height: 36, fontSize: 12, background: "var(--color-topbar)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}
          >
            {status.kind === "loading" && status.msg.includes("Fetch")
              ? <Loader2 size={13} className="animate-spin" /> : <ArrowDown size={13} />}
            Pull from GitHub
          </button>
          <button
            onClick={handlePush}
            disabled={!collectionsDir || status.kind === "loading"}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ height: 36, fontSize: 12, background: "var(--color-accent)", color: "white" }}
          >
            {status.kind === "loading" && status.msg.includes("Reading")
              ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
            Push to GitHub
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Route ──────────────────────────────────────────────── */

export function GithubRoute() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(GH_TOKEN_KEY));
  const [user, setUser]   = useState<GitHubUser | null>(() => {
    const raw = localStorage.getItem(GH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const [repos, setRepos]           = useState<GitHubRepo[]>([]);
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  const loadRepos = useCallback(async (t: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await ghFetch(t, "/user/repos?per_page=100&sort=updated&type=all");
      if (!res.ok) throw new Error("Failed to load repositories");
      setRepos(await res.json());
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && repos.length === 0) loadRepos(token);
  }, [token, repos.length, loadRepos]);

  function handleConnected(t: string, u: GitHubUser) {
    setToken(t);
    setUser(u);
    loadRepos(t);
  }

  function handleDisconnect() {
    localStorage.removeItem(GH_TOKEN_KEY);
    localStorage.removeItem(GH_USER_KEY);
    setToken(null);
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
  }

  const filtered = repos.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 52, borderBottom: "1px solid var(--color-border)", background: "var(--color-topbar)" }}>
        <GitBranch size={16} style={{ color: "var(--color-accent)" }} />
        <span className="flex-1 text-[15px] font-semibold" style={{ color: "var(--color-fg)" }}>GitHub Sync</span>
        {user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <img src={user.avatar_url} alt="" className="rounded-full" style={{ width: 22, height: 22 }} />
              <span className="text-[13px]" style={{ color: "var(--color-fg-2)" }}>{user.login}</span>
              <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{repos.length} repos</span>
            </div>
            <button
              onClick={() => token && loadRepos(token)}
              disabled={loading}
              className="flex items-center justify-center rounded transition-colors disabled:opacity-40"
              style={{ width: 28, height: 28, color: "var(--color-fg-4)" }}
              title="Refresh repos"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 px-3 rounded-lg text-[12px] transition-opacity hover:opacity-80"
              style={{ height: 28, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
            >
              <LogOut size={12} /> Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {!token ? (
        <ConnectPanel onConnected={handleConnected} />
      ) : (
        <div className="flex flex-1 overflow-hidden gap-0">
          {/* Repo list */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Search */}
            <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
              <Search size={14} style={{ color: "var(--color-fg-4)" }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search repositories…"
                className="flex-1 bg-transparent text-[13px]"
                style={{ color: "var(--color-fg-2)" }}
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ color: "var(--color-fg-4)" }}>
                  <X size={13} />
                </button>
              )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-16 text-[13px]" style={{ color: "var(--color-fg-4)" }}>
                  <Loader2 size={15} className="animate-spin" /> Loading repositories…
                </div>
              )}
              {loadError && (
                <div className="flex items-center gap-2 m-4 rounded-lg px-3 py-2.5 text-[12px]"
                  style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
                  <AlertCircle size={13} /> {loadError}
                </div>
              )}
              {!loading && filtered.map(repo => {
                const isSelected = selectedRepo?.id === repo.id;
                return (
                  <button
                    key={repo.id}
                    onClick={() => setSelectedRepo(isSelected ? null : repo)}
                    className="flex items-center gap-3 w-full px-5 py-3.5 text-left transition-colors"
                    style={{
                      borderBottom: "1px solid var(--color-border)",
                      background: isSelected ? "var(--color-accent-10)" : "transparent",
                      borderLeft: isSelected ? "2px solid var(--color-accent)" : "2px solid transparent",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--color-card)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = isSelected ? "var(--color-accent-10)" : "transparent"; }}
                  >
                    {repo.private
                      ? <Lock size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
                      : <Globe size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium truncate" style={{ color: isSelected ? "var(--color-accent)" : "var(--color-fg)" }}>
                          {repo.name}
                        </span>
                        {repo.private && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: "var(--color-card)", color: "var(--color-fg-4)", border: "1px solid var(--color-border)" }}>
                            Private
                          </span>
                        )}
                      </div>
                      {repo.description && (
                        <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--color-fg-4)" }}>{repo.description}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-topbar)", color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                        {repo.default_branch}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>{timeAgo(repo.updated_at)}</span>
                    </div>
                  </button>
                );
              })}
              {!loading && repos.length > 0 && filtered.length === 0 && (
                <div className="flex items-center justify-center py-16 text-[13px]" style={{ color: "var(--color-fg-4)" }}>
                  No repos match "{search}"
                </div>
              )}
            </div>
          </div>

          {/* Sync panel */}
          {selectedRepo && token && (
            <div className="flex flex-col shrink-0 p-4 overflow-y-auto" style={{ width: 380, borderLeft: "1px solid var(--color-border)" }}>
              <SyncPanel
                token={token}
                repo={selectedRepo}
                onClose={() => setSelectedRepo(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
