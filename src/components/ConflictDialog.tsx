import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { GitMerge, X } from "lucide-react";
import { defineThemes } from "@/components/CodeEditor";
import { useSettingsStore } from "@/stores/settings";
import { useConflictsStore, type Conflict } from "@/stores/conflicts";
import { keepLocalCollection, keepRemoteCollection } from "@/lib/sync";
import type { Collection } from "@/stores/collections";

/**
 * Deja los dos lados en la misma forma para que el diff solo marque lo que de
 * verdad cambia.
 *
 * Hacen falta dos normalizaciones:
 *
 * 1. Ordenar las claves. El lado local llega con el orden de JavaScript y el
 *    remoto con el que Postgres le da al guardarlo como `jsonb`, que las
 *    reordena por longitud y alfabeticamente. Sin ordenar, practicamente cada
 *    linea sale marcada aunque el contenido sea identico.
 * 2. Quitar `expanded`, que es estado de la barra lateral y no contenido:
 *    abrir o cerrar una carpeta no es un cambio que resolver.
 * 3. Quitar lo vacio y lo nulo. Una coleccion recien leida del disco pasa por
 *    Rust, que rellena `params: {}`, `form: {}` y `extractors: []`; la que se
 *    subio desde memoria no los lleva. Significan lo mismo, asi que marcarlos
 *    como diferencia solo estorba a quien tiene que decidir.
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (key === "expanded") continue;
      const normalized = canonical(source[key]);
      if (isEmpty(normalized)) continue;
      out[key] = normalized;
    }
    return out;
  }
  return value;
}

function forDiff(collection: Collection): string {
  return JSON.stringify(canonical(collection), null, 2);
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
          // Al cerrar el dialogo, Monaco desecha sus modelos antes de que el
          // widget del diff se entere y lanza un error sin capturar. Como
          // `initCrashReporting` engancha `window.onerror`, cada conflicto
          // resuelto acababa escribiendo un informe de crash falso en
          // `crash_reports`. Reteniendo los modelos no hay carrera que perder.
          keepCurrentOriginalModel
          keepCurrentModifiedModel
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
