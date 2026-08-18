import { Sparkles, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";
import { pendingMajorRelease } from "@/lib/whatsNew";
import type { Route } from "@/components/NavRail";

interface Props {
  onNavigate: (r: Route) => void;
}

/**
 * Panel de bienvenida tras actualizar. Solo para versiones marcadas como
 * major, y nunca en una instalación nueva: ahí el sitio es el tour.
 */
export function WhatsNewDialog({ onNavigate }: Props) {
  const tourSeen = useSettingsStore(s => s.tourSeen);
  const lastSeenVersion = useSettingsStore(s => s.lastSeenVersion);
  const patch = useSettingsStore(s => s.patch);

  const release = tourSeen ? pendingMajorRelease(lastSeenVersion) : null;
  if (!release) return null;

  function dismiss() {
    if (release) patch({ lastSeenVersion: release.version });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "#00000090" }}>
      <div className="rounded-xl overflow-hidden" style={{
        width: 460, background: "var(--color-card)",
        border: "1px solid var(--color-border)", boxShadow: "0 16px 48px #00000080",
      }}>
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="flex items-center justify-center rounded-lg shrink-0"
            style={{ width: 34, height: 34, background: "var(--color-accent-10)" }}>
            <Sparkles size={17} style={{ color: "var(--color-accent)" }} />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-[10px] font-medium" style={{ color: "var(--color-accent)", fontFamily: "Geist Mono, monospace" }}>
              v{release.version}
            </span>
            <span className="text-[15px] font-semibold" style={{ color: "var(--color-fg)", letterSpacing: "-0.2px" }}>
              {release.title}
            </span>
          </div>
          <button onClick={dismiss} className="shrink-0 hover:opacity-70 transition-opacity" title="Close">
            <X size={16} style={{ color: "var(--color-fg-4)" }} />
          </button>
        </div>

        <ul className="flex flex-col gap-2 px-5 pb-5">
          {release.points.map(pt => (
            <li key={pt} className="flex gap-2 text-[12px] leading-relaxed" style={{ color: "var(--color-fg-2)" }}>
              <span style={{ color: "var(--color-accent)" }}>&middot;</span>
              <span>{pt}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5"
          style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-topbar)" }}>
          <button onClick={dismiss}
            className="px-3 rounded-md text-[12px] transition-colors hover:opacity-80"
            style={{ height: 32, color: "var(--color-fg-3)" }}>
            Dismiss
          </button>
          <button onClick={() => { dismiss(); onNavigate("settings"); }}
            className="px-3.5 rounded-md text-[12px] font-medium transition-opacity hover:opacity-90"
            style={{ height: 32, background: "var(--color-accent)", color: "#fff" }}>
            Open AI settings
          </button>
        </div>
      </div>
    </div>
  );
}
