import { useState, useRef, useEffect } from "react";
import { Network, Play, RefreshCw, Upload, Trash2, Plus, X, ChevronRight, ChevronDown, Lock, Unlock, BookMarked, Check, Bookmark, Pencil, Square, SendHorizontal, CircleStop } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useGrpcStore, type GrpcMetadataEntry } from "@/stores/grpcStore";
import {
  grpcImportProto, grpcReflect, grpcInvoke, grpcLoadProtoById,
  grpcStreamOpen, grpcStreamSend, grpcStreamCloseSend, grpcStreamCancel,
  saveHistory, saveCollection,
  type GrpcService, type GrpcStreamEvent,
} from "@/lib/tauri";
import { useProtoLibraryStore } from "@/stores/protoLibraryStore";
import { useCollectionsStore } from "@/stores/collections";
import { pushHistory, pushCollection } from "@/lib/sync";
import { CodeEditor } from "@/components/CodeEditor";
import { useEnvironmentStore } from "@/stores/environment";
import { useUserStore } from "@/stores/user";
import { toast } from "sonner";

const DIR_KEY = "flux_collections_dir";

type Tab = "payload" | "metadata" | "proto";

function generateProtoFromServices(services: GrpcService[]): string {
  const lines: string[] = ['syntax = "proto3";', ""];
  const messagesSeen = new Set<string>();

  for (const svc of services) {
    lines.push(`service ${svc.name} {`);
    for (const m of svc.methods) {
      const inp = m.clientStreaming ? `stream ${m.inputType.split(".").pop()}` : m.inputType.split(".").pop();
      const out = m.serverStreaming ? `stream ${m.outputType.split(".").pop()}` : m.outputType.split(".").pop();
      lines.push(`  rpc ${m.name} (${inp}) returns (${out}) {}`);
    }
    lines.push("}");
    lines.push("");
  }

  for (const svc of services) {
    for (const m of svc.methods) {
      if (!messagesSeen.has(m.inputType) && m.inputFields.length > 0) {
        messagesSeen.add(m.inputType);
        const msgName = m.inputType.split(".").pop() ?? m.inputType;
        lines.push(`message ${msgName} {`);
        m.inputFields.forEach((f, i) => {
          const mod = f.repeated ? "repeated " : f.optional ? "optional " : "";
          const typeName = f.kind === "message" ? f.typeName.split(".").pop() : f.kind;
          lines.push(`  ${mod}${typeName} ${f.name} = ${i + 1};`);
        });
        lines.push("}");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function methodKindGlyph(client: boolean, server: boolean) {
  if (client && server) return "⇄";
  if (server) return "⇉";
  if (client) return "⇇";
  return "→";
}

function methodKindLabel(client: boolean, server: boolean) {
  if (client && server) return "Bidirectional streaming";
  if (server) return "Server streaming";
  if (client) return "Client streaming";
  return "Unary";
}

/** One decoded message from a streaming call, as shown in the response log. */
interface StreamFrame {
  seq: number;
  body: string;
  at: string;
}

type StreamStatus = "idle" | "open" | "closed" | "error";

function ServiceTree({
  services,
  selectedService,
  selectedMethod,
  onSelectMethod,
}: {
  services: GrpcService[];
  selectedService: string | null;
  selectedMethod: string | null;
  onSelectMethod: (service: string, method: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center" style={{ color: "var(--color-fg-4)" }}>
        <Network size={24} style={{ opacity: 0.3 }} />
        <span className="text-[11px]">Import a .proto file or use server reflection</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {services.map((svc) => {
        const open = expanded[svc.fullName] !== false;
        return (
          <div key={svc.fullName}>
            <button
              className="flex items-center gap-1.5 w-full px-3 py-1 text-left transition-colors hover:opacity-80"
              onClick={() => setExpanded((p) => ({ ...p, [svc.fullName]: !open }))}
              style={{ color: "var(--color-fg-2)" }}
            >
              {open
                ? <ChevronDown size={11} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
                : <ChevronRight size={11} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />}
              <span className="text-[11px] font-semibold truncate">{svc.name}</span>
            </button>
            {open && svc.methods.map((m) => {
              const isActive = selectedService === svc.fullName && selectedMethod === m.name;
              return (
                <button
                  key={`${svc.fullName}-${m.name}`}
                  className="flex items-center gap-1.5 w-full px-3 py-1 text-left transition-colors hover:opacity-80 pl-7"
                  onClick={() => onSelectMethod(svc.fullName, m.name)}
                  style={{
                    background: isActive ? "var(--color-accent-10)" : "transparent",
                    color: isActive ? "var(--color-accent)" : "var(--color-fg-3)",
                  }}
                >
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--color-fg-4)", fontFamily: "var(--font-mono)" }}
                    title={methodKindLabel(m.clientStreaming, m.serverStreaming)}
                  >
                    {methodKindGlyph(m.clientStreaming, m.serverStreaming)}
                  </span>
                  <span className="text-[11px] truncate">{m.name}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** A single streaming message: header line always visible, body collapsible. */
function StreamFrameRow({ frame }: { frame: StreamFrame }) {
  const [open, setOpen] = useState(true);
  const preview = frame.body.replace(/\s+/g, " ").trim();

  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-4 py-1.5 text-left transition-colors hover:opacity-80"
      >
        {open
          ? <ChevronDown size={11} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />}
        <span className="text-[10px] shrink-0" style={{ color: "var(--color-accent)", fontFamily: "var(--font-mono)" }}>
          #{frame.seq + 1}
        </span>
        <span className="text-[10px] shrink-0" style={{ color: "var(--color-fg-4)", fontFamily: "var(--font-mono)" }}>
          {frame.at}
        </span>
        {!open && (
          <span className="text-[11px] truncate" style={{ color: "var(--color-fg-3)", fontFamily: "var(--font-mono)" }}>
            {preview}
          </span>
        )}
      </button>
      {open && (
        <pre
          className="px-4 pb-2 text-[11px] whitespace-pre-wrap break-all"
          style={{ color: "var(--color-fg-2)", fontFamily: "var(--font-mono)" }}
        >
          {frame.body}
        </pre>
      )}
    </div>
  );
}

function MetadataEditor({
  entries,
  onChange,
}: {
  entries: GrpcMetadataEntry[];
  onChange: (entries: GrpcMetadataEntry[]) => void;
}) {
  function add() {
    onChange([...entries, { id: crypto.randomUUID(), key: "", value: "", enabled: true }]);
  }
  function remove(id: string) {
    onChange(entries.filter((e) => e.id !== id));
  }
  function update(id: string, field: "key" | "value", val: string) {
    onChange(entries.map((e) => (e.id === id ? { ...e, [field]: val } : e)));
  }
  function toggle(id: string) {
    onChange(entries.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2">
          <button onClick={() => toggle(e.id)} style={{ color: e.enabled ? "var(--color-accent)" : "var(--color-fg-4)", flexShrink: 0 }}>
            <div className="w-3 h-3 rounded-sm border" style={{
              background: e.enabled ? "var(--color-accent)" : "transparent",
              borderColor: e.enabled ? "var(--color-accent)" : "var(--color-border)",
            }} />
          </button>
          <div className="flex-1 flex items-center px-2 rounded" style={{ height: 28, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
            <input
              className="flex-1 text-[11px] bg-transparent"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg)" }}
              placeholder="key"
              value={e.key}
              onChange={(ev) => update(e.id, "key", ev.target.value)}
            />
          </div>
          <div className="flex-1 flex items-center px-2 rounded" style={{ height: 28, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
            <input
              className="flex-1 text-[11px] bg-transparent"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg)" }}
              placeholder="value"
              value={e.value}
              onChange={(ev) => update(e.id, "value", ev.target.value)}
            />
          </div>
          <button onClick={() => remove(e.id)} style={{ color: "var(--color-fg-4)", flexShrink: 0 }}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-[11px] mt-1 transition-colors hover:opacity-80"
        style={{ color: "var(--color-fg-3)" }}
      >
        <Plus size={11} /> Add metadata
      </button>
    </div>
  );
}

function GrpcSavePopover({
  onClose,
  endpoint,
  service,
  method,
  payload,
  metadata,
  protoId,
  protoName,
}: {
  onClose: () => void;
  endpoint: string;
  service: string | null;
  method: string | null;
  payload: string;
  metadata: GrpcMetadataEntry[];
  protoId: string | null;
  protoName?: string;
}) {
  const { collections } = useCollectionsStore();
  const defaultName = service && method ? `${service.split(".").pop()}/${method}` : "gRPC request";
  const [name, setName] = useState(defaultName);
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  async function handleSave() {
    const dir = localStorage.getItem(DIR_KEY);
    if (!dir || !collectionId) return;
    const col = collections.find(c => c.id === collectionId);
    if (!col) return;
    setSaving(true);
    try {
      const metaMap: Record<string, string> = {};
      for (const e of metadata) {
        if (e.enabled && e.key) metaMap[e.key] = e.value;
      }
      const newReq = {
        id: `${collectionId}-grpc-${Date.now()}`,
        name,
        kind: "grpc" as const,
        method: "GET" as const,
        path: "",
        headers: {},
        tests: [],
        grpc: { endpoint, service: service ?? undefined, method: method ?? undefined, payload, metadata: metaMap, protoId: protoId ?? undefined, protoName },
      };
      const updated = {
        ...col,
        requests: [...col.requests.map(r => ({ ...r, headers: r.headers ?? {}, tests: r.tests ?? [] })), newReq],
        folders: col.folders.map(f => ({ ...f, requests: f.requests.map(r => ({ ...r, headers: r.headers ?? {}, tests: r.tests ?? [] })) })),
      };
      await saveCollection(dir, updated);
      useCollectionsStore.setState({ collections: useCollectionsStore.getState().collections.map(c => c.id === col.id ? updated : c) });
      const userId = useUserStore.getState().user?.id;
      if (userId) pushCollection(userId, updated);
      toast.success(`Saved to ${col.name}`);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="absolute top-full right-0 mt-1 z-50 rounded-lg p-3 flex flex-col gap-2"
      style={{ width: 260, background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "0 8px 32px #00000060" }}>
      <span className="text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>Save to collection</span>
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder="Request name"
        className="w-full px-2 rounded text-[12px]"
        style={{ height: 30, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }} />
      {collections.length > 0 ? (
        <select value={collectionId} onChange={e => setCollectionId(e.target.value)}
          className="w-full px-2 rounded text-[12px]"
          style={{ height: 30, background: "var(--color-input)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}>
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : (
        <p className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>No collections loaded — set a folder first.</p>
      )}
      <button onClick={handleSave} disabled={saving || !collectionId || !name}
        className="flex items-center justify-center gap-1.5 w-full rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ height: 28, fontSize: 12, background: "var(--color-accent)" }}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function GrpcRoute() {
  const {
    protoId, protoText, services,
    endpoint, useTls,
    selectedService, selectedMethod,
    payload, metadata,
    response, isLoading, error,
    setProtoId, setProtoText, setServices,
    setEndpoint, setUseTls,
    setSelectedService, setSelectedMethod,
    setPayload, setMetadata,
    setResponse, setLoading, setError,
  } = useGrpcStore();

  const { resolveVariable } = useEnvironmentStore();
  const { protos, load: loadProtos, save: saveProto, remove: removeProto, rename: renameProto } = useProtoLibraryStore();

  const [tab, setTab] = useState<Tab>("payload");
  const [invokedAt, setInvokedAt] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Streaming call state — ephemeral, so it stays out of the persisted store.
  const [frames, setFrames] = useState<StreamFrame[]>([]);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  // Bumped per call so a late event from an aborted stream is ignored.
  const streamGenRef = useRef(0);

  useEffect(() => () => { unlistenRef.current.forEach(fn => fn()); }, []);

  // Proto library UI state
  const [libOpen, setLibOpen] = useState(true);
  const [savingName, setSavingName] = useState("");
  const [saveMode, setSaveMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // Save to collection popover
  const [showSave, setShowSave] = useState(false);

  useEffect(() => { loadProtos(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSvc = services.find((s) => s.fullName === selectedService) ?? null;
  const selectedMth = selectedSvc?.methods.find((m) => m.name === selectedMethod) ?? null;
  const resolvedEndpoint = resolveVariable(endpoint.trim());
  const endpointHasVars = /\{\{[^}]+\}\}/.test(endpoint);

  async function handleSaveProto() {
    if (!protoId || !savingName.trim()) return;
    setSaving(true);
    try {
      const source = protoText.trim() ? "file" : resolveVariable(endpoint.trim());
      await saveProto(savingName.trim(), source, protoId);
      setSaveMode(false);
      setSavingName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadSavedProto(id: string) {
    setError(null);
    setLoading(true);
    try {
      const info = await grpcLoadProtoById(id);
      setProtoId(info.id);
      setServices(info.services);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    setProtoText(text);
    setError(null);
    setLoading(true);
    try {
      const info = await grpcImportProto(text);
      setProtoId(info.id);
      setServices(info.services);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleReflect() {
    if (!endpoint.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const resolvedEndpoint = resolveVariable(endpoint.trim());
      const info = await grpcReflect(resolvedEndpoint, useTls);
      setProtoId(info.id);
      setServices(info.services);
      setProtoText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  /** Resolves the proto id, re-importing from text when it went stale across a restart. */
  async function ensureProtoId(): Promise<string | null> {
    if (protoId) return protoId;
    if (protoText.trim()) {
      const info = await grpcImportProto(protoText);
      setProtoId(info.id);
      setServices(info.services);
      return info.id;
    }
    return null;
  }

  function buildMetadataMap(): Record<string, string> {
    const metaMap: Record<string, string> = {};
    for (const e of metadata) {
      if (e.enabled && e.key.trim()) metaMap[e.key.trim()] = resolveVariable(e.value);
    }
    return metaMap;
  }

  async function handleStartStream(activeProtoId: string) {
    if (!selectedService || !selectedMethod || !selectedMth) return;

    setFrames([]);
    setStreamNote(null);
    setStreamStatus("open");

    // Tear down the previous subscriptions before claiming this generation, so a
    // late event from an aborted call cannot land in this one's log.
    unlistenRef.current.forEach(fn => fn());
    unlistenRef.current = [];
    const gen = ++streamGenRef.current;
    const isCurrent = () => streamGenRef.current === gen;

    // Subscribing before opening matters: the backend starts pumping as soon as
    // the call is made, and the stream id only comes back once it has.
    unlistenRef.current = await Promise.all([
      listen<GrpcStreamEvent>("grpc-stream-message", e => {
        if (!isCurrent()) return;
        setFrames(prev => [...prev, { seq: e.payload.seq, body: e.payload.payload, at: now() }]);
      }),
      listen<GrpcStreamEvent>("grpc-stream-error", e => {
        if (!isCurrent()) return;
        setError(e.payload.payload);
        setStreamStatus("error");
        setStreamId(null);
        setLoading(false);
      }),
      listen<GrpcStreamEvent>("grpc-stream-closed", e => {
        if (!isCurrent()) return;
        setStreamNote(e.payload.payload);
        setStreamStatus("closed");
        setStreamId(null);
        setLoading(false);
      }),
    ]);

    try {
      // A client-streaming call may legitimately start with no message at all.
      const seed = selectedMth.clientStreaming && !payload.trim() ? "" : resolveVariable(payload);
      const id = await grpcStreamOpen(
        resolveVariable(endpoint.trim()),
        selectedService,
        selectedMethod,
        seed,
        buildMetadataMap(),
        useTls,
        activeProtoId,
      );
      setStreamId(id);
      setTab("payload");
    } catch (e) {
      setError(String(e));
      setStreamStatus("error");
      setLoading(false);
    }
  }

  async function handleStreamSend() {
    if (!streamId) return;
    try {
      await grpcStreamSend(streamId, resolveVariable(payload));
      toast.success("Message sent");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleEndStream() {
    if (!streamId) return;
    try {
      await grpcStreamCloseSend(streamId);
      setStreamNote("waiting for server…");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCancelStream() {
    if (!streamId) return;
    try {
      await grpcStreamCancel(streamId);
    } catch (e) {
      setError(String(e));
    }
    // Retire this generation so the backend's own "cancelled" event, which
    // arrives right after, does not overwrite the state set here.
    streamGenRef.current++;
    setStreamId(null);
    setStreamStatus("closed");
    setStreamNote("cancelled");
    setLoading(false);
  }

  async function handleInvoke() {
    if (!selectedService || !selectedMethod) return;
    setError(null);
    setResponse(null);
    setLoading(true);
    setInvokedAt(now());

    // Auto-reimport proto from text when protoId is stale (e.g. after app restart)
    let activeProtoId: string | null;
    try {
      activeProtoId = await ensureProtoId();
    } catch (e) {
      setError(String(e));
      setLoading(false);
      return;
    }

    if (!activeProtoId) {
      setError("Load a .proto file or use server reflection first");
      setLoading(false);
      return;
    }

    if (isStreamingMethod) {
      await handleStartStream(activeProtoId);
      return;
    }

    try {
      const metaMap = buildMetadataMap();
      const resp = await grpcInvoke(
        resolveVariable(endpoint.trim()),
        selectedService,
        selectedMethod,
        resolveVariable(payload),
        metaMap,
        useTls,
        activeProtoId,
      );
      setResponse(resp);
      setTab("payload");

      const resolvedEp = resolveVariable(endpoint.trim());
      const histUrl = `${resolvedEp}/${selectedService}/${selectedMethod}`;
      const { environments: envs, activeId: envActiveId } = useEnvironmentStore.getState();
      const envName = envs.find(e => e.id === envActiveId)?.name ?? "";
      const timestamp = new Date().toISOString();
      await saveHistory("gRPC", histUrl, 200, resp.durationMs, envName);
      const userId = useUserStore.getState().user?.id;
      if (userId) {
        pushHistory(userId, {
          method: "gRPC", url: histUrl,
          status: 200, durationMs: resp.durationMs,
          environment: envName, timestamp,
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const isStreamingMethod = !!selectedMth && (selectedMth.clientStreaming || selectedMth.serverStreaming);
  const isStreamOpen = streamStatus === "open" && !!streamId;
  // Only client-streaming and bidi calls accept further messages from this side.
  const acceptsClientMessages = isStreamOpen && !!selectedMth?.clientStreaming;
  const canInvoke = (!!protoId || !!protoText.trim()) && !!selectedService && !!selectedMethod && !isLoading && !isStreamOpen;

  return (
    <div className="flex flex-1 h-full overflow-hidden" style={{ background: "var(--color-bg)" }}>

      {/* Left sidebar — service tree */}
      <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 220, borderRight: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>

        {/* Proto source buttons */}
        <div className="shrink-0 px-3 py-2 flex flex-col gap-1.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>Proto Source</span>
          <button
            className="flex items-center gap-1.5 px-2 rounded transition-colors hover:opacity-80 text-left"
            style={{ height: 28, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontSize: 11 }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={11} /> Import .proto file
          </button>
          <button
            className="flex items-center gap-1.5 px-2 rounded transition-colors hover:opacity-80 text-left"
            style={{ height: 28, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontSize: 11 }}
            onClick={handleReflect}
            disabled={isLoading}
          >
            <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} />
            Server reflection
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".proto"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Save to Library */}
        {protoId && (
          <div className="shrink-0 px-3 py-2 flex flex-col gap-1.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
            {!saveMode ? (
              <button
                className="flex items-center gap-1.5 px-2 rounded transition-colors hover:opacity-80 text-left"
                style={{ height: 28, background: "var(--color-accent-10)", border: "1px solid var(--color-accent-50)", color: "var(--color-accent)", fontSize: 11 }}
                onClick={() => { setSaveMode(true); setSavingName(""); }}
              >
                <BookMarked size={11} /> Save to Library
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  autoFocus
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveProto(); if (e.key === "Escape") setSaveMode(false); }}
                  placeholder="Proto name…"
                  className="px-2 rounded text-[11px] bg-transparent"
                  style={{ height: 26, border: "1px solid var(--color-accent-50)", color: "var(--color-fg)", background: "var(--color-input)" }}
                />
                <div className="flex gap-1">
                  <button
                    onClick={handleSaveProto}
                    disabled={!savingName.trim() || saving}
                    className="flex-1 flex items-center justify-center gap-1 rounded text-[11px] transition-colors hover:opacity-80 disabled:opacity-40"
                    style={{ height: 24, background: "var(--color-accent)", color: "#fff" }}
                  >
                    <Check size={10} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setSaveMode(false)}
                    className="flex items-center justify-center rounded transition-colors hover:opacity-80"
                    style={{ width: 24, height: 24, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Saved Protos Library */}
        <div className="shrink-0 flex flex-col" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <button
            className="flex items-center gap-1.5 px-3 w-full text-left transition-colors hover:opacity-80"
            style={{ height: 32 }}
            onClick={() => setLibOpen((v) => !v)}
          >
            {libOpen
              ? <ChevronDown size={11} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />
              : <ChevronRight size={11} style={{ color: "var(--color-fg-4)", flexShrink: 0 }} />}
            <span className="text-[10px] font-semibold uppercase tracking-wide flex-1" style={{ color: "var(--color-fg-4)" }}>Library</span>
            {protos.length > 0 && (
              <span className="text-[10px] px-1.5 rounded" style={{ background: "var(--color-card)", color: "var(--color-fg-3)" }}>
                {protos.length}
              </span>
            )}
          </button>
          {libOpen && (
            <div className="flex flex-col py-1 max-h-40 overflow-y-auto">
              {protos.length === 0 && (
                <span className="px-3 pb-2 text-[11px]" style={{ color: "var(--color-fg-4)" }}>No saved protos</span>
              )}
              {protos.map((p) => {
                const isActive = protoId === p.id;
                const isRenaming = renamingId === p.id;

                function startRename(e: React.MouseEvent) {
                  e.stopPropagation();
                  setRenamingId(p.id);
                  setRenameText(p.name);
                }

                async function commitRename() {
                  const trimmed = renameText.trim();
                  if (trimmed && trimmed !== p.name) await renameProto(p.id, trimmed);
                  setRenamingId(null);
                }

                function onRenameKey(e: React.KeyboardEvent) {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }

                return (
                  <div key={p.id} className="flex items-center gap-1 px-2 group">
                    <BookMarked size={10} style={{ flexShrink: 0, color: isActive ? "var(--color-accent)" : "var(--color-fg-4)" }} />
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameText}
                        onChange={e => setRenameText(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={onRenameKey}
                        className="flex-1 py-1 bg-transparent outline-none"
                        style={{ fontSize: 11, color: "var(--color-fg)", borderBottom: "1px solid var(--color-accent)" }}
                      />
                    ) : (
                      <button
                        className="flex-1 py-1 text-left truncate"
                        style={{ fontSize: 11, color: isActive ? "var(--color-accent)" : "var(--color-fg-2)" }}
                        onClick={() => handleLoadSavedProto(p.id)}
                      >
                        <span className="truncate">{p.name}</span>
                      </button>
                    )}
                    {!isRenaming && (
                      <>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          style={{ color: "var(--color-fg-4)" }}
                          onClick={startRename}
                          title="Rename"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          style={{ color: "var(--color-fg-4)" }}
                          onClick={() => removeProto(p.id)}
                          title="Delete"
                        >
                          <X size={10} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Service list */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 shrink-0" style={{ height: 32, borderBottom: "1px solid var(--color-border)" }}>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>Services</span>
            {services.length > 0 && (
              <span className="text-[10px] px-1.5 rounded" style={{ background: "var(--color-accent-10)", color: "var(--color-accent)" }}>
                {services.length}
              </span>
            )}
          </div>
          <ServiceTree
            services={services}
            selectedService={selectedService}
            selectedMethod={selectedMethod}
            onSelectMethod={(svc, m) => {
              setSelectedService(svc);
              setSelectedMethod(m);
              setResponse(null);
              setError(null);
              // Pre-fill payload scaffold from input fields
              const svcDesc = services.find((s) => s.fullName === svc);
              const mthDesc = svcDesc?.methods.find((me) => me.name === m);
              if (mthDesc && mthDesc.inputFields?.length > 0) {
                const scaffold: Record<string, unknown> = {};
                for (const f of mthDesc.inputFields ?? []) {
                  scaffold[f.name] = f.repeated ? [] : f.kind === "bool" ? false : f.kind === "string" ? "" : f.kind === "bytes" ? "" : f.kind === "message" ? {} : 0;
                }
                setPayload(JSON.stringify(scaffold, null, 2));
              }
            }}
          />
        </div>
      </div>

      {/* Main panel */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Endpoint bar */}
        <div className="flex flex-col shrink-0 px-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2" style={{ height: 52 }}>
          <button
            onClick={() => setUseTls(!useTls)}
            title={useTls ? "TLS enabled" : "TLS disabled"}
            className="flex items-center justify-center rounded shrink-0 transition-colors hover:opacity-80"
            style={{
              width: 28, height: 28,
              background: useTls ? "var(--color-accent-10)" : "var(--color-card)",
              border: `1px solid ${useTls ? "var(--color-accent-50)" : "var(--color-border)"}`,
              color: useTls ? "var(--color-accent)" : "var(--color-fg-4)",
            }}
          >
            {useTls ? <Lock size={11} /> : <Unlock size={11} />}
          </button>

          <div className="flex-1 flex items-center px-3 rounded-md" style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="localhost:50051"
              className="flex-1 text-[12px] bg-transparent"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg)" }}
            />
          </div>

          {selectedMth && (
            <span className="text-[11px] shrink-0 truncate max-w-[200px]" style={{ color: "var(--color-fg-3)", fontFamily: "var(--font-mono)" }}>
              {selectedService?.split(".").pop()}/{selectedMethod}
            </span>
          )}

          {isStreamOpen ? (
            <>
              {acceptsClientMessages && (
                <>
                  <button
                    onClick={handleStreamSend}
                    title="Send the payload above as another message"
                    className="flex items-center gap-1.5 px-3 rounded-md font-semibold text-white transition-opacity hover:opacity-90 shrink-0"
                    style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}
                  >
                    <SendHorizontal size={11} /> Send
                  </button>
                  <button
                    onClick={handleEndStream}
                    title="Signal end-of-stream and wait for the server to finish"
                    className="flex items-center gap-1.5 px-3 rounded-md transition-colors hover:opacity-80 shrink-0"
                    style={{ height: 32, fontSize: 13, border: "1px solid var(--color-border)", color: "var(--color-fg-2)" }}
                  >
                    <CircleStop size={11} /> End
                  </button>
                </>
              )}
              <button
                onClick={handleCancelStream}
                title="Abort the call"
                className="flex items-center gap-1.5 px-3 rounded-md font-semibold text-white transition-opacity hover:opacity-90 shrink-0"
                style={{ height: 32, fontSize: 13, background: "var(--color-red)" }}
              >
                <Square size={11} /> Stop
              </button>
            </>
          ) : (
            <button
              onClick={handleInvoke}
              disabled={!canInvoke}
              className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
              style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}
            >
              {isLoading
                ? <span className="animate-spin text-[14px]">⟳</span>
                : <Play size={11} />}
              {isLoading ? (isStreamingMethod ? "Opening…" : "Invoking…") : isStreamingMethod ? "Start stream" : "Invoke"}
            </button>
          )}

          <div className="relative shrink-0">
            <button
              onClick={() => setShowSave(v => !v)}
              disabled={!selectedService || !selectedMethod}
              title="Save to collection"
              className="flex items-center justify-center rounded-md transition-colors disabled:opacity-40"
              style={{ width: 32, height: 32, border: "1px solid var(--color-border)", color: "var(--color-fg-3)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-card)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <Bookmark size={13} />
            </button>
            {showSave && (
              <GrpcSavePopover
                onClose={() => setShowSave(false)}
                endpoint={endpoint}
                service={selectedService}
                method={selectedMethod}
                payload={payload}
                metadata={metadata}
                protoId={protoId}
                protoName={protos.find(p => p.id === protoId)?.name}
              />
            )}
          </div>
          </div>
          {endpointHasVars && (
            <div className="pb-1.5 pl-9">
              <span className="text-[10px] truncate" style={{ color: "var(--color-fg-4)", fontFamily: "var(--font-mono)" }}>
                → {resolvedEndpoint}
              </span>
            </div>
          )}
        </div>

        {/* Status bar */}
        {(error || response || streamStatus !== "idle") && (
          <div className="flex items-center gap-3 shrink-0 px-4" style={{ height: 32, borderBottom: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>
            {error && (
              <span className="text-[11px] truncate" style={{ color: "var(--color-red)" }}>{error}</span>
            )}
            {response && !error && (
              <>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--color-green)" }} />
                <span className="text-[11px]" style={{ color: "var(--color-green)" }}>OK</span>
                <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>{response.durationMs}ms</span>
                {invokedAt && <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>at {invokedAt}</span>}
              </>
            )}
            {!error && streamStatus !== "idle" && (
              <>
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${isStreamOpen ? "animate-pulse" : ""}`}
                  style={{ background: isStreamOpen ? "var(--color-accent)" : "var(--color-fg-4)" }}
                />
                <span className="text-[11px]" style={{ color: isStreamOpen ? "var(--color-accent)" : "var(--color-fg-3)" }}>
                  {isStreamOpen ? "Streaming" : "Stream closed"}
                </span>
                <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
                  {frames.length} {frames.length === 1 ? "message" : "messages"}
                </span>
                {streamNote && (
                  <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>· {streamNote}</span>
                )}
                {invokedAt && <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>at {invokedAt}</span>}
              </>
            )}
            <div className="flex-1" />
            <button
              onClick={() => {
                setResponse(null);
                setError(null);
                setFrames([]);
                setStreamStatus("idle");
                setStreamNote(null);
              }}
              disabled={isStreamOpen}
              className="flex items-center gap-1 text-[11px] transition-colors hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--color-fg-3)" }}
            >
              <Trash2 size={11} /> Clear
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center shrink-0 px-4 gap-1" style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>
          {(["payload", "metadata", "proto"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 rounded text-[11px] transition-colors hover:opacity-80 capitalize"
              style={{
                height: 24,
                background: tab === t ? "var(--color-accent-10)" : "transparent",
                border: tab === t ? "1px solid var(--color-accent-50)" : "1px solid transparent",
                color: tab === t ? "var(--color-accent)" : "var(--color-fg-3)",
              }}
            >
              {t}
              {t === "metadata" && metadata.filter((e) => e.enabled && e.key).length > 0 && (
                <span className="ml-1 text-[9px]" style={{ color: "var(--color-accent)" }}>
                  {metadata.filter((e) => e.enabled && e.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content split: request top / response bottom */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Request area */}
          <div className="flex flex-col overflow-hidden" style={{ flex: "0 0 50%", borderBottom: "1px solid var(--color-border)" }}>
            {tab === "payload" && (
              <CodeEditor
                lang="json"
                value={payload}
                onChange={setPayload}
              />
            )}

            {tab === "metadata" && (
              <div className="flex-1 overflow-y-auto">
                <MetadataEditor entries={metadata} onChange={setMetadata} />
              </div>
            )}

            {tab === "proto" && (
              <CodeEditor
                lang="proto"
                value={protoText.trim() ? protoText : generateProtoFromServices(services)}
                onChange={protoText.trim() ? setProtoText : () => {}}
                readOnly={!protoText.trim()}
              />
            )}
          </div>

          {/* Response area */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center shrink-0 px-4" style={{ height: 32, borderBottom: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>Response</span>
            </div>

            {!response && !error && streamStatus === "idle" && (
              <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: "var(--color-fg-4)" }}>
                <Network size={24} style={{ opacity: 0.3 }} />
                <span className="text-[12px]">
                  {!protoId && !protoText.trim()
                    ? "Load a .proto or use server reflection, then invoke a method"
                    : !selectedMethod
                    ? "Select a method from the left panel"
                    : isStreamingMethod
                    ? `Hit Start stream — ${methodKindLabel(!!selectedMth?.clientStreaming, !!selectedMth?.serverStreaming).toLowerCase()}`
                    : "Hit Invoke to make a request"}
                </span>
              </div>
            )}

            {/* Streaming log — one collapsible entry per decoded message */}
            {streamStatus !== "idle" && (
              <div className="flex-1 overflow-y-auto">
                {frames.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "var(--color-fg-4)" }}>
                    <span className="text-[12px]">
                      {isStreamOpen
                        ? acceptsClientMessages
                          ? "Stream open — edit the payload above and hit Send"
                          : "Stream open — waiting for messages…"
                        : "No messages received"}
                    </span>
                  </div>
                )}
                {frames.map(f => (
                  <StreamFrameRow key={f.seq} frame={f} />
                ))}
              </div>
            )}

            {response && streamStatus === "idle" && (
              <CodeEditor
                lang="json"
                value={response.body}
                onChange={() => {}}
                readOnly
              />
            )}

            {error && !response && streamStatus === "idle" && (
              <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-[11px] whitespace-pre-wrap break-all" style={{ color: "var(--color-red)", fontFamily: "var(--font-mono)" }}>
                  {error}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
