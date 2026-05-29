import { useState, useEffect, useCallback } from "react";
import { Server, Plus, Trash2, Play, Square, Sparkles, Copy, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  startMockServer, stopMockServer,
  setMockEndpoints, getMockEndpoints, getMockStatus,
  editContent,
} from "@/lib/tauri";
import type { MockEndpoint, MockStatus } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "*"];
const CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "text/html",
  "application/xml",
  "text/csv",
];
const STATUS_OPTIONS = [200, 201, 204, 400, 401, 403, 404, 409, 422, 500, 502, 503];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function defaultEndpoint(): MockEndpoint {
  return {
    id: uid(),
    method: "GET",
    path: "/api/example",
    status: 200,
    body: '{\n  "message": "Hello from Flux mock!"\n}',
    contentType: "application/json",
    delayMs: 0,
    enabled: true,
  };
}

export function MockRoute() {
  const { claudeApiKey, claudeModel } = useSettingsStore();
  const [endpoints, setEndpoints] = useState<MockEndpoint[]>([defaultEndpoint()]);
  const [status, setStatus] = useState<MockStatus>({ running: false, port: 3001, endpointCount: 0 });
  const [port, setPort] = useState(3001);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getMockStatus();
      setStatus(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshStatus();
    getMockEndpoints().then(eps => { if (eps.length > 0) setEndpoints(eps); }).catch(() => {});
  }, [refreshStatus]);

  async function handleStart() {
    try {
      await setMockEndpoints(endpoints);
      await startMockServer(port);
      await refreshStatus();
      toast.success(`Mock server started on port ${port}`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function handleStop() {
    try {
      await stopMockServer();
      await refreshStatus();
      toast.success("Mock server stopped");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function pushEndpoints(eps: MockEndpoint[]) {
    setEndpoints(eps);
    if (status.running) {
      await setMockEndpoints(eps).catch(() => {});
    }
  }

  function updateEndpoint(id: string, patch: Partial<MockEndpoint>) {
    const updated = endpoints.map(e => e.id === id ? { ...e, ...patch } : e);
    pushEndpoints(updated);
  }

  function removeEndpoint(id: string) {
    pushEndpoints(endpoints.filter(e => e.id !== id));
  }

  function addEndpoint() {
    pushEndpoints([...endpoints, defaultEndpoint()]);
  }

  async function generateBody(ep: MockEndpoint) {
    if (!claudeApiKey) { toast.error("Add your Claude API key in Settings → AI & Claude"); return; }
    setAiLoading(prev => ({ ...prev, [ep.id]: true }));
    try {
      const prompt = `Generate a realistic JSON response body for a ${ep.method} ${ep.path} endpoint that returns status ${ep.status}. Return only the JSON object, no explanation.`;
      const body = await editContent("", prompt, "json", claudeApiKey, claudeModel);
      updateEndpoint(ep.id, { body });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAiLoading(prev => ({ ...prev, [ep.id]: false }));
    }
  }

  function copyBaseUrl() {
    navigator.clipboard.writeText(`http://localhost:${port}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <Server size={16} style={{ color: "var(--color-accent)" }} />
        <span className="text-[14px] font-semibold" style={{ color: "var(--color-fg)" }}>Mock Server</span>
        <span className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>Spin up a localhost server — 100% offline, zero latency</span>

        {status.running && (
          <div className="ml-auto flex items-center gap-2 px-3 rounded-full"
            style={{ height: 26, background: "#22C55E18", border: "1px solid #22C55E30" }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "#22C55E", display: "inline-block" }} />
            <span className="text-[11px] font-semibold" style={{ color: "#22C55E", fontFamily: "Geist Mono, monospace" }}>
              Running on :{status.port}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 p-6 max-w-4xl w-full">
        {/* Server controls */}
        <div className="flex items-end gap-3 rounded-lg p-4" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
          <div className="flex flex-col gap-1">
            <label className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>Port</label>
            <input
              type="number"
              value={port}
              min={1024}
              max={65535}
              disabled={status.running}
              onChange={e => setPort(Number(e.target.value))}
              className="rounded px-2 text-[12px]"
              style={{ height: 32, width: 90, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg)", fontFamily: "Geist Mono, monospace" }}
            />
          </div>

          {status.running ? (
            <button onClick={handleStop}
              className="flex items-center gap-2 rounded-md font-semibold transition-opacity hover:opacity-80"
              style={{ height: 34, background: "#EF444420", border: "1px solid #EF444440", color: "#EF4444", fontSize: 12, padding: "0 16px" }}>
              <Square size={12} /> Stop Server
            </button>
          ) : (
            <button onClick={handleStart}
              className="flex items-center gap-2 rounded-md font-semibold text-white transition-opacity hover:opacity-90"
              style={{ height: 34, background: "var(--color-accent)", fontSize: 12, padding: "0 16px" }}>
              <Play size={12} /> Start Server
            </button>
          )}

          {status.running && (
            <button onClick={copyBaseUrl}
              className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80"
              style={{ height: 34, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)", fontSize: 12, padding: "0 12px", fontFamily: "Geist Mono, monospace" }}>
              {copied ? <Check size={12} style={{ color: "#22C55E" }} /> : <Copy size={12} />}
              http://localhost:{port}
            </button>
          )}
        </div>

        {!claudeApiKey && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5" style={{ background: "#F59E0B10", border: "1px solid #F59E0B30" }}>
            <AlertCircle size={13} style={{ color: "#F59E0B", marginTop: 1, flexShrink: 0 }} />
            <span className="text-[12px]" style={{ color: "#F59E0B" }}>
              Add your Claude API key in Settings → AI &amp; Claude to enable AI-generated response bodies.
            </span>
          </div>
        )}

        {/* Endpoints table */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-3)" }}>
              Endpoints ({endpoints.length})
            </span>
            <button onClick={addEndpoint}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              style={{ height: 28, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontSize: 12, padding: "0 10px" }}>
              <Plus size={12} /> Add endpoint
            </button>
          </div>

          {endpoints.map(ep => (
            <div key={ep.id} className="flex flex-col gap-2 rounded-lg p-3"
              style={{ background: "var(--color-card)", border: `1px solid ${ep.enabled ? "var(--color-border)" : "var(--color-border)"}`, opacity: ep.enabled ? 1 : 0.5 }}>
              {/* Row 1: method, path, status, delay, enabled, delete */}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={ep.method}
                  onChange={e => updateEndpoint(ep.id, { method: e.target.value })}
                  className="rounded px-1.5 text-[11px] font-semibold shrink-0"
                  style={{ height: 28, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-accent)", fontFamily: "Geist Mono, monospace", width: 70 }}>
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                <input
                  value={ep.path}
                  onChange={e => updateEndpoint(ep.id, { path: e.target.value })}
                  placeholder="/api/path"
                  className="flex-1 rounded px-2 text-[12px]"
                  style={{ height: 28, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg)", fontFamily: "Geist Mono, monospace", minWidth: 120 }}
                />

                <select
                  value={ep.status}
                  onChange={e => updateEndpoint(ep.id, { status: Number(e.target.value) })}
                  className="rounded px-1.5 text-[11px] shrink-0"
                  style={{ height: 28, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace", width: 60 }}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>delay</span>
                  <input
                    type="number"
                    value={ep.delayMs}
                    min={0}
                    max={30000}
                    onChange={e => updateEndpoint(ep.id, { delayMs: Number(e.target.value) })}
                    className="rounded px-1.5 text-[11px]"
                    style={{ height: 28, width: 58, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg-2)", fontFamily: "Geist Mono, monospace" }}
                  />
                  <span className="text-[10px]" style={{ color: "var(--color-fg-4)" }}>ms</span>
                </div>

                <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                  <input type="checkbox" checked={ep.enabled} onChange={e => updateEndpoint(ep.id, { enabled: e.target.checked })} />
                  <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>enabled</span>
                </label>

                {claudeApiKey && (
                  <button onClick={() => generateBody(ep)}
                    disabled={aiLoading[ep.id]}
                    className="flex items-center gap-1 rounded shrink-0 transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ height: 26, background: "#A855F715", border: "1px solid #A855F730", padding: "0 8px" }}
                    title="AI-generate response body">
                    <Sparkles size={10} style={{ color: "var(--color-accent)" }} />
                    <span className="text-[10px]" style={{ color: "var(--color-accent)" }}>
                      {aiLoading[ep.id] ? "Generating…" : "AI"}
                    </span>
                  </button>
                )}

                <button onClick={() => removeEndpoint(ep.id)}
                  className="ml-auto flex items-center justify-center rounded transition-colors shrink-0"
                  style={{ width: 26, height: 26, color: "var(--color-fg-4)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#EF4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--color-fg-4)")}>
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Row 2: content-type + body */}
              <div className="flex gap-2 items-start">
                <select
                  value={ep.contentType}
                  onChange={e => updateEndpoint(ep.id, { contentType: e.target.value })}
                  className="rounded px-1.5 text-[10px] shrink-0"
                  style={{ height: 24, background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg-3)", fontFamily: "Geist Mono, monospace", width: 160, marginTop: 2 }}>
                  {CONTENT_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                </select>

                <textarea
                  value={ep.body}
                  onChange={e => updateEndpoint(ep.id, { body: e.target.value })}
                  rows={4}
                  className="flex-1 rounded px-2 py-1.5 text-[11px] resize-y"
                  style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-fg)", fontFamily: "Geist Mono, monospace", minHeight: 72 }}
                />
              </div>
            </div>
          ))}
        </div>

        {endpoints.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8">
            <span className="text-[13px]" style={{ color: "var(--color-fg-3)" }}>No endpoints yet.</span>
            <button onClick={addEndpoint}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              style={{ height: 32, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-accent)", fontSize: 12, padding: "0 14px" }}>
              <Plus size={12} /> Add your first endpoint
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
