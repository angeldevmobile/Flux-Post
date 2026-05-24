import { useState, useEffect } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useCollectionsStore } from "@/stores/collections";
import { useRequestStore } from "@/stores/request";
import { methodColor, methodBg } from "@/lib/methods";
import type { HttpMethod } from "@/lib/tauri";

// Demo data loaded once on mount
const DEMO_COLLECTIONS = [
  {
    id: "auth", name: "Auth", color: "#F59E0B", expanded: true,
    requests: [
      { id: "a1", name: "Login",   method: "POST" as HttpMethod, path: "/auth/login"   },
      { id: "a2", name: "Logout",  method: "POST" as HttpMethod, path: "/auth/logout"  },
      { id: "a3", name: "Refresh", method: "POST" as HttpMethod, path: "/auth/refresh" },
    ],
  },
  {
    id: "users", name: "Users", color: "#3B82F6", expanded: true,
    requests: [
      { id: "u1", name: "List users",   method: "GET"    as HttpMethod, path: "/users"      },
      { id: "u2", name: "Get user",     method: "GET"    as HttpMethod, path: "/users/:id"  },
      { id: "u3", name: "Create user",  method: "POST"   as HttpMethod, path: "/users"      },
      { id: "u4", name: "Delete user",  method: "DELETE" as HttpMethod, path: "/users/:id"  },
    ],
  },
  {
    id: "products", name: "Products", color: "#22C55E", expanded: true,
    requests: [
      { id: "p1", name: "List products",   method: "GET"  as HttpMethod, path: "/products" },
      { id: "p2", name: "Create product",  method: "POST" as HttpMethod, path: "/products" },
    ],
  },
];

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

export function CollectionsSidebar() {
  const { collections, activeRequestId, setActiveRequest, toggleCollection, loadCollection } = useCollectionsStore();
  const { setMethod, setUrl } = useRequestStore();
  const [search, setSearch] = useState("");

  useEffect(() => {
    DEMO_COLLECTIONS.forEach(c => loadCollection(c));
  }, []);

  function handleSelect(method: HttpMethod, path: string, id: string) {
    setActiveRequest(id);
    setMethod(method);
    setUrl(path);
  }

  const filtered = collections.map(c => ({
    ...c,
    requests: c.requests.filter(r =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.path.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(c => !search || c.requests.length > 0 || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="flex flex-col shrink-0 h-full" style={{ width: 260, background: "#0F0F0F", borderRight: "1px solid #27272A" }}>
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0 px-3" style={{ height: 44, borderBottom: "1px solid #27272A" }}>
        <span className="flex-1 text-[12px] font-medium text-[#A1A1AA]">Collections</span>
        <button className="flex items-center justify-center rounded"
          style={{ width: 24, height: 24, background: "#1A1A1A" }} title="New collection">
          <Plus size={14} className="text-[#71717A]" />
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 shrink-0 px-3" style={{ height: 36, borderBottom: "1px solid #27272A" }}>
        <Search size={13} className="text-[#71717A] shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search endpoints..."
          className="flex-1 text-[12px] bg-transparent"
          style={{ color: "#3F3F46" }}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {filtered.map(col => {
          const colColor = (col as typeof DEMO_COLLECTIONS[0]).color ?? "#71717A";
          return (
            <div key={col.id}>
              {/* Collection header */}
              <button
                onClick={() => toggleCollection(col.id)}
                className="flex items-center gap-1.5 w-full px-3 hover:bg-[#1A1A1A] transition-colors"
                style={{ height: 30 }}>
                <ChevronRight
                  size={12} className="text-[#71717A] shrink-0 transition-transform"
                  style={{ transform: col.expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                />
                <span style={{ width: 6, height: 6, borderRadius: 3, background: colColor, flexShrink: 0 }} />
                <span className="text-[12px] font-medium" style={{ color: "#E4E4E7" }}>{col.name}</span>
              </button>

              {/* Requests */}
              {col.expanded && col.requests.map(req => (
                <button
                  key={req.id}
                  onClick={() => handleSelect(req.method, req.path, req.id)}
                  className="flex items-center gap-2 w-full transition-colors hover:bg-[#1A1A1A]"
                  style={{
                    height: 28, paddingLeft: 28, paddingRight: 12,
                    background: activeRequestId === req.id ? "#1A1A2E" : "transparent",
                    borderLeft: activeRequestId === req.id ? "2px solid #A855F7" : "2px solid transparent",
                  }}>
                  <MethodPill method={req.method} />
                  <span
                    className="text-[11px] truncate"
                    style={{ fontFamily: "Geist Mono, monospace", color: activeRequestId === req.id ? "#E4E4E7" : "#71717A" }}>
                    {req.path}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
