import { useState, useEffect, useRef, useCallback } from "react";
import { resolveRequestUrl } from "@/lib/requestUrl";
import { Search, ArrowRight, Clock, Folder } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useRequestStore } from "@/stores/request";
import { getHistory } from "@/lib/tauri";
import type { HistoryEntry } from "@/lib/tauri";
import { methodColor, methodBg } from "@/lib/methods";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Result {
  id: string;
  kind: "collection" | "history";
  method: string;
  label: string;
  subtitle: string;
  url: string;
  collectionId?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { collections } = useCollectionsStore();
  const { setMethod, setUrl, setBody, setBodyType, setHeaders, reset: resetRequest } = useRequestStore();

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
      getHistory().then(setHistory).catch(() => {});
    }
  }, [open]);

  const collectionResults: Result[] = collections.flatMap(col =>
    col.requests.map(req => ({
      id: req.id,
      kind: "collection" as const,
      method: req.method,
      label: req.name,
      subtitle: col.name,
      url: resolveRequestUrl(col.baseUrl, req.path),
      collectionId: col.id,
      body: req.body,
      headers: req.headers,
    }))
  );

  const historyResults: Result[] = history.filter(h => h.method !== "gRPC").slice(0, 20).map(h => ({
    id: String(h.id),
    kind: "history" as const,
    method: h.method,
    label: h.url,
    subtitle: `${h.status} · ${h.durationMs}ms · ${new Date(h.timestamp).toLocaleTimeString()}`,
    url: h.url,
  }));

  const q = query.toLowerCase().trim();
  const allResults = q
    ? [...collectionResults, ...historyResults].filter(r =>
        r.label.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q)
      )
    : [...collectionResults, ...historyResults.slice(0, 8)];

  const loadResult = useCallback((r: Result) => {
    // Clear auth, scripts and extractors the result does not carry, so they
    // are not sent along to a different host.
    resetRequest();
    setMethod(r.method as any);
    setUrl(r.url);
    if (r.body) {
      setBody(r.body);
      setBodyType("json");
    } else {
      setBody("");
      setBodyType("none");
    }
    if (r.headers && Object.keys(r.headers).length > 0) {
      const entries = Object.entries(r.headers).map(([k, v], i) => ({
        id: `h-${i}`,
        key: k,
        value: v,
        enabled: true,
      }));
      setHeaders(entries);
    }
    onClose();
  }, [setMethod, setUrl, setBody, setBodyType, setHeaders, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, allResults.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === "Enter" && allResults[selected]) { e.preventDefault(); loadResult(allResults[selected]); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, allResults, selected, loadResult, onClose]);

  useEffect(() => { setSelected(0); }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="w-[580px] rounded-xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", maxHeight: "60vh" }}>

        {/* Search input */}
        <div className="flex items-center gap-3 px-4" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
          <Search size={16} style={{ color: "var(--color-fg-3)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search requests, endpoints..."
            className="flex-1 bg-transparent text-[14px]"
            style={{ color: "var(--color-fg)", fontFamily: "Inter, sans-serif" }}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "var(--color-fg-4)", border: "1px solid var(--color-border)", fontFamily: "Geist Mono, monospace" }}>ESC</kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {allResults.length === 0 && (
            <p className="text-[13px] text-center py-8" style={{ color: "var(--color-fg-3)" }}>
              No results for "{query}"
            </p>
          )}

          {!q && collectionResults.length > 0 && (
            <SectionLabel>Collections</SectionLabel>
          )}

          {(q ? allResults : collectionResults).map((r, i) => (
            <ResultRow
              key={r.id}
              result={r}
              active={selected === i}
              onHover={() => setSelected(i)}
              onClick={() => loadResult(r)}
            />
          ))}

          {!q && historyResults.length > 0 && (
            <>
              <SectionLabel>Recent history</SectionLabel>
              {historyResults.slice(0, 8).map((r, i) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  active={selected === collectionResults.length + i}
                  onHover={() => setSelected(collectionResults.length + i)}
                  onClick={() => loadResult(r)}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {allResults.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
              <kbd style={{ fontFamily: "Geist Mono, monospace" }}>↑↓</kbd> navegar
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
              <kbd style={{ fontFamily: "Geist Mono, monospace" }}>↵</kbd> cargar
            </span>
            <span className="flex-1" />
            <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>
              {allResults.length} resultado{allResults.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
      {children === "Collections" ? <Folder size={10} style={{ color: "var(--color-fg-4)" }} /> : <Clock size={10} style={{ color: "var(--color-fg-4)" }} />}
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-fg-4)" }}>{children}</span>
    </div>
  );
}

function ResultRow({ result: r, active, onHover, onClick }: {
  result: Result;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: "nearest" }); }, [active]);

  return (
    <button
      ref={ref}
      onMouseEnter={onHover}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
      style={{ background: active ? "var(--color-border)" : "transparent" }}>
      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold"
        style={{ color: methodColor(r.method as any), background: methodBg(r.method as any), fontFamily: "Geist Mono, monospace", minWidth: 44, textAlign: "center" }}>
        {r.method}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] truncate" style={{ color: "var(--color-fg)" }}>{r.label}</p>
        <p className="text-[11px] truncate" style={{ color: "var(--color-fg-3)" }}>{r.subtitle}</p>
      </div>
      {active && <ArrowRight size={14} style={{ color: "var(--color-fg-3)", flexShrink: 0 }} />}
    </button>
  );
}
