import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Bell, Settings, Check, Plus, LogOut } from "lucide-react";
import { FluxLogoMark } from "@/components/FluxLogo";
import { useEnvironmentStore } from "@/stores/environment";
import { CommandPalette } from "@/components/CommandPalette";
import type { Route } from "@/components/NavRail";
import { useUserStore } from "@/stores/user";

interface TopBarProps {
  onNavigate: (r: Route) => void;
}

export function TopBar({ onNavigate }: TopBarProps) {
  const { environments, activeId, setActive, addEnvironment } = useEnvironmentStore();
  const user = useUserStore(s => s.user);
  const active = environments.find(e => e.id === activeId);
  const [envOpen, setEnvOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const envRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  // Close env dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Ctrl+K to open search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function createNew() {
    const id = `env-${Date.now()}`;
    addEnvironment({ id, name: "New Environment", variables: {} });
    setActive(id);
    setEnvOpen(false);
    onNavigate("environments");
  }

  return (
    <>
      <header className="flex items-center shrink-0 gap-3"
        style={{
          height: 48,
          padding: "0 16px",
          background: "var(--color-topbar)",
          borderBottom: "1px solid var(--color-border)",
        }}>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center rounded-lg"
            style={{ width: 26, height: 26, background: "var(--color-accent)" }}>
            <FluxLogoMark size={14} color="white" />
          </div>
          <span className="text-[15px] font-semibold"
            style={{ fontFamily: "Geist, Inter, sans-serif", letterSpacing: "-0.3px", color: "var(--color-fg)" }}>
            Flux
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />

        {/* Env selector */}
        <div ref={envRef} data-tour="env-selector" className="relative">
          <button
            onClick={() => setEnvOpen(v => !v)}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, height: 28, padding: "0 10px" }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: active ? "#22C55E" : "var(--color-fg-3)", flexShrink: 0 }} />
            <span className="text-[12px]" style={{ color: "var(--color-fg-2)" }}>{active?.name ?? "No environment"}</span>
            <ChevronDown size={12} style={{ color: "var(--color-fg-3)", transform: envOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
          </button>

          {envOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden py-1"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 200, boxShadow: "0 8px 24px #00000060" }}>
              {environments.length === 0 && (
                <p className="text-[12px] px-3 py-2" style={{ color: "var(--color-fg-4)" }}>No environments</p>
              )}
              {environments.map(env => (
                <button key={env.id}
                  onClick={() => { setActive(env.id); setEnvOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 transition-colors text-left"
                  style={{ background: "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", flexShrink: 0 }} />
                  <span className="flex-1 text-[13px]" style={{ color: "var(--color-fg-2)" }}>{env.name}</span>
                  {env.id === activeId && <Check size={13} style={{ color: "var(--color-accent)", flexShrink: 0 }} />}
                </button>
              ))}
              <div style={{ height: 1, background: "var(--color-border)", margin: "4px 0" }} />
              <button onClick={createNew}
                className="flex items-center gap-2 w-full px-3 py-2 transition-colors"
                style={{ background: "transparent" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <Plus size={13} style={{ color: "var(--color-fg-3)" }} />
                <span className="text-[13px]" style={{ color: "var(--color-fg-3)" }}>New environment</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-1">
          {/* Search */}
          <IconBtn title="Search (Ctrl+K)" onClick={() => setSearchOpen(true)}>
            <Search size={16} />
          </IconBtn>

          {/* Notifications */}
          <div ref={bellRef} className="relative">
            <IconBtn title="Notifications" onClick={() => setBellOpen(v => !v)}>
              <Bell size={16} />
            </IconBtn>
            {bellOpen && <NotificationsDropdown onClose={() => setBellOpen(false)} />}
          </div>

          <IconBtn title="Settings" onClick={() => onNavigate("settings")}>
            <Settings size={16} />
          </IconBtn>

          <UserAvatar user={user} onNavigate={onNavigate} />
        </div>
      </header>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function NotificationsDropdown({ onClose }: { onClose: () => void }) {
  void onClose;
  return (
    <div className="absolute top-full right-0 mt-1 z-50 rounded-lg overflow-hidden"
      style={{ width: 280, background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "0 8px 24px #00000060" }}>
      <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--color-fg)" }}>Notifications</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: "var(--color-border)", color: "var(--color-fg-3)" }}>0 new</span>
      </div>
      <div className="flex flex-col items-center gap-2 py-8 px-4">
        <Bell size={22} style={{ color: "var(--color-fg-4)" }} />
        <p className="text-[12px] text-center" style={{ color: "var(--color-fg-3)" }}>No notifications yet</p>
        <p className="text-[11px] text-center" style={{ color: "var(--color-fg-4)" }}>
          Request errors and AI results will appear here.
        </p>
      </div>
    </div>
  );
}

function UserAvatar({ user, onNavigate }: { user: import("@supabase/supabase-js").User | null; onNavigate: (r: Route) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const name: string = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email ?? "User";
  const email: string = user?.email ?? "";
  const initial = name.charAt(0).toUpperCase();

  async function handleSignOut() {
    const { supabase } = await import("@/lib/supabase");
    await supabase.auth.signOut();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative ml-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-center rounded-full font-semibold text-white hover:opacity-80 transition-opacity overflow-hidden"
        style={{ width: 28, height: 28, background: "var(--color-accent)", fontSize: 11, fontFamily: "Inter, sans-serif", flexShrink: 0 }}>
        {avatarUrl
          ? <img src={avatarUrl} alt={initial} style={{ width: 28, height: 28, objectFit: "cover" }} />
          : initial}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-50 rounded-xl overflow-hidden"
          style={{ width: 220, background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "0 8px 32px #00000050" }}>

          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-center rounded-full font-semibold text-white shrink-0 overflow-hidden"
              style={{ width: 34, height: 34, background: "var(--color-accent)", fontSize: 13 }}>
              {avatarUrl
                ? <img src={avatarUrl} alt={initial} style={{ width: 34, height: 34, objectFit: "cover" }} />
                : initial}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-semibold truncate" style={{ color: "var(--color-fg)" }}>{name}</span>
              {email && <span className="text-[11px] truncate" style={{ color: "var(--color-fg-3)" }}>{email}</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="py-1">
            <MenuItem icon={<Settings size={13} />} label="Settings" onClick={() => { onNavigate("settings"); setOpen(false); }} />
            <div style={{ height: 1, background: "var(--color-border)", margin: "4px 8px" }} />
            <MenuItem icon={<LogOut size={13} />} label="Sign out" onClick={handleSignOut} danger />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] transition-colors"
      style={{ color: danger ? "#EF4444" : "var(--color-fg-2)", background: "transparent" }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? "#EF444415" : "var(--color-border)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      {icon}
      {label}
    </button>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title?: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick}
      className="flex items-center justify-center rounded-md transition-colors"
      style={{ width: 32, height: 32, color: "var(--color-fg-3)", background: "transparent" }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-card)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-fg-2)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-fg-3)"; }}>
      {children}
    </button>
  );
}
