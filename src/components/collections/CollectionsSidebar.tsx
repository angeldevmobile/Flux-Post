import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Plus, Search, FolderOpen, RefreshCw } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useRequestStore } from "@/stores/request";
import { loadCollections } from "@/lib/tauri";
import { methodColor, methodBg } from "@/lib/methods";
import type { HttpMethod } from "@/lib/tauri";

const DIR_KEY = "flux_collections_dir";

function MethodPill({ method }: { method: string }) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 font-bold"
      style={{
        width: 36, height: 16, borderRadius: 3,
        fontSize: 9, fontFamily: "Geist Mono, monospace",
        color: methodColor(method),
        background: methodBg(method),
      }}>
      {method}
    </span>
  );
}

function FolderSetup({ onSet }: { onSet: (dir: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <FolderOpen size={14} className="text-[#A855F7] shrink-0" />
        <span className="text-[12px] font-medium text-[#E4E4E7]">Collections folder</span>
      </div>
      <p className="text-[11px] text-[#71717A]">
        Paste the path to your collections directory. YAML files inside will appear here.
      </p>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === "Enter" && value.trim() && onSet(value.trim())}
        placeholder="/path/to/your/collections"
        className="w-full px-3 rounded-md text-[11px]"
        style={{
          height: 32, background: "#141414", border: "1px solid #27272A",
          color: "#A1A1AA", fontFamily: "Geist Mono, monospace",
        }}
      />
      <button
        onClick={() => value.trim() && onSet(value.trim())}
        className="flex items-center justify-center gap-1.5 w-full rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ height: 30, fontSize: 12, background: "#A855F7" }}
        disabled={!value.trim()}>
        Load collections
      </button>
    </div>
  );
}

export function CollectionsSidebar() {
  const { collections, activeRequestId, setActiveRequest, toggleCollection } = useCollectionsStore();
  const { setMethod, setUrl, setHeaders } = useRequestStore();
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState<string | null>(() => localStorage.getItem(DIR_KEY));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (d: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await loadCollections(d);
      useCollectionsStore.setState({ collections: loaded });
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dir) reload(dir);
  }, [dir, reload]);

  function handleSetDir(d: string) {
    localStorage.setItem(DIR_KEY, d);
    setDir(d);
  }

  function handleSelect(method: string, path: string, id: string, headers?: Record<string, string>) {
    setActiveRequest(id);
    setMethod(method as HttpMethod);
    setUrl(path);
    if (headers && Object.keys(headers).length > 0) {
      setHeaders(
        Object.entries(headers).map(([key, value], i) => ({
          id: `h-${i}`, key, value, enabled: true,
        }))
      );
    }
  }

  const filtered = collections.map(c => ({
    ...c,
    requests: c.requests.filter(r =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.path.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(c => !search || c.requests.length > 0 || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="flex flex-col shrink-0 h-full" style={{ width: 260, background: "#0F0F0F", borderRight: "1px solid #27272A" }}>
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0 px-3" style={{ height: 44, borderBottom: "1px solid #27272A" }}>
        <span className="flex-1 text-[12px] font-medium text-[#A1A1AA]">Collections</span>
        {dir && (
          <>
            <button onClick={() => reload(dir)} disabled={loading} title="Reload"
              className="flex items-center justify-center rounded text-[#71717A] hover:text-[#A1A1AA] transition-colors disabled:opacity-40"
              style={{ width: 24, height: 24 }}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => { localStorage.removeItem(DIR_KEY); setDir(null); useCollectionsStore.setState({ collections: [] }); }}
              title="Change folder"
              className="flex items-center justify-center rounded text-[#71717A] hover:text-[#A1A1AA] transition-colors"
              style={{ width: 24, height: 24, background: "#1A1A1A" }}>
              <FolderOpen size={13} />
            </button>
          </>
        )}
        {!dir && (
          <button className="flex items-center justify-center rounded" title="Set folder"
            style={{ width: 24, height: 24, background: "#1A1A1A" }}>
            <Plus size={14} className="text-[#71717A]" />
          </button>
        )}
      </div>

      {!dir ? (
        <FolderSetup onSet={handleSetDir} />
      ) : (
        <>
          {/* Search */}
          <div className="flex items-center gap-2 shrink-0 px-3" style={{ height: 36, borderBottom: "1px solid #27272A" }}>
            <Search size={13} className="text-[#71717A] shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search endpoints..."
              className="flex-1 text-[12px] bg-transparent"
              style={{ color: "#3F3F46" }}
            />
          </div>

          {/* Error */}
          {loadError && (
            <div className="mx-3 mt-3 rounded p-2 text-[11px]"
              style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444" }}>
              {loadError}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto py-2">
            {filtered.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center gap-2 py-8 px-4">
                <p className="text-[11px] text-[#52525B] text-center">
                  {search ? "No matches found" : "No .yaml files in this folder"}
                </p>
              </div>
            )}
            {filtered.map(col => (
              <div key={col.id}>
                <button
                  onClick={() => toggleCollection(col.id)}
                  className="flex items-center gap-1.5 w-full px-3 hover:bg-[#1A1A1A] transition-colors"
                  style={{ height: 30 }}>
                  <ChevronRight
                    size={12} className="text-[#71717A] shrink-0 transition-transform"
                    style={{ transform: col.expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                  />
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: "#A855F7", flexShrink: 0 }} />
                  <span className="text-[12px] font-medium text-[#E4E4E7] flex-1 text-left truncate">{col.name}</span>
                  <span className="text-[10px] text-[#52525B]">{col.requests.length}</span>
                </button>

                {col.expanded && col.requests.map(req => (
                  <button
                    key={req.id}
                    onClick={() => handleSelect(req.method, req.path, req.id, req.headers)}
                    className="flex items-center gap-2 w-full transition-colors hover:bg-[#1A1A1A]"
                    style={{
                      height: 28, paddingLeft: 28, paddingRight: 12,
                      background: activeRequestId === req.id ? "#1A1A2E" : "transparent",
                      borderLeft: activeRequestId === req.id ? "2px solid #A855F7" : "2px solid transparent",
                    }}>
                    <MethodPill method={req.method} />
                    <span
                      className="text-[11px] truncate"
                      style={{ fontFamily: "Geist Mono, monospace", color: activeRequestId === req.id ? "#E4E4E7" : "#71717A" }}>
                      {req.name || req.path}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
