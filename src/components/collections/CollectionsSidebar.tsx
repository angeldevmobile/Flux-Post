import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Plus, Search, FolderOpen, RefreshCw, Folder, Upload, Download, Play, Network, GitBranch, Trash2, X, FileText, Shield } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useRequestStore } from "@/stores/request";
import { fromCollectionRequest } from "@/lib/requestFidelity";
import { useGrpcStore } from "@/stores/grpcStore";
import { useNavStore } from "@/stores/nav";
import { saveCollection, grpcLoadProtoById, deleteYamlFile, clearRootYamlFiles } from "@/lib/tauri";
import { pushCollection } from "@/lib/sync";
import { useUserStore } from "@/stores/user";
import { methodColor, methodBg } from "@/lib/methods";
import { exportPostman, exportOpenAPI } from "@/lib/exporters";
import { exportDataAsJson } from "@/lib/tauri";
import { toast } from "sonner";
import { ImportModal } from "./ImportModal";
import { CollectionRunner } from "./CollectionRunner";
import { GitHubSyncModal } from "./GitHubSyncModal";
import { InheritanceModal } from "./InheritanceModal";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import {
  renameFolder, renameRequest, addFolder as addFolderTo, addRequest as addRequestTo,
  deleteFolder as deleteFolderFrom, deleteRequest as deleteRequestFrom,
  duplicateRequest, moveRequest, moveRequestBetween, folderContaining,
} from "@/lib/collectionTree";
import {
  getRoots, addRoot, removeRoot, rootFor, rootLabel, loadAllRoots,
} from "@/lib/collectionRoots";
import type { CollectionRequest, CollectionFolder, Collection } from "@/stores/collections";

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

/** Caja de renombrado en linea: Enter confirma, Escape cancela, perder el foco confirma. */
interface RenameBox {
  active: boolean;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function RenameInput({ value, onChange, onCommit, onCancel }: RenameBox) {
  return (
    <input
      value={value}
      autoFocus
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      onClick={e => e.stopPropagation()}
      className="flex-1 min-w-0 px-1.5 rounded text-[11px]"
      style={{
        height: 22, background: "var(--color-input)",
        border: "1px solid var(--color-accent)", color: "var(--color-fg)",
        outline: "none",
      }}
    />
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
        Paste the path to a collections directory. YAML files inside will appear here, and you can
        open more folders afterwards — one per repository, if you keep collections next to the code.
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
  onContextMenu,
  rename,
}: {
  req: CollectionRequest;
  activeRequestId: string | null;
  paddingLeft: number;
  onSelect: (req: CollectionRequest) => void;
  onContextMenu?: (e: React.MouseEvent, req: CollectionRequest) => void;
  rename?: RenameBox;
}) {
  const isActive = activeRequestId === req.id;
  const isGrpc = (req.kind ?? "http") === "grpc";

  if (rename?.active) {
    return (
      <div className="flex items-center gap-2" style={{ height: 28, paddingLeft, paddingRight: 12 }}>
        <RenameInput {...rename} />
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(req)}
      onContextMenu={e => onContextMenu?.(e, req)}
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

/** Que se esta renombrando en la barra lateral. */
type RenameTarget =
  | { kind: "collection"; colId: string }
  | { kind: "folder"; colId: string; folderId: string }
  | { kind: "request"; colId: string; requestId: string };

/** Todas las carpetas con su ruta legible, para el menu "Mover a". */
function flattenFolders(
  folders: CollectionFolder[],
  prefix = "",
): { id: string; path: string }[] {
  return folders.flatMap(f => {
    const path = prefix ? `${prefix} / ${f.name}` : f.name;
    return [{ id: f.id, path }, ...flattenFolders(f.folders ?? [], path)];
  });
}

/** True si el nodo define algo que se herede, para poder marcarlo en la UI. */
function hasInherited(node: { auth?: unknown; headers?: Record<string, string>; scripts?: unknown }): boolean {
  return !!node.auth || Object.keys(node.headers ?? {}).length > 0 || !!node.scripts;
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
  folder, collectionId, depth, activeRequestId, onToggle, onSelect, onSettings,
  onFolderMenu, onRequestMenu, renameOf,
}: {
  folder: CollectionFolder;
  collectionId: string;
  depth: number;
  activeRequestId: string | null;
  onToggle: (collectionId: string, folderId: string) => void;
  onSelect: (req: CollectionRequest) => void;
  onSettings: (collectionId: string, folderId: string) => void;
  onFolderMenu: (e: React.MouseEvent, folder: CollectionFolder) => void;
  onRequestMenu: (e: React.MouseEvent, req: CollectionRequest) => void;
  /** Caja de renombrado si a este nodo le toca, si no undefined. */
  renameOf: (kind: "folder" | "request", id: string, current: string) => RenameBox | undefined;
}) {
  const indent = 20 + depth * 12;
  const renaming = renameOf("folder", folder.id, folder.name);

  if (renaming?.active) {
    return (
      <div className="flex items-center gap-1.5" style={{ height: 28, paddingLeft: indent, paddingRight: 12 }}>
        <Folder size={12} style={{ color: "var(--color-fg-3)", flexShrink: 0 }} />
        <RenameInput {...renaming} />
      </div>
    );
  }

  return (
    <div>
      <div className="group/folder flex items-center w-full transition-colors"
        style={{ height: 28, paddingLeft: indent, paddingRight: 12 }}
        onContextMenu={e => onFolderMenu(e, folder)}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
        <button onClick={() => onToggle(collectionId, folder.id)}
          className="flex items-center gap-1.5 flex-1 min-w-0">
          <ChevronRight size={11} className="shrink-0 transition-transform"
            style={{ color: "var(--color-fg-4)", transform: folder.expanded ? "rotate(90deg)" : "rotate(0deg)" }} />
          <Folder size={12} style={{ color: "var(--color-fg-3)", flexShrink: 0 }} />
          <span className="text-[11px] font-medium flex-1 text-left truncate" style={{ color: "var(--color-fg-2)" }}>{folder.name}</span>
        </button>
        {/* Si la carpeta ya hereda algo se ve siempre, para que se note sin pasar por encima. */}
        <button onClick={e => { e.stopPropagation(); onSettings(collectionId, folder.id); }}
          title="Auth, headers and scripts inherited by this folder"
          className={`flex items-center justify-center rounded transition-opacity ${
            hasInherited(folder) ? "" : "opacity-0 group-hover/folder:opacity-100"
          }`}
          style={{
            width: 18, height: 18, flexShrink: 0,
            color: hasInherited(folder) ? "var(--color-accent)" : "var(--color-fg-3)",
          }}>
          <Shield size={10} />
        </button>
        <span className="text-[10px] ml-1" style={{ color: "var(--color-fg-4)" }}>{folderCount(folder)}</span>
      </div>
      {folder.expanded && (
        <>
          {folder.requests.map(req => (
            <RequestRow key={req.id} req={req} activeRequestId={activeRequestId}
              paddingLeft={indent + 20} onSelect={onSelect}
              onContextMenu={onRequestMenu} rename={renameOf("request", req.id, req.name)} />
          ))}
          {(folder.folders ?? []).map(sub => (
            <FolderRow key={sub.id} folder={sub} collectionId={collectionId} depth={depth + 1}
              activeRequestId={activeRequestId} onToggle={onToggle} onSelect={onSelect}
              onSettings={onSettings} onFolderMenu={onFolderMenu} onRequestMenu={onRequestMenu}
              renameOf={renameOf} />
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
  const [roots, setRoots] = useState<string[]>(() => getRoots());
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
  const [inheritTarget, setInheritTarget] = useState<{ colId: string; folderId: string | null } | null>(null);
  const [savingInherit, setSavingInherit] = useState(false);
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRoot, setNewRoot] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  /**
   * Carga todas las raices abiertas y las junta en una sola lista.
   *
   * Una raiz que falle —una unidad de red caida, una carpeta borrada— no tumba
   * a las demas: se avisa de cual y se sigue con el resto.
   */
  const reloadAll = useCallback(async (list: string[]) => {
    if (list.length === 0) {
      useCollectionsStore.setState({ collections: [] });
      return;
    }
    setLoading(true);
    setLoadError(null);
    const { collections, failed } = await loadAllRoots();
    useCollectionsStore.setState({ collections });
    setLoadError(failed.length > 0 ? `Could not read: ${failed.join(", ")}` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reloadAll(roots);
  }, [roots, reloadAll]);

  /**
   * Ctrl+Shift+N. La pantalla de ajustes lo anunciaba desde siempre y no habia
   * ningun manejador detras.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        if (roots.length === 0) return;
        e.preventDefault();
        void createCollection(roots[0]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);

  function handleAddRoot(d: string) {
    setRoots(addRoot(d));
  }

  function handleRemoveRoot(d: string) {
    setRoots(removeRoot(d));
  }

  async function handleDelete(col: Collection) {
    const root = rootFor(col, useCollectionsStore.getState().collections);
    if (!root) return;
    if (confirmDeleteId !== col.id) { setConfirmDeleteId(col.id); return; }
    setConfirmDeleteId(null);
    try {
      // La subcarpeta la decide `group`, igual que en `save_collection`. El
      // prefijo del id no sirve: puede ser el nombre de la raiz si dos carpetas
      // traian un fichero con el mismo nombre.
      const stem = col.id.split("/").pop()!;
      const filePath = col.group ? `${col.group}/${stem}.yaml` : `${stem}.yaml`;
      await deleteYamlFile(root, filePath);
    } catch { /* ignore */ }
    await reloadAll(roots);
  }

  async function handleClearAll() {
    if (roots.length === 0) return;
    if (!confirmClearAll) { setConfirmClearAll(true); return; }
    setConfirmClearAll(false);
    for (const root of roots) {
      try { await clearRootYamlFiles(root); } catch { /* sigue con las demas */ }
    }
    await reloadAll(roots);
  }

  /**
   * La coleccion tal como esta en el store, no la que se esta pintando.
   *
   * `renderCollection` recibe una copia filtrada por el buscador: guardar esa
   * copia escribia el YAML sin las requests que no casaban con la busqueda.
   */
  function authoritative(colId: string): Collection | undefined {
    return useCollectionsStore.getState().collections.find(c => c.id === colId);
  }

  /** Escribe la coleccion en disco, en el store y en la nube. */
  async function persist(updated: Collection) {
    const root = rootFor(updated, useCollectionsStore.getState().collections);
    if (!root) throw new Error("No collections folder open");
    await saveCollection(root, updated);
    useCollectionsStore.setState({
      collections: useCollectionsStore.getState().collections.map(
        c => c.id === updated.id ? { ...updated, rootDir: updated.rootDir ?? c.rootDir } : c
      ),
    });
    if (useUserStore.getState().user?.id) void pushCollection(updated);
  }

  async function saveInheritance(updated: Collection) {
    setSavingInherit(true);
    try {
      await persist(updated);
      setInheritTarget(null);
      toast.success("Inherited settings saved");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingInherit(false);
    }
  }

  function startEditingDescription(col: Collection) {
    setEditingDescId(col.id);
    setDescDraft(col.description ?? "");
    setExportMenuId(null);
  }

  async function saveDescription(col: Collection) {
    // Sobre la del store: `col` viene filtrada por el buscador.
    const real = authoritative(col.id);
    if (!real) return;
    const updated = { ...real, description: descDraft.trim() || undefined };

    setSavingDesc(true);
    try {
      await persist(updated);
      setEditingDescId(null);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setSavingDesc(false);
    }
  }

  /**
   * Aplica una operacion de organizacion sobre la coleccion real y la guarda.
   *
   * Todas pasan por aqui: la del store esta filtrada por el buscador, y cada
   * cambio tiene que llegar tambien al YAML o se pierde en la proxima recarga.
   */
  async function applyEdit(colId: string, fn: (c: Collection) => Collection) {
    const real = authoritative(colId);
    if (!real) return;
    try {
      await persist(fn(real));
    } catch (e) {
      toast.error(String(e));
    }
  }

  function startRename(target: RenameTarget, current: string) {
    setRenaming(target);
    setRenameDraft(current);
  }

  async function commitRename() {
    const target = renaming;
    const name = renameDraft.trim();
    setRenaming(null);
    if (!target || !name) return;

    if (target.kind === "collection") {
      await applyEdit(target.colId, c => (c.name === name ? c : { ...c, name }));
    } else if (target.kind === "folder") {
      await applyEdit(target.colId, c => renameFolder(c, target.folderId, name));
    } else {
      await applyEdit(target.colId, c => renameRequest(c, target.requestId, name));
    }
  }

  function newId(colId: string, kind: "r" | "f") {
    return `${colId}-${kind}${Date.now()}`;
  }

  async function createFolder(colId: string, parentFolderId: string | null) {
    const id = newId(colId, "f");
    await applyEdit(colId, c =>
      addFolderTo(c, parentFolderId, { id, name: "New folder", expanded: true, requests: [] })
    );
    startRename({ kind: "folder", colId, folderId: id }, "New folder");
  }

  async function createRequest(colId: string, parentFolderId: string | null) {
    const id = newId(colId, "r");
    await applyEdit(colId, c =>
      addRequestTo(c, parentFolderId, {
        id, name: "New request", method: "GET", path: "", headers: {}, tests: [],
      })
    );
    startRename({ kind: "request", colId, requestId: id }, "New request");
  }

  /** Crea un YAML nuevo en una raiz. El id es el nombre del fichero. */
  async function createCollection(root: string) {
    const existing = new Set(useCollectionsStore.getState().collections.map(c => c.id));
    let id = "untitled";
    let n = 2;
    while (existing.has(id)) { id = `untitled-${n}`; n++; }

    try {
      await saveCollection(root, {
        id, name: "Untitled", requests: [], folders: [], expanded: true, rootDir: root,
      });
      await reloadAll(roots);
      startRename({ kind: "collection", colId: id }, "Untitled");
    } catch (e) {
      toast.error(String(e));
    }
  }

  /** Segundo menu, en el mismo sitio, para confirmar un borrado. */
  function confirmIn(x: number, y: number, label: string, run: () => void) {
    setMenu({ x, y, items: [
      { label, danger: true, onClick: run },
      { label: "Cancel", onClick: () => {} },
    ]});
  }

  /**
   * Mueve una peticion, dentro de su coleccion o a otra.
   *
   * Entre colecciones son dos ficheros, y pueden estar en dos carpetas raiz
   * distintas. Se guarda primero el destino: si fallara el segundo guardado la
   * peticion queda duplicada y a la vista, no perdida.
   */
  async function moveRequestTo(
    fromColId: string,
    requestId: string,
    toColId: string,
    targetFolderId: string | null,
  ) {
    if (fromColId === toColId) {
      await applyEdit(fromColId, c => moveRequest(c, requestId, targetFolderId));
      return;
    }
    const from = authoritative(fromColId);
    const to = authoritative(toColId);
    if (!from || !to) return;

    // Id nuevo: el de origen lleva el prefijo de su coleccion y podria chocar.
    const moved = moveRequestBetween(from, to, requestId, targetFolderId, newId(to.id, "r"));
    if (!moved) return;

    try {
      await persist(moved.to);
      await persist(moved.from);
      toast.success(`Moved to ${to.name}`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  /**
   * Destinos dentro de una coleccion: su raiz y cada carpeta.
   *
   * Si el destino es la coleccion de origen se quita donde ya esta, que no es
   * un movimiento.
   */
  function moveTargets(from: Collection, req: CollectionRequest, to: Collection): MenuItem[] {
    const here = from.id === to.id ? folderContaining(from, req.id) : undefined;

    const places: { id: string | null; label: string }[] = [
      { id: null, label: `${to.name} (root)` },
      ...flattenFolders(to.folders).map(f => ({ id: f.id, label: f.path })),
    ];

    const items = places
      .filter(t => t.id !== here)
      .map<MenuItem>(t => ({
        label: t.label,
        onClick: () => void moveRequestTo(from.id, req.id, to.id, t.id),
      }));

    return items.length > 0
      ? items
      : [{ label: "Already the only place here", onClick: () => {}, disabled: true }];
  }

  function collectionMenu(col: Collection, x: number, y: number): MenuItem[] {
    return [
      { label: "Rename…", onClick: () => startRename({ kind: "collection", colId: col.id }, col.name) },
      { label: "New request", onClick: () => createRequest(col.id, null) },
      { label: "New folder", onClick: () => createFolder(col.id, null) },
      { label: "Inherited settings…", onClick: () => setInheritTarget({ colId: col.id, folderId: null }) },
      {
        label: "Delete collection", danger: true, separated: true,
        onClick: () => confirmIn(x, y, `Delete "${col.name}" and its file`, () => {
          setConfirmDeleteId(col.id);
          void handleDelete(col);
        }),
      },
    ];
  }

  function folderMenu(colId: string, folder: CollectionFolder, x: number, y: number): MenuItem[] {
    const count = folderCount(folder);
    return [
      { label: "Rename…", onClick: () => startRename({ kind: "folder", colId, folderId: folder.id }, folder.name) },
      { label: "New request", onClick: () => createRequest(colId, folder.id) },
      { label: "New folder", onClick: () => createFolder(colId, folder.id) },
      { label: "Inherited settings…", onClick: () => setInheritTarget({ colId, folderId: folder.id }) },
      {
        label: "Delete folder", danger: true, separated: true,
        onClick: () => confirmIn(
          x, y,
          count > 0 ? `Delete "${folder.name}" and ${count} request(s)` : `Delete "${folder.name}"`,
          () => void applyEdit(colId, c => deleteFolderFrom(c, folder.id)),
        ),
      },
    ];
  }

  function requestMenu(col: Collection, req: CollectionRequest, x: number, y: number): MenuItem[] {
    // Dos niveles: primero a que coleccion, despues a que carpeta de esa. Una
    // sola lista con todas las carpetas de todas las colecciones seria larga y
    // ambigua en cuanto haya dos carpetas con el mismo nombre.
    const all = useCollectionsStore.getState().collections;

    return [
      { label: "Rename…", onClick: () => startRename({ kind: "request", colId: col.id, requestId: req.id }, req.name) },
      { label: "Duplicate", onClick: () => void applyEdit(col.id, c => duplicateRequest(c, req.id, newId(col.id, "r"))) },
      {
        label: "Move to…",
        onClick: () => setMenu({ x, y, items: all.map(target => ({
          label: target.id === col.id ? `${target.name} — this collection` : target.name,
          onClick: () => setMenu({ x, y, items: moveTargets(col, req, target) }),
        })) }),
      },
      {
        label: "Delete request", danger: true, separated: true,
        onClick: () => confirmIn(x, y, `Delete "${req.name}"`, () =>
          void applyEdit(col.id, c => deleteRequestFrom(c, req.id))),
      },
    ];
  }

  async function handleSelect(req: CollectionRequest, baseUrl?: string) {
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
    useRequestStore.setState(fromCollectionRequest(req, baseUrl));
  }

  /** Devuelve la caja de renombrado si a este nodo le toca. */
  function renameBoxFor(
    colId: string,
  ): (kind: "folder" | "request", id: string, current: string) => RenameBox | undefined {
    return (kind, id) => {
      const r = renaming;
      const mine =
        r !== null && r.colId === colId &&
        ((kind === "folder" && r.kind === "folder" && r.folderId === id) ||
          (kind === "request" && r.kind === "request" && r.requestId === id));
      if (!mine) return undefined;
      return {
        active: true,
        value: renameDraft,
        onChange: setRenameDraft,
        onCommit: () => void commitRename(),
        onCancel: () => setRenaming(null),
      };
    };
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
          onContextMenu={e => {
            e.preventDefault();
            const real = authoritative(col.id);
            if (real) setMenu({ x: e.clientX, y: e.clientY, items: collectionMenu(real, e.clientX, e.clientY) });
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <button onClick={() => toggleCollection(col.id)} className="flex items-center gap-1.5 flex-1 min-w-0">
            <ChevronRight size={12} className="shrink-0 transition-transform"
              style={{ color: "var(--color-fg-3)", transform: col.expanded ? "rotate(90deg)" : "rotate(0deg)" }} />
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--color-accent)", flexShrink: 0 }} />
            {renaming?.kind === "collection" && renaming.colId === col.id ? (
              <RenameInput
                active
                value={renameDraft}
                onChange={setRenameDraft}
                onCommit={() => void commitRename()}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <span className="text-[12px] font-medium flex-1 text-left truncate" style={{ color: "var(--color-fg)" }}>{col.name}</span>
            )}
          </button>
          <div className="relative flex items-center gap-0.5">
            <button onClick={e => { e.stopPropagation(); handleDelete(col); }}
              title={confirmDeleteId === col.id ? "Click again to confirm" : "Delete collection"}
              className="flex items-center justify-center rounded opacity-0 group-hover/col:opacity-100 transition-opacity"
              style={{ width: 18, height: 18, color: confirmDeleteId === col.id ? "#EF4444" : "var(--color-fg-3)", flexShrink: 0 }}>
              <Trash2 size={11} />
            </button>
            <button onClick={e => { e.stopPropagation(); setInheritTarget({ colId: col.id, folderId: null }); setExportMenuId(null); }}
              title="Auth, headers and scripts inherited by every request"
              className="flex items-center justify-center rounded opacity-0 group-hover/col:opacity-100 transition-opacity"
              style={{ width: 18, height: 18, color: hasInherited(col) ? "var(--color-accent)" : "var(--color-fg-3)", flexShrink: 0 }}>
              <Shield size={11} />
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
                <button onClick={() => { exportDataAsJson(JSON.parse(exportPostman(col)), `${col.id}.postman_collection.json`); setExportMenuId(null); toast.success(`Exported ${col.name}`); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors w-full"
                  style={{ color: "var(--color-fg-2)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  Postman v2.1
                </button>
                <button onClick={() => { exportDataAsJson(JSON.parse(exportOpenAPI(col)), `${col.id}.openapi.json`); setExportMenuId(null); toast.success(`Exported ${col.name}`); }}
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
              <RequestRow key={req.id} req={req} activeRequestId={activeRequestId} paddingLeft={28}
                onSelect={r => handleSelect(r, col.baseUrl)}
                onContextMenu={(e, r) => {
                  e.preventDefault();
                  const real = authoritative(col.id);
                  if (real) setMenu({ x: e.clientX, y: e.clientY, items: requestMenu(real, r, e.clientX, e.clientY) });
                }}
                rename={renameBoxFor(col.id)("request", req.id, req.name)} />
            ))}
            {col.folders.map(folder => (
              <FolderRow key={folder.id} folder={folder} collectionId={col.id} depth={0}
                activeRequestId={activeRequestId} onToggle={toggleFolder} onSelect={r => handleSelect(r, col.baseUrl)}
                onSettings={(colId, folderId) => setInheritTarget({ colId, folderId })}
                onFolderMenu={(e, f) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, items: folderMenu(col.id, f, e.clientX, e.clientY) });
                }}
                onRequestMenu={(e, r) => {
                  e.preventDefault();
                  const real = authoritative(col.id);
                  if (real) setMenu({ x: e.clientX, y: e.clientY, items: requestMenu(real, r, e.clientX, e.clientY) });
                }}
                renameOf={renameBoxFor(col.id)} />
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
        {roots.length > 0 && (
          <>
            <button onClick={() => reloadAll(roots)} disabled={loading} title="Reload"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-40"
              style={{ width: 24, height: 24, color: "var(--color-fg-3)" }}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={handleClearAll}
              title={confirmClearAll
                ? `Click again to delete the root .yaml files in ${roots.length} folder${roots.length > 1 ? "s" : ""}`
                : "Clear all root collections"}
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 24, height: 24, background: "var(--color-card)", color: confirmClearAll ? "#EF4444" : "var(--color-fg-3)" }}>
              <X size={13} />
            </button>
            <button
              onClick={e => {
                if (roots.length === 1) { void createCollection(roots[0]); return; }
                // Con varias carpetas hay que decir en cual.
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({
                  x: r.left, y: r.bottom + 4,
                  items: roots.map(root => ({
                    label: `New in ${rootLabel(root)}`,
                    onClick: () => void createCollection(root),
                  })),
                });
              }}
              title="New collection"
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 24, height: 24, background: "var(--color-card)", color: "var(--color-fg-3)" }}>
              <Plus size={14} />
            </button>
            <button
              onClick={() => setAddingRoot(v => !v)}
              title="Add another collections folder"
              className="flex items-center justify-center rounded transition-colors"
              style={{
                width: 24, height: 24, background: "var(--color-card)",
                color: addingRoot ? "var(--color-accent)" : "var(--color-fg-3)",
              }}>
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

      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <CollectionRunner open={runnerOpen} onClose={() => setRunnerOpen(false)} />
      <GitHubSyncModal open={githubOpen} onClose={() => setGithubOpen(false)} collectionsDir={roots[0] ?? null} onReload={() => reloadAll(roots)} />
      {inheritTarget && (() => {
        // Siempre sobre la del store: la que se pinta viene filtrada por el
        // buscador y guardarla dejaria el YAML sin las requests ocultas.
        const real = authoritative(inheritTarget.colId);
        if (!real) return null;
        return (
          <InheritanceModal
            key={`${inheritTarget.colId}:${inheritTarget.folderId ?? "root"}`}
            collection={real}
            folderId={inheritTarget.folderId}
            saving={savingInherit}
            onClose={() => setInheritTarget(null)}
            onSave={saveInheritance}
          />
        );
      })()}

      {/* Carpetas abiertas. Quitar una no borra nada del disco. */}
      {roots.length > 0 && (addingRoot || roots.length > 1) && (
        <div className="flex flex-col shrink-0 px-2 py-1.5 gap-1"
          style={{ borderBottom: "1px solid var(--color-border)" }}>
          {roots.map(root => (
            <div key={root} className="group/root flex items-center gap-1.5 px-1 rounded"
              style={{ height: 22 }} title={root}>
              <Folder size={10} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
              <span className="text-[10px] flex-1 truncate" style={{ color: "var(--color-fg-3)" }}>
                {rootLabel(root)}
              </span>
              <button onClick={() => handleRemoveRoot(root)}
                title="Close this folder (files are left alone)"
                className="flex items-center justify-center rounded opacity-0 group-hover/root:opacity-100 transition-opacity"
                style={{ width: 16, height: 16, color: "var(--color-fg-4)", flexShrink: 0 }}>
                <X size={10} />
              </button>
            </div>
          ))}
          {addingRoot && (
            <div className="flex items-center gap-1 pt-1">
              <input
                value={newRoot}
                onChange={e => setNewRoot(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") { setAddingRoot(false); setNewRoot(""); }
                  if (e.key === "Enter" && newRoot.trim()) {
                    handleAddRoot(newRoot.trim());
                    setNewRoot("");
                    setAddingRoot(false);
                  }
                }}
                autoFocus
                placeholder="Paste another folder path"
                className="flex-1 px-2 rounded text-[10px]"
                style={{
                  height: 24, background: "var(--color-input)",
                  border: "1px solid var(--color-border)", color: "var(--color-fg-2)",
                  fontFamily: "Geist Mono, monospace", outline: "none",
                }}
              />
            </div>
          )}
        </div>
      )}

      {roots.length === 0 ? (
        <FolderSetup onSet={handleAddRoot} />
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
