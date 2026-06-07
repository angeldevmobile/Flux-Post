import { useState } from "react";
import { GitBranch, X, Search, Lock, Globe, ChevronRight, ArrowDown, ArrowUp, Check, Loader2, AlertCircle } from "lucide-react";
import { githubListYamlFiles, githubWriteYamlFile } from "@/lib/tauri";

const GH_TOKEN_KEY = "flux_github_token";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface GitHubContentItem {
  name: string;
  type: "file" | "dir";
  download_url: string | null;
  sha: string;
  path: string;
}

type Step = "connect" | "repos" | "sync";
type Status = { kind: "idle" } | { kind: "loading"; msg: string } | { kind: "ok"; msg: string } | { kind: "error"; msg: string };

interface DiffStatus {
  localOnly: string[];   // files only local → new on push
  remoteOnly: string[];  // files only on GitHub → missing locally
  common: string[];      // files in both
}

function ghFetch(token: string, path: string, opts?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...opts?.headers,
    },
  });
}

export function GitHubSyncModal({ open, onClose, collectionsDir, onReload }: {
  open: boolean;
  onClose: () => void;
  collectionsDir: string | null;
  onReload?: () => void;
}) {
  const [step, setStep] = useState<Step>(() => localStorage.getItem(GH_TOKEN_KEY) ? "repos" : "connect");
  const [token, setToken] = useState(() => localStorage.getItem(GH_TOKEN_KEY) ?? "");
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [diffStatus, setDiffStatus] = useState<DiffStatus | null>(null);
  const [commitMsg, setCommitMsg] = useState("sync: update collections via Flux");

  if (!open) return null;

  async function handleConnect() {
    if (!token.trim()) return;
    setStatus({ kind: "loading", msg: "Connecting to GitHub…" });
    try {
      const res = await ghFetch(token, "/user");
      if (!res.ok) throw new Error("Invalid token or no access");
      const u: GitHubUser = await res.json();
      setUser(u);
      localStorage.setItem(GH_TOKEN_KEY, token);

      const rRes = await ghFetch(token, "/user/repos?per_page=100&sort=updated&type=all");
      if (!rRes.ok) throw new Error("Failed to load repositories");
      const rData: GitHubRepo[] = await rRes.json();
      setRepos(rData);
      setStatus({ kind: "idle" });
      setStep("repos");
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  async function handleLoadRepos() {
    setStatus({ kind: "loading", msg: "Loading repositories…" });
    try {
      const res = await ghFetch(token, "/user/repos?per_page=100&sort=updated&type=all");
      if (!res.ok) throw new Error("Failed to load repositories");
      const data: GitHubRepo[] = await res.json();
      setRepos(data);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  function handleSelectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setDiffStatus(null);
    setRepoPath("");
    setStep("sync");
    setStatus({ kind: "idle" });
  }

  async function handleCheckStatus() {
    if (!selectedRepo || !collectionsDir) return;
    setDiffStatus(null);
    setStatus({ kind: "loading", msg: "Checking status…" });
    try {
      const path = repoPath.trim();
      const url = `/repos/${selectedRepo.full_name}/contents/${path}`;
      const res = await ghFetch(token, url);

      let remoteNames: string[] = [];
      if (res.ok) {
        const items: GitHubContentItem[] = await res.json();
        remoteNames = items
          .filter(i => i.type === "file" && (i.name.endsWith(".yaml") || i.name.endsWith(".yml")))
          .map(i => i.name);
      }

      const localFiles = await githubListYamlFiles(collectionsDir);
      const localNames = localFiles.map(f => f.name);

      setDiffStatus({
        localOnly: localNames.filter(n => !remoteNames.includes(n)),
        remoteOnly: remoteNames.filter(n => !localNames.includes(n)),
        common: localNames.filter(n => remoteNames.includes(n)),
      });
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  async function handlePull() {
    if (!selectedRepo || !collectionsDir) return;
    setStatus({ kind: "loading", msg: "Pulling from GitHub…" });
    try {
      const path = repoPath.trim() ? repoPath.trim() : "";
      const url = `/repos/${selectedRepo.full_name}/contents/${path}`;
      const res = await ghFetch(token, url);
      if (!res.ok) throw new Error(`Path not found in repo (${res.status})`);
      const items: GitHubContentItem[] = await res.json();
      const yamlFiles = items.filter(i => i.type === "file" && (i.name.endsWith(".yaml") || i.name.endsWith(".yml")));
      if (yamlFiles.length === 0) {
        setStatus({ kind: "error", msg: "No .yaml files found in that path" });
        return;
      }
      let count = 0;
      for (const file of yamlFiles) {
        if (!file.download_url) continue;
        const contentRes = await fetch(file.download_url);
        const text = await contentRes.text();
        await githubWriteYamlFile(collectionsDir, file.name, text);
        count++;
      }
      setStatus({ kind: "ok", msg: `${count} file${count !== 1 ? "s" : ""} pulled successfully` });
      onReload?.();
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  async function handlePush() {
    if (!selectedRepo || !collectionsDir) return;
    setStatus({ kind: "loading", msg: "Pushing to GitHub…" });
    try {
      const files = await githubListYamlFiles(collectionsDir);
      if (files.length === 0) {
        setStatus({ kind: "error", msg: "No .yaml files found in collections folder" });
        return;
      }
      const basePath = repoPath.trim() ? repoPath.trim().replace(/\/$/, "") : "";
      let count = 0;
      for (const file of files) {
        const filePath = basePath ? `${basePath}/${file.name}` : file.name;
        const bytes = new TextEncoder().encode(file.content);
        let binary = "";
        bytes.forEach(b => (binary += String.fromCharCode(b)));
        const contentB64 = btoa(binary);

        // Check if file exists to get its SHA (needed for updates)
        const checkRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/contents/${filePath}`);
        const sha = checkRes.ok ? (await checkRes.json()).sha as string : undefined;

        const body: Record<string, string> = {
          message: commitMsg.trim() || "sync: update collections via Flux",
          content: contentB64,
          branch: selectedRepo.default_branch,
        };
        if (sha) body.sha = sha;

        const putRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/contents/${filePath}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!putRes.ok) throw new Error(`Failed to push ${file.name}: ${putRes.status}`);
        count++;
      }
      setStatus({ kind: "ok", msg: `${count} file${count !== 1 ? "s" : ""} pushed successfully` });
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  function handleDisconnect() {
    localStorage.removeItem(GH_TOKEN_KEY);
    setToken("");
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setStep("connect");
    setStatus({ kind: "idle" });
  }

  const filteredRepos = repos.filter(r =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    (r.description ?? "").toLowerCase().includes(repoSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{ width: 480, maxHeight: "80vh", background: "var(--color-topbar)", border: "1px solid var(--color-border)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 shrink-0" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
          <GitBranch size={18} style={{ color: "var(--color-fg-2)" }} />
          <span className="flex-1 text-[14px] font-semibold" style={{ color: "var(--color-fg)" }}>GitHub Sync</span>
          {step !== "connect" && user && (
            <div className="flex items-center gap-2 mr-2">
              <img src={user.avatar_url} alt="" className="rounded-full" style={{ width: 20, height: 20 }} />
              <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>{user.login}</span>
            </div>
          )}
          <button onClick={onClose} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, color: "var(--color-fg-4)" }}>
            <X size={14} />
          </button>
        </div>

        {/* Step: Connect */}
        {step === "connect" && (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>
              Generate a Personal Access Token (PAT) in GitHub → Settings → Developer settings → Personal access tokens. Needs <code className="px-1 rounded text-[11px]" style={{ background: "var(--color-card)" }}>repo</code> scope.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium" style={{ color: "var(--color-fg-3)" }}>Personal Access Token</label>
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleConnect()}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 rounded-lg text-[12px]"
                style={{
                  height: 36, background: "var(--color-input)",
                  border: "1px solid var(--color-border)", color: "var(--color-fg-2)",
                  fontFamily: "Geist Mono, monospace",
                }}
              />
            </div>
            {status.kind === "error" && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
                <AlertCircle size={13} /> {status.msg}
              </div>
            )}
            <button
              onClick={handleConnect}
              disabled={!token.trim() || status.kind === "loading"}
              className="flex items-center justify-center gap-2 w-full rounded-lg font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ height: 36, fontSize: 13, background: "var(--color-accent)" }}
            >
              {status.kind === "loading" ? <><Loader2 size={13} className="animate-spin" /> Connecting…</> : <><GitBranch size={13} /> Connect to GitHub</>}
            </button>
          </div>
        )}

        {/* Step: Repos */}
        {step === "repos" && (
          <div className="flex flex-col overflow-hidden flex-1">
            <div className="flex items-center gap-2 px-4 shrink-0" style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
              <Search size={13} style={{ color: "var(--color-fg-4)" }} />
              <input
                value={repoSearch}
                onChange={e => setRepoSearch(e.target.value)}
                placeholder="Search repositories…"
                className="flex-1 bg-transparent text-[12px]"
                style={{ color: "var(--color-fg-2)" }}
                autoFocus
              />
              {repos.length === 0 && (
                <button onClick={handleLoadRepos} className="text-[11px] px-2 py-1 rounded" style={{ color: "var(--color-accent)", background: "var(--color-accent-10)" }}>
                  Load
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {status.kind === "loading" && (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px]" style={{ color: "var(--color-fg-4)" }}>
                  <Loader2 size={14} className="animate-spin" /> {status.msg}
                </div>
              )}
              {filteredRepos.map(repo => (
                <button
                  key={repo.id}
                  onClick={() => handleSelectRepo(repo)}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left transition-colors"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {repo.private
                    ? <Lock size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
                    : <Globe size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: "var(--color-fg)" }}>{repo.name}</div>
                    {repo.description && (
                      <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--color-fg-4)" }}>{repo.description}</div>
                    )}
                  </div>
                  <ChevronRight size={13} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
                </button>
              ))}
              {repos.length > 0 && filteredRepos.length === 0 && (
                <div className="flex items-center justify-center py-8 text-[12px]" style={{ color: "var(--color-fg-4)" }}>No repos match</div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
              <button onClick={handleDisconnect} className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>Disconnect</button>
              <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{repos.length} repos</span>
            </div>
          </div>
        )}

        {/* Step: Sync */}
        {step === "sync" && selectedRepo && (
          <div className="flex flex-col gap-4 p-5">
            {/* Repo info */}
            <div className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
              {selectedRepo.private
                ? <Lock size={13} style={{ color: "var(--color-fg-4)" }} />
                : <Globe size={13} style={{ color: "var(--color-fg-4)" }} />}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium" style={{ color: "var(--color-fg)" }}>{selectedRepo.full_name}</div>
                <div className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>branch: {selectedRepo.default_branch}</div>
              </div>
              <button onClick={() => { setStep("repos"); setStatus({ kind: "idle" }); }} className="text-[11px] px-2 py-1 rounded" style={{ color: "var(--color-accent)", background: "var(--color-accent-10)" }}>
                Change
              </button>
            </div>

            {/* Path + Check */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium" style={{ color: "var(--color-fg-3)" }}>Folder path in repo</label>
              <div className="flex gap-2">
                <input
                  value={repoPath}
                  onChange={e => { setRepoPath(e.target.value); setDiffStatus(null); }}
                  placeholder="collections"
                  className="flex-1 px-3 rounded-lg text-[12px]"
                  style={{
                    height: 34, background: "var(--color-input)",
                    border: "1px solid var(--color-border)", color: "var(--color-fg-2)",
                    fontFamily: "Geist Mono, monospace",
                  }}
                />
                <button
                  onClick={handleCheckStatus}
                  disabled={!collectionsDir || status.kind === "loading"}
                  className="px-3 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ height: 34, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", whiteSpace: "nowrap" }}
                >
                  {status.kind === "loading" && status.msg === "Checking status…"
                    ? <Loader2 size={12} className="animate-spin" />
                    : "Check status"}
                </button>
              </div>
              <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>Leave blank to use the repo root</span>
            </div>

            {/* Diff status */}
            {diffStatus && (
              <div className="flex flex-wrap gap-2">
                {diffStatus.common.length > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]" style={{ background: "#3B82F615", border: "1px solid #3B82F630", color: "#3B82F6" }}>
                    <span style={{ fontFamily: "Geist Mono, monospace" }}>{diffStatus.common.length}</span> in sync
                  </span>
                )}
                {diffStatus.localOnly.length > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]" style={{ background: "#A855F715", border: "1px solid #A855F730", color: "#A855F7" }}>
                    <ArrowUp size={10} /> {diffStatus.localOnly.length} only local
                  </span>
                )}
                {diffStatus.remoteOnly.length > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]" style={{ background: "#F59E0B15", border: "1px solid #F59E0B30", color: "#F59E0B" }}>
                    <ArrowDown size={10} /> {diffStatus.remoteOnly.length} only on GitHub
                  </span>
                )}
                {diffStatus.localOnly.length === 0 && diffStatus.remoteOnly.length === 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]" style={{ background: "#22C55E15", border: "1px solid #22C55E30", color: "#22C55E" }}>
                    <Check size={10} /> Already in sync
                  </span>
                )}
              </div>
            )}

            {/* Commit message */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium" style={{ color: "var(--color-fg-3)" }}>Commit message</label>
              <input
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                placeholder="sync: update collections via Flux"
                className="w-full px-3 rounded-lg text-[12px]"
                style={{
                  height: 34, background: "var(--color-input)",
                  border: "1px solid var(--color-border)", color: "var(--color-fg-2)",
                }}
              />
            </div>

            {!collectionsDir && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "#F59E0B15", border: "1px solid #F59E0B30", color: "#F59E0B" }}>
                <AlertCircle size={13} /> Set a collections folder first before syncing
              </div>
            )}

            {/* Status */}
            {status.kind === "ok" && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "#22C55E15", border: "1px solid #22C55E30", color: "#22C55E" }}>
                <Check size={13} /> {status.msg}
              </div>
            )}
            {status.kind === "error" && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
                <AlertCircle size={13} /> {status.msg}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handlePull}
                disabled={!collectionsDir || status.kind === "loading"}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ height: 40, fontSize: 13, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}
              >
                {status.kind === "loading" && status.msg.includes("Pull")
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ArrowDown size={14} />}
                Pull from GitHub
              </button>
              <button
                onClick={handlePush}
                disabled={!collectionsDir || status.kind === "loading"}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ height: 40, fontSize: 13, background: "var(--color-accent)", color: "white" }}
              >
                {status.kind === "loading" && status.msg.includes("Push")
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ArrowUp size={14} />}
                Push to GitHub
              </button>
            </div>

            <p className="text-[11px] text-center" style={{ color: "var(--color-fg-4)" }}>
              Pull downloads .yaml files from GitHub → local folder. Push uploads local .yaml files → GitHub.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
