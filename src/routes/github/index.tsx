import { useState, useEffect, useCallback, useRef } from "react";
import { GH_TOKEN_KEY, GH_USER_KEY } from "@/lib/githubKeys";
import { flushSync } from "react-dom";
import { Search, Lock, Globe, ArrowDown, ArrowUp, Check, Loader2, AlertCircle, LogOut, RefreshCw, X, ExternalLink, Folder, FileText, ChevronRight, Home } from "lucide-react";
import { GitHubIcon } from "@/components/GitHubIcon";
import { githubListYamlFiles, githubWriteYamlFileSubdir } from "@/lib/tauri";
import { loadCollections } from "@/lib/tauri";
import { useCollectionsStore } from "@/stores/collections";

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

/*    Connect Panel                                               */

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
          <GitHubIcon size={28} style={{ color: "var(--color-accent)" }} />
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
            : <><GitHubIcon size={14} /> Connect to GitHub</>}
        </button>
      </div>
    </div>
  );
}

/*    Sync Panel — repo file browser                             */

function SyncPanel({
  token, repo, onClose,
}: {
  token: string;
  repo: GitHubRepo;
  onClose: () => void;
}) {
  const collectionsDir = localStorage.getItem(COLLECTIONS_DIR_KEY);
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [items, setItems] = useState<GitHubContentItem[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle" });
  const [log, setLog] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const currentPath = pathStack.join("/");

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  // Load folder contents whenever pathStack changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBrowsing(true);
      setBrowseError(null);
      setSelected(new Set());
      try {
        const url = `/repos/${repo.full_name}/contents/${currentPath}`;
        const res = await ghFetch(token, url);
        if (!res.ok) throw new Error(`Cannot read folder (${res.status})`);
        const data: GitHubContentItem[] = await res.json();
        if (!cancelled) {
          // dirs first, then files
          setItems([
            ...data.filter(i => i.type === "dir").sort((a, b) => a.name.localeCompare(b.name)),
            ...data.filter(i => i.type === "file").sort((a, b) => a.name.localeCompare(b.name)),
          ]);
        }
      } catch (e) {
        if (!cancelled) setBrowseError(String(e));
      } finally {
        if (!cancelled) setBrowsing(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token, repo.full_name, currentPath]);

  function navigateInto(name: string) {
    setPathStack(p => [...p, name]);
    setStatus({ kind: "idle" });
    setLog([]);
  }

  function navigateTo(idx: number) {
    setPathStack(p => p.slice(0, idx));
    setStatus({ kind: "idle" });
    setLog([]);
  }

  function addLog(text: string, kind: LogLine["kind"] = "info") {
    flushSync(() => setLog(p => [...p, { text, kind }]));
  }

  const yamlItems = items.filter(i => i.type === "file" && (i.name.endsWith(".yaml") || i.name.endsWith(".yml")));

  function toggleFile(path: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  function toggleAll() {
    const allPaths = yamlItems.map(f => f.path);
    const allSelected = allPaths.every(p => selected.has(p));
    setSelected(allSelected ? new Set() : new Set(allPaths));
  }

  async function handlePull() {
    if (!collectionsDir) { setStatus({ kind: "error", msg: "Set a collections folder first in the Collections sidebar" }); return; }
    const toDownload = yamlItems.filter(f => selected.has(f.path));
    if (toDownload.length === 0) return;

    setStatus({ kind: "loading", msg: "Pulling…" });
    setLog([]);
    setProgress({ done: 0, total: toDownload.length });
    try {
      for (let idx = 0; idx < toDownload.length; idx++) {
        const file = toDownload[idx];
        if (!file.download_url) continue;
        addLog(`↓ ${file.name}`, "info");
        const content = await fetch(file.download_url).then(r => r.text());
        await githubWriteYamlFileSubdir(collectionsDir, repo.name, file.name, content);
        addLog(`✓ ${file.name} — saved`, "ok");
        setProgress({ done: idx + 1, total: toDownload.length });
      }
      addLog(`    Reloading collections…`, "info");
      const loaded = await loadCollections(collectionsDir);
      useCollectionsStore.setState({ collections: loaded });
      addLog(`✓ Collections updated`, "ok");
      setStatus({ kind: "ok", msg: `${toDownload.length} file${toDownload.length !== 1 ? "s" : ""} pulled` });
      setProgress(null);
      setSelected(new Set());
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
      if (files.length === 0) throw new Error("No .yaml files found in local collections folder");

      setProgress({ done: 0, total: files.length });
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
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
      setStatus({ kind: "ok", msg: `${files.length} file${files.length !== 1 ? "s" : ""} pushed to ${currentPath || "root"}` });
      setProgress(null);
    } catch (e) {
      addLog(`✗ ${String(e)}`, "error");
      setStatus({ kind: "error", msg: String(e) });
      setProgress(null);
    }
  }

  const logColor = (kind: LogLine["kind"]) =>
    kind === "ok" ? "#22C55E" : kind === "error" ? "#EF4444" : "var(--color-fg-3)";

  const selectedCount = selected.size;
  const allYamlSelected = yamlItems.length > 0 && yamlItems.every(f => selected.has(f.path));
  const isBusy = status.kind === "loading";

  return (
    <div className="flex flex-col h-full" style={{ borderLeft: "1px solid var(--color-border)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
        {repo.private ? <Lock size={12} style={{ color: "var(--color-fg-4)" }} /> : <Globe size={12} style={{ color: "var(--color-fg-4)" }} />}
        <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: "var(--color-fg)" }}>{repo.name}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-topbar)", color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
          {repo.default_branch}
        </span>
        <button onClick={onClose} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, color: "var(--color-fg-4)" }}>
          <X size={13} />
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 shrink-0 overflow-x-auto" style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
        <button
          onClick={() => navigateTo(0)}
          className="flex items-center gap-1 transition-opacity hover:opacity-70 shrink-0"
          style={{ color: pathStack.length === 0 ? "var(--color-fg-2)" : "var(--color-accent)", fontSize: 11 }}
        >
          <Home size={11} /> root
        </button>
        {pathStack.map((seg, idx) => (
          <span key={idx} className="flex items-center gap-1 shrink-0">
            <ChevronRight size={10} style={{ color: "var(--color-fg-4)" }} />
            <button
              onClick={() => navigateTo(idx + 1)}
              className="transition-opacity hover:opacity-70 text-[11px]"
              style={{ color: idx === pathStack.length - 1 ? "var(--color-fg-2)" : "var(--color-accent)" }}
            >
              {seg}
            </button>
          </span>
        ))}
        {browsing && <Loader2 size={11} className="animate-spin ml-1 shrink-0" style={{ color: "var(--color-fg-4)" }} />}
      </div>

      {/* File browser */}
      <div className="flex-1 overflow-y-auto">
        {browseError && (
          <div className="flex items-center gap-2 m-3 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
            <AlertCircle size={12} /> {browseError}
          </div>
        )}

        {/* Select-all row (only when yaml files exist) */}
        {!browsing && yamlItems.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
            <input
              type="checkbox"
              checked={allYamlSelected}
              onChange={toggleAll}
              style={{ accentColor: "var(--color-accent)", width: 13, height: 13 }}
            />
            <span className="flex-1 text-[11px]" style={{ color: "var(--color-fg-4)" }}>
              Select all .yaml files
            </span>
            {selectedCount > 0 && (
              <span className="text-[11px] font-medium" style={{ color: "var(--color-accent)" }}>
                {selectedCount} selected
              </span>
            )}
          </div>
        )}

        {!browsing && items.map(item => {
          const isYaml = item.type === "file" && (item.name.endsWith(".yaml") || item.name.endsWith(".yml"));
          const isChecked = selected.has(item.path);

          if (item.type === "dir") {
            return (
              <button
                key={item.path}
                onClick={() => navigateInto(item.name)}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left transition-colors"
                style={{ borderBottom: "1px solid var(--color-border)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <Folder size={14} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
                <span className="flex-1 text-[13px]" style={{ color: "var(--color-fg-2)" }}>{item.name}</span>
                <ChevronRight size={12} style={{ color: "var(--color-fg-4)" }} />
              </button>
            );
          }

          if (isYaml) {
            return (
              <label
                key={item.path}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 cursor-pointer transition-colors"
                style={{ borderBottom: "1px solid var(--color-border)", background: isChecked ? "var(--color-accent-10)" : "transparent" }}
                onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = "var(--color-card)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = isChecked ? "var(--color-accent-10)" : "transparent"; }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleFile(item.path)}
                  style={{ accentColor: "var(--color-accent)", width: 13, height: 13, flexShrink: 0 }}
                />
                <FileText size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
                <span className="flex-1 text-[13px] truncate" style={{ color: isChecked ? "var(--color-fg)" : "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}>
                  {item.name}
                </span>
              </label>
            );
          }

          // other files — no checkbox, dimmed
          return (
            <div
              key={item.path}
              className="flex items-center gap-2.5 px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <FileText size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
              <span className="flex-1 text-[13px] truncate" style={{ color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                {item.name}
              </span>
            </div>
          );
        })}

        {!browsing && !browseError && items.length === 0 && (
          <div className="flex items-center justify-center py-12 text-[12px]" style={{ color: "var(--color-fg-4)" }}>
            Empty folder
          </div>
        )}
      </div>

      {/* Progress + log + status */}
      {(progress || log.length > 0 || status.kind === "ok" || status.kind === "error") && (
        <div className="flex flex-col gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          {progress && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]" style={{ color: "var(--color-fg-4)" }}>
                <span>Syncing…</span>
                <span>{progress.done}/{progress.total} files</span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 3, background: "var(--color-border)" }}>
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--color-accent)" }} />
              </div>
            </div>
          )}
          {log.length > 0 && (
            <div className="rounded-lg px-3 py-2 text-[11px] overflow-y-auto"
              style={{ background: "var(--color-topbar)", border: "1px solid var(--color-border)", fontFamily: "Geist Mono, monospace", lineHeight: 1.8, maxHeight: 100 }}>
              {log.map((l, i) => <div key={i} style={{ color: logColor(l.kind) }}>{l.text}</div>)}
              <div ref={logEndRef} />
            </div>
          )}
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
        </div>
      )}

      {/* Actions */}
      {!collectionsDir && (
        <div className="flex items-center gap-2 mx-4 mb-3 rounded-lg px-3 py-2 text-[12px]"
          style={{ background: "#F59E0B15", border: "1px solid #F59E0B30", color: "#F59E0B" }}>
          <AlertCircle size={12} /> Set a local collections folder first
        </div>
      )}
      <div className="flex gap-2 px-4 pb-4 pt-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={handlePull}
          disabled={!collectionsDir || selectedCount === 0 || isBusy}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ height: 36, fontSize: 12, background: "var(--color-topbar)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}
        >
          {isBusy && status.msg === "Pulling…" ? <Loader2 size={13} className="animate-spin" /> : <ArrowDown size={13} />}
          {selectedCount > 0 ? `Pull ${selectedCount} file${selectedCount !== 1 ? "s" : ""}` : "Pull selected"}
        </button>
        <button
          onClick={handlePush}
          disabled={!collectionsDir || isBusy}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ height: 36, fontSize: 12, background: "var(--color-accent)", color: "white" }}
        >
          {isBusy && status.msg.includes("Reading") ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
          Push here
        </button>
      </div>
    </div>
  );
}

/*    Modal                                                       */

export function GitHubModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    if (open && token && repos.length === 0) loadRepos(token);
  }, [open, token, repos.length, loadRepos]);

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: selectedRepo ? 900 : 560,
          height: "78vh",
          maxHeight: 680,
          background: "var(--color-topbar)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          transition: "width 0.2s ease",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 shrink-0 px-5" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
          <GitHubIcon size={16} style={{ color: "var(--color-fg-2)" }} />
          <span className="flex-1 text-[14px] font-semibold" style={{ color: "var(--color-fg)" }}>GitHub Sync</span>
          {user && (
            <div className="flex items-center gap-2 mr-1">
              <img src={user.avatar_url} alt="" className="rounded-full" style={{ width: 20, height: 20 }} />
              <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>{user.login}</span>
              <button onClick={() => token && loadRepos(token)} disabled={loading} title="Refresh"
                className="flex items-center justify-center rounded disabled:opacity-40" style={{ width: 24, height: 24, color: "var(--color-fg-4)" }}>
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              </button>
              <button onClick={handleDisconnect}
                className="flex items-center gap-1 px-2 rounded text-[11px] transition-opacity hover:opacity-80"
                style={{ height: 24, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-4)" }}>
                <LogOut size={11} /> Disconnect
              </button>
            </div>
          )}
          <button onClick={onClose} className="flex items-center justify-center rounded" style={{ width: 26, height: 26, color: "var(--color-fg-4)" }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        {!token ? (
          <ConnectPanel onConnected={handleConnected} />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Repo list */}
            <div className="flex flex-col overflow-hidden" style={{ flex: 1, minWidth: 0 }}>
              <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 42, borderBottom: "1px solid var(--color-border)" }}>
                <Search size={13} style={{ color: "var(--color-fg-4)" }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search repositories…"
                  className="flex-1 bg-transparent text-[13px]"
                  style={{ color: "var(--color-fg-2)" }}
                  autoFocus
                />
                {search && <button onClick={() => setSearch("")} style={{ color: "var(--color-fg-4)" }}><X size={12} /></button>}
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center gap-2 py-12 text-[13px]" style={{ color: "var(--color-fg-4)" }}>
                    <Loader2 size={14} className="animate-spin" /> Loading repositories…
                  </div>
                )}
                {loadError && (
                  <div className="flex items-center gap-2 m-4 rounded-lg px-3 py-2.5 text-[12px]"
                    style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
                    <AlertCircle size={12} /> {loadError}
                  </div>
                )}
                {!loading && filtered.map(repo => {
                  const isSelected = selectedRepo?.id === repo.id;
                  return (
                    <button
                      key={repo.id}
                      onClick={() => setSelectedRepo(isSelected ? null : repo)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left transition-colors"
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        background: isSelected ? "var(--color-accent-10)" : "transparent",
                        borderLeft: isSelected ? "2px solid var(--color-accent)" : "2px solid transparent",
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--color-card)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isSelected ? "var(--color-accent-10)" : "transparent"; }}
                    >
                      {repo.private
                        ? <Lock size={12} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
                        : <Globe size={12} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />}
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
                          style={{ background: "var(--color-sidebar)", color: "var(--color-fg-4)", fontFamily: "Geist Mono, monospace" }}>
                          {repo.default_branch}
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>{timeAgo(repo.updated_at)}</span>
                      </div>
                    </button>
                  );
                })}
                {!loading && repos.length > 0 && filtered.length === 0 && (
                  <div className="flex items-center justify-center py-12 text-[13px]" style={{ color: "var(--color-fg-4)" }}>
                    No repos match "{search}"
                  </div>
                )}
              </div>
            </div>

            {/* Sync panel */}
            {selectedRepo && token && (
              <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 360 }}>
                <SyncPanel token={token} repo={selectedRepo} onClose={() => setSelectedRepo(null)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
