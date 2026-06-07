import { Send, FolderOpen, Globe, FlaskConical, Clock, Settings, Columns2, Wifi, Radio, Gauge, Server, Network } from "lucide-react";

export type Route = "requests" | "collections" | "environments" | "tests" | "history" | "compare" | "websocket" | "sse" | "loadtest" | "mock" | "grpc" | "github" | "settings";

const NAV_ITEMS: { id: Route; icon: React.ElementType; label: string }[] = [
  { id: "requests",     icon: Send,         label: "Requests"     },
  { id: "collections",  icon: FolderOpen,   label: "Collections"  },
  { id: "environments", icon: Globe,        label: "Environments" },
  { id: "tests",        icon: FlaskConical, label: "Tests"        },
  { id: "history",      icon: Clock,        label: "History"      },
  { id: "compare",      icon: Columns2,     label: "Compare"      },
  { id: "websocket",    icon: Wifi,         label: "WebSocket"    },
  { id: "sse",          icon: Radio,        label: "SSE"          },
  { id: "loadtest",     icon: Gauge,        label: "Load Test"    },
  { id: "mock",         icon: Server,       label: "Mock Server"  },
  { id: "grpc",         icon: Network,      label: "gRPC"         },
];

interface NavRailProps {
  active: Route;
  onChange: (r: Route) => void;
}

export function NavRail({ active, onChange }: NavRailProps) {
  return (
    <nav
      data-tour="navrail"
      className="flex flex-col items-center shrink-0"
      style={{
        width: 56,
        background: "var(--color-sidebar)",
        borderRight: "1px solid var(--color-border)",
      }}>
      <div className="flex flex-col items-center gap-1 flex-1 pt-2 pb-2">
        {NAV_ITEMS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            title={id.charAt(0).toUpperCase() + id.slice(1)}
            onClick={() => onChange(id)}
            className="flex items-center justify-center transition-colors"
            style={{
              width: 40, height: 40, borderRadius: 8,
              background: active === id ? "var(--color-accent-20)" : "transparent",
              border: active === id ? "1px solid var(--color-accent-50)" : "1px solid transparent",
              color: active === id ? "var(--color-accent)" : "var(--color-fg-3)",
            }}>
            <Icon size={18} />
          </button>
        ))}
      </div>

      <div className="pb-3">
        <button
          title="Settings"
          onClick={() => onChange("settings")}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 40, height: 40, borderRadius: 8,
            background: active === "settings" ? "var(--color-accent-20)" : "transparent",
            border: active === "settings" ? "1px solid var(--color-accent-50)" : "1px solid transparent",
            color: active === "settings" ? "var(--color-accent)" : "var(--color-fg-3)",
          }}>
          <Settings size={18} />
        </button>
      </div>
    </nav>
  );
}
