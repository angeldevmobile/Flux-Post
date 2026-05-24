import { useState, useId, useRef, useEffect } from "react";
import { Send, Plus, Trash2, ChevronDown, Bookmark } from "lucide-react";
import { useRequestStore } from "@/stores/request";
import { sendRequest, saveHistory, saveCollection } from "@/lib/tauri";
import { methodColor, methodBg } from "@/lib/methods";
import type { HttpMethod } from "@/lib/tauri";
import { useEnvironmentStore } from "@/stores/environment";
import { useCollectionsStore } from "@/stores/collections";
import { runPreRequestScript } from "@/lib/preRequest";
import { useSettingsStore } from "@/stores/settings";

const DIR_KEY = "flux_collections_dir";

function SavePopover({ onClose }: { onClose: () => void }) {
  const { method, url, body, headers } = useRequestStore();
  const { collections } = useCollectionsStore();
  const [name, setName] = useState(url.split("/").filter(Boolean).pop() ?? "New request");
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
      const enabledHeaders: Record<string, string> = {};
      for (const h of headers) {
        if (h.enabled && h.key) enabledHeaders[h.key] = h.value;
      }
      const updated = {
        ...col,
        requests: [
          ...col.requests.map(r => ({ ...r, headers: r.headers ?? {}, tests: r.tests ?? [] })),
          { id: `${col.id}-${Date.now()}`, name, method, path: url, headers: enabledHeaders, body: body || undefined, tests: [] },
        ],
      };
      await saveCollection(dir, updated);
      useCollectionsStore.setState({ collections: useCollectionsStore.getState().collections.map(c => c.id === col.id ? updated : c) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="absolute top-full right-0 mt-1 z-50 rounded-lg p-3 flex flex-col gap-2"
      style={{ width: 280, background: "#1A1A1A", border: "1px solid #27272A", boxShadow: "0 8px 32px #00000060" }}>
      <span className="text-[12px] font-semibold text-[#E4E4E7]">Save to collection</span>
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder="Request name"
        className="w-full px-2 rounded text-[12px]"
        style={{ height: 30, background: "#141414", border: "1px solid #27272A", color: "#E4E4E7" }} />
      {collections.length > 0 ? (
        <select value={collectionId} onChange={e => setCollectionId(e.target.value)}
          className="w-full px-2 rounded text-[12px]"
          style={{ height: 30, background: "#141414", border: "1px solid #27272A", color: "#A1A1AA" }}>
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : (
        <p className="text-[11px] text-[#71717A]">No collections loaded — set a folder first.</p>
      )}
      <button onClick={handleSave} disabled={saving || !collectionId || !name}
        className="flex items-center justify-center gap-1.5 w-full rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ height: 28, fontSize: 12, background: "#A855F7" }}>
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function MethodSelector() {
  const { method, setMethod } = useRequestStore();
  const [open, setOpen] = useState(false);
  const color = methodColor(method);
  const bg = methodBg(method);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 rounded-md font-bold transition-opacity hover:opacity-80"
        style={{
          height: 32, fontSize: 12, fontFamily: "Geist Mono, monospace",
          color, background: bg, border: `1px solid ${color}40`,
        }}>
        {method}
        <ChevronDown size={12} style={{ color }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden py-1"
          style={{ background: "#1A1A1A", border: "1px solid #27272A", minWidth: 120 }}>
          {METHODS.map(m => (
            <button key={m} onClick={() => { setMethod(m); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-[#27272A] transition-colors"
              style={{ fontSize: 12, fontFamily: "Geist Mono, monospace", fontWeight: 700, color: methodColor(m) }}>
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = "Params" | "Headers" | "Body" | "Pre-req";

function KeyValueEditor({ label }: { label: string }) {
  const { headers, setHeaders, params, setParams, formFields, setFormFields } = useRequestStore();
  const items = label === "Headers" ? headers : label === "Form" ? formFields : params;
  const setItems = label === "Headers" ? setHeaders : label === "Form" ? setFormFields : setParams;
  const uid = useId();

  function addRow() { setItems([...items, { id: `${uid}-${Date.now()}`, key: "", value: "", enabled: true }]); }
  function removeRow(id: string) { setItems(items.filter(i => i.id !== id)); }
  function updateRow(id: string, field: "key" | "value", val: string) { setItems(items.map(i => i.id === id ? { ...i, [field]: val } : i)); }
  function toggleRow(id: string) { setItems(items.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i)); }

  return (
    <div className="flex flex-col gap-1.5 h-full overflow-y-auto">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2">
          <input type="checkbox" checked={item.enabled} onChange={() => toggleRow(item.id)} className="accent-[#A855F7] shrink-0" />
          <input value={item.key} onChange={e => updateRow(item.id, "key", e.target.value)} placeholder="Key"
            className="flex-1 h-7 px-2 rounded text-[12px]"
            style={{ background: "#1A1A1A", border: "1px solid #27272A", color: "#A1A1AA" }} />
          <input value={item.value} onChange={e => updateRow(item.id, "value", e.target.value)} placeholder="Value"
            className="flex-1 h-7 px-2 rounded text-[12px]"
            style={{ background: "#1A1A1A", border: "1px solid #27272A", color: "#A1A1AA" }} />
          <button onClick={() => removeRow(item.id)} className="text-[#71717A] hover:text-[#EF4444]"><Trash2 size={12} /></button>
        </div>
      ))}
      <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] text-[#71717A] hover:text-[#A1A1AA] mt-1 self-start transition-colors">
        <Plus size={12} /> Add {label === "Headers" ? "header" : label === "Form" ? "field" : "parameter"}
      </button>
    </div>
  );
}

export function RequestPanel() {
  const { url, setUrl, body, setBody, bodyType, setBodyType, graphqlQuery, setGraphqlQuery, graphqlVariables, setGraphqlVariables, preRequestScript, setPreRequestScript, isLoading, setLoading, setResponse, setError, getRequest } = useRequestStore();
  const { resolveVariable } = useEnvironmentStore();
  const [tab, setTab] = useState<Tab>("Body");
  const [showSave, setShowSave] = useState(false);

  async function handleSend() {
    if (!url) return;
    setLoading(true); setError(null); setResponse(null);
    try {
      const req = getRequest();

      if (preRequestScript.trim()) {
        const { environments, activeId, updateEnvironment } = useEnvironmentStore.getState();
        const activeEnv = environments.find(e => e.id === activeId);
        const envVars = activeEnv?.variables ?? {};
        const mutations = runPreRequestScript(preRequestScript, envVars);
        Object.assign(req.headers, mutations.headers);
        if (activeId && Object.keys(mutations.envVars).length > 0) {
          updateEnvironment(activeId, { variables: { ...envVars, ...mutations.envVars } });
        }
      }

      req.url = resolveVariable(req.url);
      const resolved: typeof req = {
        ...req,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, resolveVariable(v)])
        ),
        body: req.body ? resolveVariable(req.body) : undefined,
      };
      const { timeoutMs, followRedirects, sslVerify } = useSettingsStore.getState();
      const resp = await sendRequest({ ...resolved, timeoutMs, followRedirects, sslVerify });
      setResponse(resp);
      await saveHistory(resolved.method, resolved.url, resp.status, resp.durationMs);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendRef.current();
      } else if (e.key === "s") {
        e.preventDefault();
        if (useRequestStore.getState().url) setShowSave(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const TABS: Tab[] = ["Params", "Headers", "Body", "Pre-req"];

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "#0A0A0A", borderRight: "1px solid #27272A" }}>
      {/* URL Bar */}
      <div className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid #27272A" }}>
        <MethodSelector />
        <div className="flex-1 flex items-center px-3 rounded-md" style={{ height: 32, background: "#141414", border: "1px solid #27272A" }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="https://api.myapp.com/endpoint"
            className="flex-1 text-[12px] bg-transparent"
            style={{ fontFamily: "Geist Mono, monospace", color: "#E4E4E7" }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={isLoading || !url}
          title="Send request (Ctrl+Enter)"
          className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
          style={{ height: 32, fontSize: 13, background: "#A855F7" }}>
          {isLoading ? <span className="animate-spin text-[14px]">⟳</span> : <Send size={13} />}
          Send
        </button>
        <div className="relative shrink-0">
          <button
            onClick={() => setShowSave(v => !v)}
            disabled={!url}
            title="Save to collection (Ctrl+S)"
            className="flex items-center justify-center rounded-md transition-colors hover:bg-[#1A1A1A] disabled:opacity-40"
            style={{ width: 32, height: 32, border: "1px solid #27272A" }}>
            <Bookmark size={14} className="text-[#71717A]" />
          </button>
          {showSave && <SavePopover onClose={() => setShowSave(false)} />}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center shrink-0 px-4" style={{ height: 38, borderBottom: "1px solid #27272A" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="relative px-3 h-full text-[12px] transition-colors flex items-center gap-1"
            style={{ color: tab === t ? "#FFFFFF" : "#71717A" }}>
            {t}
            {t === "Pre-req" && preRequestScript.trim() && (
              <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "#A855F7" }} />
            )}
            {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "#A855F7" }} />}
          </button>
        ))}
        {bodyType !== "none" && tab === "Body" && (
          <div className="ml-4 flex gap-1">
            {(["json", "form", "raw", "graphql"] as const).map(bt => (
              <button key={bt} onClick={() => setBodyType(bt)}
                className="px-2 py-0.5 rounded text-[11px] transition-colors"
                style={{
                  background: bodyType === bt ? "#1A1A1A" : "transparent",
                  color: bodyType === bt ? "#A855F7" : "#71717A",
                  border: bodyType === bt ? "1px solid #27272A" : "1px solid transparent",
                }}>
                {bt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden p-4">
        {tab === "Body" && (
          <div className="flex flex-col h-full gap-2">
            {bodyType === "none" ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-[#71717A]">Body type:</span>
                {(["none", "json", "form", "raw", "graphql"] as const).map(bt => (
                  <button key={bt} onClick={() => setBodyType(bt)}
                    className="px-3 py-1 rounded text-[12px] transition-colors"
                    style={{
                      background: bodyType === bt ? "#A855F720" : "#1A1A1A",
                      color: bodyType === bt ? "#A855F7" : "#71717A",
                      border: `1px solid ${bodyType === bt ? "#A855F750" : "#27272A"}`,
                    }}>
                    {bt}
                  </button>
                ))}
              </div>
            ) : bodyType === "form" ? (
              <KeyValueEditor label="Form" />
            ) : bodyType === "graphql" ? (
              <div className="flex flex-col h-full gap-2">
                <div className="flex flex-col gap-1 flex-[2] min-h-0">
                  <span className="text-[11px] text-[#71717A] shrink-0">Query</span>
                  <textarea
                    value={graphqlQuery}
                    onChange={e => setGraphqlQuery(e.target.value)}
                    spellCheck={false}
                    placeholder={"query {\n  users {\n    id\n    name\n  }\n}"}
                    className="flex-1 w-full p-3 rounded-lg text-[12px] resize-none"
                    style={{ background: "#0F0F0F", border: "1px solid #27272A", color: "#E4E4E7", fontFamily: "Geist Mono, monospace", lineHeight: 1.6 }}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-h-0">
                  <span className="text-[11px] shrink-0">
                    <span style={{ color: "#71717A" }}>Variables</span>
                    <span style={{ color: "#4A4A52" }}> (JSON)</span>
                  </span>
                  <textarea
                    value={graphqlVariables}
                    onChange={e => setGraphqlVariables(e.target.value)}
                    spellCheck={false}
                    placeholder={'{\n  "id": "123"\n}'}
                    className="flex-1 w-full p-3 rounded-lg text-[12px] resize-none"
                    style={{ background: "#0F0F0F", border: "1px solid #27272A", color: "#E4E4E7", fontFamily: "Geist Mono, monospace", lineHeight: 1.6 }}
                  />
                </div>
              </div>
            ) : (
              <textarea value={body} onChange={e => setBody(e.target.value)}
                placeholder={bodyType === "json" ? '{\n  "key": "value"\n}' : ""}
                className="flex-1 w-full p-3 rounded-lg text-[12px] resize-none"
                style={{ background: "#0F0F0F", border: "1px solid #27272A", color: "#E4E4E7", fontFamily: "Geist Mono, monospace", lineHeight: 1.6 }} />
            )}
          </div>
        )}
        {(tab === "Headers" || tab === "Params") && <KeyValueEditor label={tab} />}
        {tab === "Pre-req" && (
          <div className="flex flex-col h-full gap-2">
            <p className="text-[11px] text-[#71717A] shrink-0">
              Runs before each request. Use{" "}
              <span style={{ color: "#A855F7", fontFamily: "Geist Mono, monospace" }}>pm</span>{" "}
              to read/write environment variables and override headers.
            </p>
            <textarea
              value={preRequestScript}
              onChange={e => setPreRequestScript(e.target.value)}
              spellCheck={false}
              placeholder={"// pm.environment.set(\"token\", \"abc\");\n// pm.request.headers.upsert(\"Authorization\", \"Bearer \" + pm.environment.get(\"token\"));"}
              className="flex-1 w-full p-3 rounded-lg text-[12px] resize-none"
              style={{ background: "#0F0F0F", border: "1px solid #27272A", color: "#E4E4E7", fontFamily: "Geist Mono, monospace", lineHeight: 1.6 }}
            />
            <div className="shrink-0 flex flex-col gap-0.5" style={{ fontSize: 11, color: "#4A4A52" }}>
              <span><span style={{ color: "#A855F7" }}>pm.environment.get(key)</span> — read variable</span>
              <span><span style={{ color: "#A855F7" }}>pm.environment.set(key, value)</span> — write variable</span>
              <span><span style={{ color: "#A855F7" }}>pm.request.headers.upsert(key, value)</span> — add / override header</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
