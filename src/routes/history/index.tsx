import { useState, useEffect } from "react";
import { Search, RotateCcw, Download, Clock } from "lucide-react";
import { getHistory, clearHistory, exportDataAsJson, type HistoryEntry } from "@/lib/tauri";
import { useRequestStore } from "@/stores/request";
import { methodColor, methodBg } from "@/lib/methods";
import { exportPostman } from "@/lib/exporters";
import type { HttpMethod } from "@/lib/tauri";

const STATUS_COLOR = (s: number) =>
  s >= 200 && s < 300 ? "#22C55E" : s >= 400 ? "#EF4444" : "#F59E0B";

const ENV_PALETTE = [
  "#22C55E", "#3B82F6", "#F59E0B", "#A855F7",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1",
];

function envColor(name: string): string {
  if (!name) return "#71717A";
  const n = name.toLowerCase();
  if (n.includes("prod")) return "#EF4444";
  if (n.includes("stag")) return "#F59E0B";
  if (n.includes("dev"))  return "#22C55E";
  if (n.includes("local")) return "#3B82F6";
  // deterministic color from name hash
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ENV_PALETTE[hash % ENV_PALETTE.length];
}

function EnvBadge({ name }: { name: string }) {
  const color = envColor(name);
  const label = name || "No env";
  return (
    <div className="flex items-center gap-1.5 px-2 rounded shrink-0"
      style={{ height: 22, background: `${color}15`, border: `1px solid ${color}40` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span className="text-[10px] font-medium truncate" style={{ color, maxWidth: 80 }}>{label}</span>
    </div>
  );
}

function MethodPill({ method }: { method: string }) {
  return (
    <span className="inline-flex items-center justify-center shrink-0 font-bold"
      style={{
        width: 46, height: 20, borderRadius: 3, fontSize: 10,
        fontFamily: "Geist Mono, monospace",
        color: methodColor(method), background: methodBg(method),
      }}>
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: number }) {
  const c = STATUS_COLOR(status);
  return (
    <span className="inline-flex items-center justify-center font-semibold"
      style={{
        height: 22, padding: "0 8px", borderRadius: 4, fontSize: 11,
        fontFamily: "Geist Mono, monospace", color: c, background: `${c}18`,
      }}>
      {status}
    </span>
  );
}

export function HistoryRoute() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const { setMethod, setUrl } = useRequestStore();

  useEffect(() => {
    getHistory()
      .then(h => setEntries(h))
      .catch(() => setEntries([]));
  }, []);

  async function handleClear() { await clearHistory(); setEntries([]); }

  function handleExport() {
    const col = {
      id: `history-${Date.now()}`,
      name: "History Export",
      requests: filtered.map((e, i) => ({
        id: `hist-${i}`,
        name: e.url,
        method: e.method as HttpMethod,
        path: e.url,
        headers: {},
        tests: [],
      })),
      folders: [],
      expanded: true,
    };
    exportDataAsJson(JSON.parse(exportPostman(col)), "history-export.postman_collection.json");
  }

  function handleReplay(e: HistoryEntry) {
    setMethod(e.method as HttpMethod);
    setUrl(e.url);
  }

  const filtered = entries.filter(e =>
    !search || e.url.toLowerCase().includes(search.toLowerCase()) || e.method.includes(search.toUpperCase())
  );

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <h2 className="flex-1 text-[16px] font-semibold" style={{ fontFamily: "Geist, Inter, sans-serif", color: "var(--color-fg)" }}>
          Request History
        </h2>
        <div className="flex items-center gap-2 rounded-md px-3"
          style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)", width: 260 }}>
          <Search size={13} className="shrink-0" style={{ color: "var(--color-fg-4)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search history..."
            className="flex-1 text-[12px] bg-transparent"
            style={{ color: "var(--color-fg-2)" }} />
        </div>
        <button onClick={handleExport} disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-medium transition-colors hover:opacity-80 disabled:opacity-40"
          style={{ height: 32, color: "var(--color-fg-2)", background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
          <Download size={13} /> Export collection
        </button>
        <button onClick={handleClear}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-medium transition-colors hover:opacity-80"
          style={{ height: 32, color: "var(--color-fg-3)", background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
          Clear History
        </button>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-0.5">
        {filtered.map((entry, i) => {
          const isAlt = i % 2 === 0;
          return (
            <div key={entry.id}
              onClick={() => handleReplay(entry)}
              className="flex items-center gap-3 px-4 rounded-md cursor-pointer transition-opacity hover:opacity-80 group"
              style={{ height: 48, background: isAlt ? "var(--color-elevated)" : "transparent", border: "1px solid var(--color-card)" }}>
              <MethodPill method={entry.method} />
              <span className="flex-1 truncate text-[12px]"
                style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-2)" }}>
                {entry.url}
              </span>
              <StatusBadge status={entry.status} />
              <span className="text-[11px] shrink-0"
                style={{ fontFamily: "Geist Mono, monospace", color: "var(--color-fg-4)", width: 50 }}>
                {entry.durationMs}ms
              </span>
              <EnvBadge name={entry.environment} />
              <span className="text-[11px] shrink-0" style={{ color: "var(--color-fg-4)", width: 80 }}>
                {entry.timestamp}
              </span>
              <button className="flex items-center justify-center rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: 28, height: 28 }}>
                <RotateCcw size={14} style={{ color: "var(--color-fg-4)" }} />
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 h-full gap-3">
            <div className="flex items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
              <Clock size={20} style={{ color: "var(--color-fg-4)" }} />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-[14px] font-medium" style={{ color: "var(--color-fg-3)" }}>
                {search ? "No matching requests" : "No history yet"}
              </p>
              <p className="text-[12px]" style={{ color: "var(--color-fg-4)" }}>
                {search ? "Try a different search term." : "Requests you send will appear here."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
