import { useState } from "react";
import { Send, ChevronDown } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment";
import { useRequestStore } from "@/stores/request";
import { useSettingsStore } from "@/stores/settings";
import { sendRequest } from "@/lib/tauri";
import { methodColor, methodBg } from "@/lib/methods";
import type { HttpMethod } from "@/lib/tauri";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface CompareResult {
  status: number;
  durationMs: number;
  body: string;
  error?: string;
}

function resolveForEnv(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "#22C55E";
  if (status >= 300 && status < 400) return "#F59E0B";
  return "#EF4444";
}

function prettyBody(body: string): string {
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

export function CompareRoute() {
  const { environments } = useEnvironmentStore();
  const { method: storeMethod, url: storeUrl, headers, params, body, bodyType } = useRequestStore();

  const [method, setMethod] = useState<HttpMethod>(storeMethod);
  const [url, setUrl] = useState(storeUrl);
  const [methodOpen, setMethodOpen] = useState(false);
  const [selectedEnvIds, setSelectedEnvIds] = useState<string[]>(
    environments.filter(e => e.id !== "default").slice(0, 2).map(e => e.id)
  );
  const [results, setResults] = useState<Record<string, CompareResult>>({});
  const [isRunning, setIsRunning] = useState(false);

  function toggleEnv(id: string) {
    setSelectedEnvIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function handleRun() {
    if (!url.trim() || selectedEnvIds.length === 0 || isRunning) return;
    setIsRunning(true);
    setResults({});

    const enabledHeaders: Record<string, string> = {};
    for (const h of headers) {
      if (h.enabled && h.key) enabledHeaders[h.key] = h.value;
    }
    const enabledParams = params.filter(p => p.enabled && p.key);

    const runs = selectedEnvIds.map(async (envId) => {
      const vars = environments.find(e => e.id === envId)?.variables ?? {};
      const resolve = (v: string) => resolveForEnv(v, vars);

      let resolvedUrl = resolve(url);
      if (enabledParams.length > 0) {
        const qs = enabledParams
          .map(p => `${encodeURIComponent(resolve(p.key))}=${encodeURIComponent(resolve(p.value))}`)
          .join("&");
        resolvedUrl = resolvedUrl.includes("?") ? `${resolvedUrl}&${qs}` : `${resolvedUrl}?${qs}`;
      }

      try {
        const { timeoutMs, followRedirects, sslVerify } = useSettingsStore.getState();
        const resp = await sendRequest({
          method,
          url: resolvedUrl,
          headers: Object.fromEntries(Object.entries(enabledHeaders).map(([k, v]) => [k, resolve(v)])),
          body: bodyType !== "none" ? resolve(body) : undefined,
          timeoutMs, followRedirects, sslVerify,
        });
        return [envId, { status: resp.status, durationMs: resp.durationMs, body: resp.body }] as const;
      } catch (e) {
        return [envId, { status: 0, durationMs: 0, body: "", error: String(e) }] as const;
      }
    });

    const settled = await Promise.all(runs);
    setResults(Object.fromEntries(settled));
    setIsRunning(false);
  }

  const selectedEnvs = environments.filter(e => selectedEnvIds.includes(e.id));
  const canRun = !!url.trim() && selectedEnvIds.length >= 1 && !isRunning;

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "var(--color-bg)" }}>

      {/* URL bar */}
      <div className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <div className="relative shrink-0">
          <button
            onClick={() => setMethodOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 rounded-md font-bold"
            style={{ height: 32, fontSize: 12, fontFamily: "Geist Mono, monospace", color: methodColor(method), background: methodBg(method), border: `1px solid ${methodColor(method)}40` }}>
            {method} <ChevronDown size={12} />
          </button>
          {methodOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden py-1"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 120 }}>
              {METHODS.map(m => (
                <button key={m} onClick={() => { setMethod(m); setMethodOpen(false); }}
                  className="flex w-full px-3 py-1.5 transition-colors"
                  style={{ fontSize: 12, fontFamily: "Geist Mono, monospace", fontWeight: 700, color: methodColor(m) }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--color-border)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 flex items-center px-3 rounded-md" style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleRun()}
            placeholder="https://api.{{BASE_URL}}/endpoint"
            className="flex-1 text-[12px] bg-transparent"
            style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg)" }}
          />
        </div>

        <button
          onClick={handleRun}
          disabled={!canRun}
          className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white shrink-0 transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}>
          {isRunning ? <span className="animate-spin text-[14px]">⟳</span> : <Send size={13} />}
          Compare
        </button>
      </div>

      {/* Environment selector */}
      <div className="flex items-center gap-2 shrink-0 px-4 flex-wrap"
        style={{ minHeight: 42, borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-[11px] shrink-0" style={{ color: "var(--color-fg-3)" }}>Compare across:</span>
        {environments.map(env => {
          const selected = selectedEnvIds.includes(env.id);
          return (
            <button key={env.id} onClick={() => toggleEnv(env.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
              style={{
                background: selected ? "var(--color-accent-10)" : "var(--color-card)",
                border: `1px solid ${selected ? "var(--color-accent-50)" : "var(--color-border)"}`,
                color: selected ? "var(--color-accent)" : "var(--color-fg-3)",
              }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: selected ? "var(--color-accent)" : "var(--color-fg-4)" }} />
              {env.name}
            </button>
          );
        })}
        {selectedEnvIds.length === 0 && (
          <span className="text-[11px] text-red">Select at least one environment</span>
        )}
      </div>

      {/* Results grid */}
      <div className="flex flex-1 overflow-hidden">
        {selectedEnvs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[13px]" style={{ color: "var(--color-fg-4)" }}>
              Select environments above and click Compare
            </p>
          </div>
        ) : (
          selectedEnvs.map((env, i) => {
            const result = results[env.id];
            return (
              <div key={env.id} className="flex flex-col flex-1 overflow-hidden min-w-0"
                style={{ borderRight: i < selectedEnvs.length - 1 ? "1px solid var(--color-border)" : "none" }}>

                {/* Column header */}
                <div className="flex items-center gap-2 shrink-0 px-4"
                  style={{ height: 38, borderBottom: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
                  <span className="text-[12px] font-medium truncate" style={{ color: "var(--color-fg)" }}>
                    {env.name}
                  </span>
                  {result && !result.error && (
                    <div className="flex items-center gap-2 ml-auto shrink-0">
                      <span className="text-[11px] font-bold" style={{ color: statusColor(result.status) }}>
                        {result.status}
                      </span>
                      <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>{result.durationMs}ms</span>
                    </div>
                  )}
                  {result?.error && (
                    <span className="text-[11px] ml-auto text-red">Error</span>
                  )}
                  {isRunning && !result && (
                    <span className="text-[11px] ml-auto animate-pulse" style={{ color: "var(--color-fg-3)" }}>Running…</span>
                  )}
                </div>

                {/* Column body */}
                <div className="flex-1 overflow-auto p-4">
                  {!result && !isRunning && (
                    <p className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>Hit Compare to run</p>
                  )}
                  {result?.error && (
                    <p className="text-[12px] text-red">{result.error}</p>
                  )}
                  {result && !result.error && (
                    <pre className="text-[12px] whitespace-pre-wrap break-all"
                      style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)", lineHeight: 1.6 }}>
                      {prettyBody(result.body)}
                    </pre>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
