import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { GitMerge, X } from "lucide-react";
import { defineThemes } from "@/components/CodeEditor";
import { useSettingsStore } from "@/stores/settings";
import { useConflictsStore, type Conflict } from "@/stores/conflicts";
import { keepLocalCollection, keepRemoteCollection } from "@/lib/sync";
import type { Collection } from "@/stores/collections";

/**
 * `expanded` es estado de la barra lateral, no contenido. Sin quitarlo, abrir
 * o cerrar una carpeta apareceria como diferencia y el diff se llenaria de
 * ruido que no explica nada.
 */
function forDiff(collection: Collection): string {
  const clean = JSON.parse(JSON.stringify(collection)) as Record<string, unknown>;
  const strip = (node: Record<string, unknown>) => {
    delete node.expanded;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((v) => typeof v === "object" && v && strip(v as Record<string, unknown>));
      else if (typeof value === "object" && value) strip(value as Record<string, unknown>);
    }
  };
  strip(clean);
  return JSON.stringify(clean, null, 2);
}

function ConflictBody({ conflict, onDone }: { conflict: Conflict; onDone: () => void }) {
  const theme = useSettingsStore((s) => s.theme);
  const [busy, setBusy] = useState<"local" | "remote" | null>(null);
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  async function choose(side: "local" | "remote") {
    setBusy(side);
    try {
      if (side === "local") await keepLocalCollection(conflict);
      else await keepRemoteCollection(conflict);
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col"
      style={{
        width: "min(1040px, 92vw)",
        height: "min(680px, 88vh)",
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 16px 48px #00000080",
      }}
    >
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: 34, height: 34, background: "var(--color-accent-10)" }}
        >
          <GitMerge size={17} style={{ color: "var(--color-accent)" }} />
        </div>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-[15px] font-semibold truncate" style={{ color: "var(--color-fg)", letterSpacing: "-0.2px" }}>
            {conflict.name} changed in two places
          </span>
          <span className="text-[12px]" style={{ color: "var(--color-fg-3)" }}>
            Nothing has been overwritten. Pick which version to keep — the other one is lost.
          </span>
        </div>
        <button onClick={onDone} className="shrink-0 hover:opacity-70 transition-opacity" title="Decide later">
          <X size={16} style={{ color: "var(--color-fg-4)" }} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-5 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide flex-1" style={{ color: "var(--color-fg-4)" }}>
          This machine
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide flex-1" style={{ color: "var(--color-fg-4)" }}>
          Cloud &middot; version {conflict.remoteVersion}
        </span>
      </div>

      <div className="flex-1 min-h-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        <DiffEditor
          original={forDiff(conflict.local)}
          modified={forDiff(conflict.remote)}
          language="json"
          theme={isDark ? "flux-dark" : "flux-light"}
          beforeMount={defineThemes}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
          }}
        />
      </div>

      <div
        className="flex items-center justify-end gap-2 px-5 py-3.5"
        style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-topbar)" }}
      >
        <button
          onClick={() => choose("remote")}
          disabled={busy !== null}
          className="px-3 rounded transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ height: 30, fontSize: 12, background: "var(--color-input)", color: "var(--color-fg-2)", border: "1px solid var(--color-border)" }}
        >
          {busy === "remote" ? "Applying…" : "Keep the cloud version"}
        </button>
        <button
          onClick={() => choose("local")}
          disabled={busy !== null}
          className="px-3 rounded transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ height: 30, fontSize: 12, background: "var(--color-accent)", color: "#fff", border: "1px solid var(--color-accent)" }}
        >
          {busy === "local" ? "Applying…" : "Keep this machine's version"}
        </button>
      </div>
    </div>
  );
}

/**
 * Se resuelve de uno en uno. Con varios conflictos a la vez, una pila de
 * dialogos es peor que una cola: cada decision es independiente y conviene
 * verla sola.
 */
export function ConflictDialog() {
  const conflicts = useConflictsStore((s) => s.conflicts);
  const clear = useConflictsStore((s) => s.clear);
  const current = conflicts[0];
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center" style={{ background: "#00000090" }}>
      <ConflictBody key={current.id} conflict={current} onDone={() => clear(current.id)} />
    </div>
  );
}
