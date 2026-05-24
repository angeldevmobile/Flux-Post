import { Send, FolderOpen, Globe, FlaskConical, Clock, Settings, Columns2, Wifi } from "lucide-react";

export type Route = "requests" | "collections" | "environments" | "tests" | "history" | "compare" | "websocket" | "settings";

const NAV_ITEMS: { id: Route; icon: React.ElementType; label: string }[] = [
  { id: "requests",     icon: Send,        label: "Requests"     },
  { id: "collections",  icon: FolderOpen,  label: "Collections"  },
  { id: "environments", icon: Globe,       label: "Environments" },
  { id: "tests",        icon: FlaskConical,label: "Tests"        },
  { id: "history",      icon: Clock,       label: "History"      },
  { id: "compare",      icon: Columns2,    label: "Compare"      },
  { id: "websocket",    icon: Wifi,        label: "WebSocket"    },
];

interface NavRailProps {
  active: Route;
  onChange: (r: Route) => void;
}

export function NavRail({ active, onChange }: NavRailProps) {
  return (
    <nav
      className="flex flex-col items-center shrink-0"
      style={{ width: 56, background: "#0A0A0A", borderRight: "1px solid #27272A" }}>
      <div className="flex flex-col items-center gap-1 flex-1 pt-2 pb-2">
        {NAV_ITEMS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            title={id.charAt(0).toUpperCase() + id.slice(1)}
            onClick={() => onChange(id)}
            className="flex items-center justify-center transition-colors"
            style={{
              width: 40, height: 40, borderRadius: 8,
              background: active === id ? "#A855F722" : "transparent",
              border: active === id ? "1px solid #A855F750" : "1px solid transparent",
              color: active === id ? "#A855F7" : "#71717A",
            }}>
            <Icon size={18} />
          </button>
        ))}
      </div>

      {/* Settings at bottom */}
      <div className="pb-3">
        <button
          title="Settings"
          onClick={() => onChange("settings")}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 40, height: 40, borderRadius: 8,
            background: active === "settings" ? "#A855F722" : "transparent",
            border: active === "settings" ? "1px solid #A855F750" : "1px solid transparent",
            color: active === "settings" ? "#A855F7" : "#71717A",
          }}>
          <Settings size={18} />
        </button>
      </div>
    </nav>
  );
}
