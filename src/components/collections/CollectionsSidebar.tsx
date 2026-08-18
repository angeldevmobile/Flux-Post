import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Plus, Search, FolderOpen, RefreshCw, Folder, Upload, Download, Play, Network, GitBranch, Trash2, X, FileText } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useRequestStore } from "@/stores/request";
import { fromCollectionRequest } from "@/lib/requestFidelity";
import { useGrpcStore } from "@/stores/grpcStore";
import { useNavStore } from "@/stores/nav";
import { loadCollections, saveCollection, grpcLoadProtoById, deleteYamlFile, clearRootYamlFiles } from "@/lib/tauri";
import { pushCollection } from "@/lib/sync";
import { useUserStore } from "@/stores/user";
import { methodColor, methodBg } from "@/lib/methods";
import { exportPostman, exportOpenAPI } from "@/lib/exporters";
import { exportDataAsJson } from "@/lib/tauri";
import { ImportModal } from "./ImportModal";
import { CollectionRunner } from "./CollectionRunner";
import { GitHubSyncModal } from "./GitHubSyncModal";
import type { CollectionRequest, CollectionFolder, Collection } from "@/stores/collections";

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
        <FolderOpen size={14} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
        <span className="text-[12px] font-medium" style={{ color: "var(--color-fg)" }}>Collections folder</span>
      </div>
      <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>
        Paste the path to your collections directory. YAML files inside will appear here.
      </p>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === "Enter" && value.trim() && onSet(value.trim())}
        placeholder="/path/to/your/collections"
        className="w-full px-3 rounded-md text-[11px]"
        style={{
          height: 32,
          background: "var(--color-input)",
          border: "1px solid var(--color-border)",
          color: "var(--color-fg-2)",
          fontFamily: "Geist Mono, monospace",
        }}
      />
      <button
        onClick={() => value.trim() && onSet(value.trim())}
        className="flex items-center justify-center gap-1.5 w-full rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ height: 30, fontSize: 12, background: "var(--color-accent)" }}
        disabled={!value.trim()}>
        Load collections
      </button>
    </div>
  );
}

function RequestRow({
  req,
  activeRequestId,
  paddingLeft,
  onSelect,
}: {
  req: CollectionRequest;
  activeRequestId: string | null;
  paddingLeft: number;
  onSelect: (req: CollectionRequest) => void;
}) {
  const isActive = activeRequestId === req.id;
  const isGrpc = (req.kind ?? "http") === "grpc";
  return (
    <button
      onClick={() => onSelect(req)}
      className="flex items-center gap-2 w-full transition-colors"
      style={{
        height: 28, paddingLeft, paddingRight: 12,
        background: isActive ? "var(--color-accent-10)" : "transparent",
        borderLeft: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--color-card)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = isActive ? "var(--color-accent-10)" : "transparent"; }}>
      {isGrpc
        ? <span className="inline-flex items-center justify-center shrink-0" style={{ width: 36, height: 16 }}>
            <Network size={11} style={{ color: "var(--color-accent)" }} />
          </span>
        : <MethodPill method={req.method} />}
      <span
        className="text-[11px] truncate"
        style={{ fontFamily: "Geist Mono, monospace", color: isActive ? "var(--color-fg)" : "var(--color-fg-3)" }}>
        {req.name || (isGrpc ? req.grpc?.method : req.path)}
      </span>
    </button>
  );
}

/** Counts requests in a folder and everything nested under it. */
function folderCount(folder: CollectionFolder): number {
  return folder.requests.length + (folder.folders ?? []).reduce((n, f) => n + folderCount(f), 0);
}

const matchesQuery = (r: CollectionRequest, q: string) =>
  !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q);

/** Keeps a folder when it matches by name, or when anything under it does. */
function filterFolders(folders: CollectionFolder[], q: string): CollectionFolder[] {
  return folders
    .map(f => ({
      ...f,
      requests: f.requests.filter(r => matchesQuery(r, q)),
      folders: filterFolders(f.folders ?? [], q),
    }))
    .filter(f =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.requests.length > 0 ||
      (f.folders ?? []).length > 0
    );
}

/** Renders a folder and its subfolders, which nest to any depth. */
function FolderRow({
  folder, collectionId, depth, activeRequestId, onToggle, onSelect,
}: {
  folder: CollectionFolder;
  collectionId: string;
  depth: number;
  activeRequestId: string | null;
  onToggle: (collectionId: string, folderId: string) => void;
  onSelect: (req: CollectionRequest) => void;
}) {
  const indent = 20 + depth * 12;
  return (
    <div>
      <button onClick={() => onToggle(collectionId, folder.id)}
        className="flex items-center gap-1.5 w-full transition-colors"
        style={{ height: 28, paddingLeft: indent, paddingRight: 12 }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
        <ChevronRight size={11} className="shrink-0 transition-transform"
          style={{ color: "var(--color-fg-4)", transform: folder.expanded ? "rotate(90deg)" : "rotate(0deg)" }} />
        <Folder size={12} style={{ color: "var(--color-fg-3)", flexShrink: 0 }} />
        <span className="text-[11px] font-medium flex-1 text-left truncate" style={{ color: "var(--color-fg-2)" }}>{folder.name}</span>
        <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>{folderCount(folder)}</span>
      </button>
      {folder.expanded && (
        <>
          {folder.requests.map(req => (
            <RequestRow key={req.id} req={req} activeRequestId={activeRequestId}
              paddingLeft={indent + 20} onSelect={onSelect} />
          ))}
          {(folder.folders ?? []).map(sub => (
            <FolderRow key={sub.id} folder={sub} collectionId={collectionId} depth={depth + 1}
              activeRequestId={activeRequestId} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </>
      )}
    </div>
  );
}

export function CollectionsSidebar() {
  const { collections, activeRequestId, setActiveRequest, toggleCollection, toggleFolder } = useCollectionsStore();
  const resetRequest = useRequestStore(s => s.reset);
  const { setProtoId, setServices, setEndpoint, setSelectedService, setSelectedMethod, setPayload, setMetadata } = useGrpcStore();
  const { navigate } = useNavStore();
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState<string | null>(() => localStorage.getItem(DIR_KEY));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [exportMenuId, setExportMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);

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

  async function handleDelete(colId: string) {
    if (!dir) return;
    if (confirmDeleteId !== colId) { setConfirmDeleteId(colId); return; }
    setConfirmDeleteId(null);
    try {
      // id may be "Group/stem", so resolve it to the actual file path
      const parts = colId.split("/");
      const stem = parts[parts.length - 1];
      const subdir = parts.length > 1 ? parts[0] : null;
      const filePath = subdir ? `${subdir}/${stem}.yaml` : `${stem}.yaml`;
      await deleteYamlFile(dir, filePath);
    } catch { /* ignore */ }
    await reload(dir);
  }

  async function handleClearAll() {
    if (!dir) return;
    if (!confirmClearAll) { setConfirmClearAll(true); return; }
    setConfirmClearAll(false);
    await clearRootYamlFiles(dir);
    await reload(dir);
  }

  function startEditingDescription(col: Collection) {
    setEditingDescId(col.id);
    setDescDraft(col.description ?? "");
    setExportMenuId(null);
  }

  async function saveDescription(col: Collection) {
    const dir = localStorage.getItem(DIR_KEY);
    if (!dir) return;
    const description = descDraft.trim() || undefined;
    const updated = { ...col, description };

    setSavingDesc(true);
    try {
      await saveCollection(dir, updated);
      useCollectionsStore.setState({
        collections: useCollectionsStore.getState().collections.map(c => c.id === col.id ? updated : c),
      });
      const userId = useUserStore.getState().user?.id;
      if (userId) pushCollection(userId, updated);
      setEditingDescId(null);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setSavingDesc(false);
    }
  }

  async function handleSelect(req: CollectionRequest) {
    setActiveRequest(req.id);

    if ((req.kind ?? "http") === "grpc" && req.grpc) {
      const g = req.grpc;
      if (g.endpoint) setEndpoint(g.endpoint);
      if (g.payload) setPayload(g.payload);
      if (g.metadata && Object.keys(g.metadata).length > 0) {
        setMetadata(
          Object.entries(g.metadata).map(([key, value], i) => ({
            id: `m-${i}`, key, value, enabled: true,
          }))
        );
      }
      // Load proto from library if we have a saved protoName/protoId
      if (g.protoId) {
        try {
          const info = await grpcLoadProtoById(g.protoId);
          setProtoId(info.id);
          setServices(info.services);
          if (g.service) setSelectedService(g.service);
          if (g.method) setSelectedMethod(g.method);
        } catch {
          // proto not found on disk, the user will need to re-import
        }
      } else {
        if (g.service) setSelectedService(g.service);
        if (g.method) setSelectedMethod(g.method);
      }
      navigate("grpc");
      return;
    }

    // Reset first so anything the collection does not carry comes back as a
    // default rather than lingering from the previously open request.
    resetRequest();
    useRequestStore.setState(fromCollectionRequest(req));
  }

  const q = search.toLowerCase();

  const filtered = collections.map(c => {
    const matchesCol = !q || c.name.toLowerCase().includes(q);
    const filteredRequests = c.requests.filter(r =>
      !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    );
    const filteredFolders = filterFolders(c.folders, q);

    if (!matchesCol && filteredRequests.length === 0 && filteredFolders.length === 0) return null;

    return { ...c, requests: filteredRequests, folders: filteredFolders };
  }).filter(Boolean) as typeof collections;

  const totalCount = (col: typeof collections[0]) =>
    col.requests.length + col.folders.reduce((sum, f) => sum + folderCount(f), 0);

  const renderCollection = (col: typeof collections[0]) => {
    return (
      <div key={col.id} className="group/col">
        <div className="flex items-center w-full px-3 transition-colors"
          style={{ height: 30 }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <button onClick={() => toggleCollection(col.id)} className="flex items-center gap-1.5 flex-1 min-w-0">
            <ChevronRight size={12} className="shrink-0 transition-transform"
              style={{ color: "var(--color-fg-3)", transform: col.expanded ? "rotate(90deg)" : "rotate(0deg)" }} />
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--color-accent)", flexShrink: 0 }} />
            <span className="text-[12px] font-medium flex-1 text-left truncate" style={{ color: "var(--color-fg)" }}>{col.name}</span>
          </button>
          <div className="relative flex items-center gap-0.5">
            <button onClick={e => { e.stopPropagation(); handleDelete(col.id); }}
              title={confirmDeleteId === col.id ? "Click again to confirm" : "Delete collection"}
              className="flex items-center justify-center rounded opacity-0 group-hover/col:opacity-100 transition-opacity"
              style={{ width: 18, height: 18, color: confirmDeleteId === col.id ? "#EF4444" : "var(--color-fg-3)", flexShrink: 0 }}>
              <Trash2 size={11} />
            </button>
            <button onClick={e => { e.stopPropagation(); startEditingDescription(col); }}
              title={col.description ? "Edit description" : "Add a description"}
              className="flex items-center justify-center rounded opacity-0 group-hover/col:opacity-100 transition-opacity"
              style={{ width: 18, height: 18, color: col.description ? "var(--color-accent)" : "var(--color-fg-3)", flexShrink: 0 }}>
              <FileText size={11} />
            </button>
            <button onClick={e => { e.stopPropagation(); setExportMenuId(exportMenuId === col.id ? null : col.id); }}
              title="Export collection"
              className="flex items-center justify-center rounded opacity-0 group-hover/col:opacity-100 transition-opacity"
              style={{ width: 18, height: 18, color: "var(--color-fg-3)", flexShrink: 0 }}>
              <Download size={11} />
            </button>
            {exportMenuId === col.id && (
              <div className="absolute z-50 rounded-lg py-1 flex flex-col"
                style={{ top: "100%", right: 0, marginTop: 4, minWidth: 160, background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "0 8px 24px #00000050" }}
                onMouseLeave={() => setExportMenuId(null)}>
                <button onClick={() => { exportDataAsJson(JSON.parse(exportPostman(col)), `${col.id}.postman_collection.json`); setExportMenuId(null); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors w-full"
                  style={{ color: "var(--color-fg-2)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  Postman v2.1
                </button>
                <button onClick={() => { exportDataAsJson(JSON.parse(exportOpenAPI(col)), `${col.id}.openapi.json`); setExportMenuId(null); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors w-full"
                  style={{ color: "var(--color-fg-2)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  OpenAPI 3.0
                </button>
              </div>
            )}
          </div>
          <span className="text-[10px] ml-1" style={{ color: "var(--color-fg-4)" }}>{totalCount(col)}</span>
        </div>

        {editingDescId === col.id ? (
          <div className="flex flex-col gap-1.5 px-3 pb-2" style={{ paddingLeft: 28 }}>
            <textarea
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") setEditingDescId(null);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDescription(col);
              }}
              autoFocus
              rows={2}
              placeholder="What is this collection for?"
              className="w-full px-2 py-1 rounded text-[11px] resize-none"
              style={{ background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", lineHeight: 1.5 }}
            />
            <div className="flex items-center gap-1.5">
              <button onClick={() => saveDescription(col)} disabled={savingDesc}
                className="px-2 rounded text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ height: 22, background: "var(--color-accent)" }}>
                {savingDesc ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditingDescId(null)}
                className="px-2 rounded text-[10px] transition-opacity hover:opacity-80"
                style={{ height: 22, color: "var(--color-fg-3)", border: "1px solid var(--color-border)" }}>
                Cancel
              </button>
            </div>
          </div>
        ) : col.description && col.expanded ? (
          <p className="text-[10px] px-3 pb-1.5" style={{ paddingLeft: 28, color: "var(--color-fg-4)", lineHeight: 1.5 }}>
            {col.description}
          </p>
        ) : null}

        {col.expanded && (
          <>
            {col.requests.map(req => (
              <RequestRow key={req.id} req={req} activeRequestId={activeRequestId} paddingLeft={28} onSelect={handleSelect} />
            ))}
            {col.folders.map(folder => (
              <FolderRow key={folder.id} folder={folder} collectionId={col.id} depth={0}
                activeRequestId={activeRequestId} onToggle={toggleFolder} onSelect={handleSelect} />
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <aside className="flex flex-col shrink-0 h-full"
      style={{ width: 260, background: "var(--color-sidebar)", borderRight: "1px solid var(--color-border)" }}>

      {/* Header */}
      <div className="flex items-center gap-2 shrink-0 px-3"
        style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}>
        <span className="flex-1 text-[12px] font-medium" style={{ color: "var(--color-fg-2)" }}>Collections</span>
        {dir && (
          <>
            <button onClick={() => reload(dir)} disabled={loading} title="Reload"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-40"
              style={{ width: 24, height: 24, color: "var(--color-fg-3)" }}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={handleClearAll}
              title={confirmClearAll ? "Click again to confirm" : "Clear all root collections"}
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 24, height: 24, background: "var(--color-card)", color: confirmClearAll ? "#EF4444" : "var(--color-fg-3)" }}>
              <X size={13} />
            </button>
            <button
              onClick={() => { localStorage.removeItem(DIR_KEY); setDir(null); useCollectionsStore.setState({ collections: [] }); }}
              title="Change folder"
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 24, height: 24, background: "var(--color-card)", color: "var(--color-fg-3)" }}>
              <FolderOpen size={13} />
            </button>
          </>
        )}
        <button
          onClick={() => setGithubOpen(true)}
          title="GitHub Sync"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 24, height: 24, background: "var(--color-card)", color: "var(--color-fg-3)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--color-accent)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-3)")}>
          <GitBranch size={13} />
        </button>
        <button
          onClick={() => setRunnerOpen(true)}
          title="Run collection"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 24, height: 24, background: "var(--color-card)", color: "var(--color-fg-3)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--color-accent)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-3)")}>
          <Play size={13} />
        </button>
        <button
          onClick={() => setImportOpen(true)}
          title="Import collection"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 24, height: 24, background: "var(--color-card)", color: "var(--color-fg-3)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--color-accent)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-3)")}>
          <Upload size={13} />
        </button>
        {!dir && (
          <button className="flex items-center justify-center rounded" title="Set folder"
            style={{ width: 24, height: 24, background: "var(--color-card)", color: "var(--color-fg-3)" }}>
            <Plus size={14} />
          </button>
        )}
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <CollectionRunner open={runnerOpen} onClose={() => setRunnerOpen(false)} />
      <GitHubSyncModal open={githubOpen} onClose={() => setGithubOpen(false)} collectionsDir={dir} onReload={() => dir && reload(dir)} />

      {!dir ? (
        <FolderSetup onSet={handleSetDir} />
      ) : (
        <>
          {/* Search */}
          <div className="flex items-center gap-2 shrink-0 px-3"
            style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}>
            <Search size={13} style={{ color: "var(--color-fg-3)", flexShrink: 0 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search endpoints..."
              className="flex-1 text-[12px] bg-transparent"
              style={{ color: "var(--color-fg-3)" }}
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
                <p className="text-[11px] text-center" style={{ color: "var(--color-fg-4)" }}>
                  {search ? "No matches found" : "No .yaml files in this folder"}
                </p>
              </div>
            )}

            {/* Group headers for subfolder collections */}
            {(() => {
              const groups = new Map<string, typeof filtered>();
              const root: typeof filtered = [];
              filtered.forEach(col => {
                if (col.group) {
                  if (!groups.has(col.group)) groups.set(col.group, []);
                  groups.get(col.group)!.push(col);
                } else {
                  root.push(col);
                }
              });
              return (
                <>
                  {root.map(col => renderCollection(col))}
                  {[...groups.entries()].map(([groupName, cols]) => (
                    <div key={groupName}>
                      <div className="flex items-center gap-1.5 px-3 mt-1" style={{ height: 26 }}>
                        <Folder size={12} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
                        <span className="text-[11px] font-semibold flex-1 truncate" style={{ color: "var(--color-fg-3)" }}>{groupName}</span>
                      </div>
                      {cols.map(col => renderCollection(col))}
                    </div>
                  ))}
                </>
              );
            })()}

          </div>
        </>
      )}
    </aside>
  );
}
