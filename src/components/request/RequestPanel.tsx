import { useState, useId } from "react";
import { Send, Plus, Trash2, ChevronDown } from "lucide-react";
import { useRequestStore } from "@/stores/request";
import { sendRequest } from "@/lib/tauri";
import { methodColor, methodBg } from "@/lib/methods";
import type { HttpMethod } from "@/lib/tauri";

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
  const { headers, setHeaders, params, setParams } = useRequestStore();
  const items = label === "Headers" ? headers : params;
  const setItems = label === "Headers" ? setHeaders : setParams;
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
        <Plus size={12} /> Add {label === "Headers" ? "header" : "parameter"}
      </button>
    </div>
  );
}

export function RequestPanel() {
  const { url, setUrl, body, setBody, bodyType, setBodyType, isLoading, setLoading, setResponse, setError, getRequest } = useRequestStore();
  const [tab, setTab] = useState<Tab>("Body");

  async function handleSend() {
    if (!url) return;
    setLoading(true); setError(null); setResponse(null);
    try {
      setResponse(await sendRequest(getRequest()));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

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
          className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
          style={{ height: 32, fontSize: 13, background: "#A855F7" }}>
          {isLoading ? <span className="animate-spin text-[14px]">⟳</span> : <Send size={13} />}
          Send
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center shrink-0 px-4" style={{ height: 38, borderBottom: "1px solid #27272A" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="relative px-3 h-full text-[12px] transition-colors"
            style={{ color: tab === t ? "#FFFFFF" : "#71717A" }}>
            {t}
            {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "#A855F7" }} />}
          </button>
        ))}
        {bodyType !== "none" && tab === "Body" && (
          <div className="ml-4 flex gap-1">
            {(["json", "form", "raw"] as const).map(bt => (
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
                {(["none", "json", "form", "raw"] as const).map(bt => (
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
          <div className="flex items-center justify-center h-full">
            <p className="text-[12px] text-[#71717A]">Pre-request scripts — coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}
