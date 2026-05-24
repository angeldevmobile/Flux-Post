import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Bell, Settings, Check, Plus } from "lucide-react";
import { FluxLogoMark } from "@/components/FluxLogo";
import { useEnvironmentStore } from "@/stores/environment";
import type { Route } from "@/components/NavRail";

interface TopBarProps {
  onNavigate: (r: Route) => void;
}

export function TopBar({ onNavigate }: TopBarProps) {
  const { environments, activeId, setActive, addEnvironment } = useEnvironmentStore();
  const active = environments.find(e => e.id === activeId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function createNew() {
    const id = `env-${Date.now()}`;
    addEnvironment({ id, name: "New Environment", variables: {} });
    setActive(id);
    setOpen(false);
    onNavigate("environments");
  }

  return (
    <header className="flex items-center shrink-0 gap-3"
      style={{ height: 48, padding: "0 16px", background: "#111111", borderBottom: "1px solid #27272A" }}>

      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center justify-center rounded-lg"
          style={{ width: 26, height: 26, background: "linear-gradient(135deg, #A855F730, #7C3AED18)", border: "1px solid #A855F750" }}>
          <FluxLogoMark size={14} />
        </div>
        <span className="text-[15px] font-semibold text-white"
          style={{ fontFamily: "Geist, Inter, sans-serif", letterSpacing: "-0.3px" }}>
          Flux
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: "#27272A" }} />

      {/* Env selector */}
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
          style={{ background: "#1A1A1A", border: "1px solid #27272A", borderRadius: 6, height: 28, padding: "0 10px" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: active ? "#22C55E" : "#71717A", flexShrink: 0 }} />
          <span className="text-[12px] text-[#A1A1AA]">{active?.name ?? "No environment"}</span>
          <ChevronDown size={12} className="text-[#71717A]"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden py-1"
            style={{ background: "#1A1A1A", border: "1px solid #27272A", minWidth: 200, boxShadow: "0 8px 24px #00000060" }}>
            {environments.length === 0 && (
              <p className="text-[12px] text-[#52525B] px-3 py-2">No environments</p>
            )}
            {environments.map(env => (
              <button key={env.id}
                onClick={() => { setActive(env.id); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-[#27272A] transition-colors text-left">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", flexShrink: 0 }} />
                <span className="flex-1 text-[13px] text-[#A1A1AA]">{env.name}</span>
                {env.id === activeId && <Check size={13} className="text-[#A855F7] shrink-0" />}
              </button>
            ))}
            <div style={{ height: 1, background: "#27272A", margin: "4px 0" }} />
            <button onClick={createNew}
              className="flex items-center gap-2 w-full px-3 py-2 hover:bg-[#27272A] transition-colors">
              <Plus size={13} className="text-[#71717A]" />
              <span className="text-[13px] text-[#71717A]">New environment</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Right controls */}
      <div className="flex items-center gap-1">
        <IconBtn title="Search"><Search size={16} /></IconBtn>
        <IconBtn title="Notifications"><Bell size={16} /></IconBtn>
        <IconBtn title="Settings" onClick={() => onNavigate("settings")}><Settings size={16} /></IconBtn>

        {/* Avatar with initial */}
        <button
          className="flex items-center justify-center rounded-full font-semibold text-white ml-1 hover:opacity-80 transition-opacity"
          style={{ width: 28, height: 28, background: "#A855F7", fontSize: 11, fontFamily: "Inter, sans-serif" }}>
          M
        </button>
      </div>
    </header>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title?: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick}
      className="flex items-center justify-center rounded-md transition-colors hover:bg-[#1A1A1A] text-[#71717A] hover:text-[#A1A1AA]"
      style={{ width: 32, height: 32 }}>
      {children}
    </button>
  );
}
