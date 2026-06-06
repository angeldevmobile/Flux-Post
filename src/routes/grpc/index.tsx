import { useState, useRef, useEffect } from "react";
import { Network, Play, RefreshCw, Upload, Trash2, Plus, X, ChevronRight, ChevronDown, Lock, Unlock, BookMarked, Check, Bookmark } from "lucide-react";
import { useGrpcStore, type GrpcMetadataEntry } from "@/stores/grpcStore";
import { grpcImportProto, grpcReflect, grpcInvoke, grpcLoadProtoById, saveHistory, saveCollection, type GrpcService } from "@/lib/tauri";
import { useProtoLibraryStore } from "@/stores/protoLibraryStore";
import { useCollectionsStore } from "@/stores/collections";
import { pushHistory, pushCollection } from "@/lib/sync";
import { CodeEditor } from "@/components/CodeEditor";
import { useEnvironmentStore } from "@/stores/environment";
import { useUserStore } from "@/stores/user";
import { toast } from "sonner";

const DIR_KEY = "flux_collections_dir";

type Tab = "payload" | "metadata" | "proto";

function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

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
                  key={m.name}
                  className="flex items-center gap-1.5 w-full px-3 py-1 text-left transition-colors hover:opacity-80 pl-7"
                  onClick={() => onSelectMethod(svc.fullName, m.name)}
                  style={{
                    background: isActive ? "var(--color-accent-10)" : "transparent",
                    color: isActive ? "var(--color-accent)" : "var(--color-fg-3)",
                  }}
                >
                  <span className="text-[10px]" style={{ color: "var(--color-fg-4)", fontFamily: "var(--font-mono)" }}>
                    {m.clientStreaming ? "↔" : m.serverStreaming ? "←" : "→"}
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
  const { protos, load: loadProtos, save: saveProto, remove: removeProto } = useProtoLibraryStore();

  const [tab, setTab] = useState<Tab>("payload");
  const [invokedAt, setInvokedAt] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Proto library UI state
  const [libOpen, setLibOpen] = useState(true);
  const [savingName, setSavingName] = useState("");
  const [saveMode, setSaveMode] = useState(false);
  const [saving, setSaving] = useState(false);

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

  async function handleInvoke() {
    if (!selectedService || !selectedMethod) return;
    setError(null);
    setResponse(null);
    setLoading(true);
    setInvokedAt(now());

    // Auto-reimport proto from text when protoId is stale (e.g. after app restart)
    let activeProtoId = protoId;
    if (!activeProtoId && protoText.trim()) {
      try {
        const info = await grpcImportProto(protoText);
        setProtoId(info.id);
        setServices(info.services);
        activeProtoId = info.id;
      } catch (e) {
        setError(String(e));
        setLoading(false);
        return;
      }
    }

    if (!activeProtoId) {
      setError("Load a .proto file or use server reflection first");
      setLoading(false);
      return;
    }

    try {
      const metaMap: Record<string, string> = {};
      for (const e of metadata) {
        if (e.enabled && e.key.trim()) metaMap[e.key.trim()] = resolveVariable(e.value);
      }
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

  const canInvoke = (!!protoId || !!protoText.trim()) && !!selectedService && !!selectedMethod && !isLoading;

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
                return (
                  <div key={p.id} className="flex items-center gap-1 px-2 group">
                    <button
                      className="flex items-center gap-1.5 flex-1 py-1 text-left rounded transition-colors hover:opacity-80 truncate"
                      style={{ fontSize: 11, color: isActive ? "var(--color-accent)" : "var(--color-fg-2)" }}
                      onClick={() => handleLoadSavedProto(p.id)}
                    >
                      <BookMarked size={10} style={{ flexShrink: 0, color: isActive ? "var(--color-accent)" : "var(--color-fg-4)" }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      style={{ color: "var(--color-fg-4)" }}
                      onClick={() => removeProto(p.id)}
                    >
                      <X size={10} />
                    </button>
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
              if (mthDesc && mthDesc.inputFields.length > 0) {
                const scaffold: Record<string, unknown> = {};
                for (const f of mthDesc.inputFields) {
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

          <button
            onClick={handleInvoke}
            disabled={!canInvoke}
            className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
            style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}
          >
            {isLoading
              ? <span className="animate-spin text-[14px]">⟳</span>
              : <Play size={11} />}
            {isLoading ? "Invoking…" : "Invoke"}
          </button>

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
        {(error || response) && (
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
            <div className="flex-1" />
            {(error || response) && (
              <button
                onClick={() => { setResponse(null); setError(null); }}
                className="flex items-center gap-1 text-[11px] transition-colors hover:opacity-80"
                style={{ color: "var(--color-fg-3)" }}
              >
                <Trash2 size={11} /> Clear
              </button>
            )}
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
                value={protoText}
                onChange={setProtoText}
              />
            )}
          </div>

          {/* Response area */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center shrink-0 px-4" style={{ height: 32, borderBottom: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-4)" }}>Response</span>
            </div>

            {!response && !error && (
              <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: "var(--color-fg-4)" }}>
                <Network size={24} style={{ opacity: 0.3 }} />
                <span className="text-[12px]">
                  {!protoId && !protoText.trim()
                    ? "Load a .proto or use server reflection, then invoke a method"
                    : !selectedMethod
                    ? "Select a method from the left panel"
                    : "Hit Invoke to make a request"}
                </span>
              </div>
            )}

            {response && (
              <CodeEditor
                lang="json"
                value={response.body}
                onChange={() => {}}
                readOnly
              />
            )}

            {error && !response && (
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
