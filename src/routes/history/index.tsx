import { useState, useEffect } from "react";
import { Search, RotateCcw } from "lucide-react";
import { getHistory, clearHistory, type HistoryEntry } from "@/lib/tauri";
import { useRequestStore } from "@/stores/request";
import { methodColor, methodBg } from "@/lib/methods";
import type { HttpMethod } from "@/lib/tauri";

// Demo entries shown when history is empty
const DEMO: HistoryEntry[] = [
  { id: 1,  method: "POST",   url: "/auth/login",                    status: 200, durationMs: 124,  timestamp: "2 min ago"   },
  { id: 2,  method: "GET",    url: "/users?page=1&limit=20",         status: 200, durationMs: 89,   timestamp: "5 min ago"   },
  { id: 3,  method: "DELETE", url: "/users/usr_x9k2m",              status: 204, durationMs: 67,   timestamp: "12 min ago"  },
  { id: 4,  method: "POST",   url: "/products",                      status: 422, durationMs: 201,  timestamp: "18 min ago"  },
  { id: 5,  method: "GET",    url: "/products?category=electronics", status: 200, durationMs: 156,  timestamp: "24 min ago"  },
  { id: 6,  method: "PUT",    url: "/users/usr_abc123",              status: 200, durationMs: 178,  timestamp: "31 min ago"  },
  { id: 7,  method: "GET",    url: "/auth/me",                       status: 401, durationMs: 45,   timestamp: "45 min ago"  },
  { id: 8,  method: "POST",   url: "/webhooks/test",                 status: 200, durationMs: 312,  timestamp: "1 hour ago"  },
];

const ENV_COLORS: Record<number, { color: string; name: string }> = {
  1: { color: "#22C55E", name: "Development" },
  2: { color: "#22C55E", name: "Development" },
  3: { color: "#F59E0B", name: "Staging"     },
  4: { color: "#22C55E", name: "Development" },
  5: { color: "#22C55E", name: "Development" },
  6: { color: "#F59E0B", name: "Staging"     },
  7: { color: "#EF4444", name: "Production"  },
  8: { color: "#3B82F6", name: "Local"       },
};

const STATUS_COLOR = (s: number) =>
  s >= 200 && s < 300 ? "#22C55E" : s >= 400 ? "#EF4444" : "#F59E0B";

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
      .then(h => setEntries(h.length ? h : DEMO))
      .catch(() => setEntries(DEMO));
  }, []);

  async function handleClear() { await clearHistory(); setEntries([]); }

  function handleReplay(e: HistoryEntry) {
    setMethod(e.method as HttpMethod);
    setUrl(e.url);
  }

  const filtered = entries.filter(e =>
    !search || e.url.toLowerCase().includes(search.toLowerCase()) || e.method.includes(search.toUpperCase())
  );

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden" style={{ background: "#0A0A0A" }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 px-6" style={{ height: 52, borderBottom: "1px solid #27272A" }}>
        <h2 className="flex-1 text-[16px] font-semibold text-white" style={{ fontFamily: "Geist, Inter, sans-serif" }}>
          Request History
        </h2>
        <div className="flex items-center gap-2 rounded-md px-3"
          style={{ height: 32, background: "#141414", border: "1px solid #27272A", width: 260 }}>
          <Search size={13} className="text-[#52525B] shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search history..."
            className="flex-1 text-[12px] bg-transparent"
            style={{ color: "#A1A1AA" }} />
        </div>
        <button onClick={handleClear}
          className="flex items-center gap-1.5 px-3 rounded-md text-[12px] font-medium transition-colors hover:opacity-80"
          style={{ height: 32, color: "#71717A", background: "#1A1A1A", border: "1px solid #27272A" }}>
          Clear History
        </button>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-0.5">
        {filtered.map((entry, i) => {
          const env = ENV_COLORS[entry.id] ?? { color: "#71717A", name: "Unknown" };
          const isAlt = i % 2 === 0;
          return (
            <div key={entry.id}
              onClick={() => handleReplay(entry)}
              className="flex items-center gap-3 px-4 rounded-md cursor-pointer transition-opacity hover:opacity-80 group"
              style={{ height: 48, background: isAlt ? "#0D0D0D" : "transparent", border: "1px solid #1A1A1A" }}>
              <MethodPill method={entry.method} />
              <span className="flex-1 truncate text-[12px] text-[#A1A1AA]"
                style={{ fontFamily: "Geist Mono, monospace" }}>
                {entry.url}
              </span>
              <StatusBadge status={entry.status} />
              <span className="text-[11px] text-[#52525B] shrink-0"
                style={{ fontFamily: "Geist Mono, monospace", width: 50 }}>
                {entry.durationMs}ms
              </span>
              {/* Env badge */}
              <div className="flex items-center gap-1 px-2 rounded shrink-0"
                style={{ height: 20, background: "#1A1A1A" }}>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: env.color }} />
                <span className="text-[10px] text-[#71717A]">{env.name}</span>
              </div>
              <span className="text-[11px] text-[#3F3F46] shrink-0" style={{ width: 80 }}>
                {entry.timestamp}
              </span>
              <button className="flex items-center justify-center rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: 28, height: 28 }}>
                <RotateCcw size={14} className="text-[#3F3F46]" />
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex items-center justify-center flex-1 h-full">
            <p className="text-[13px] text-[#71717A]">No history</p>
          </div>
        )}
      </div>
    </div>
  );
}
