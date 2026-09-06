import { useEffect } from "react";
import { BarChart3, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";
import { pendingMajorRelease } from "@/lib/whatsNew";
import { trackEvent } from "@/lib/analytics";

/**
 * Pregunta por la telemetría de uso. Una vez, y solo una vez.
 *
 * POR QUÉ EXISTE
 *
 * `analytics` viene apagado y esa es la postura correcta para un cliente de
 * API. Pero sin activarlo no se escribe en `app_pings`, y sin `app_pings` no
 * hay retención: los pings del updater cuentan cuánta gente hay cada día y
 * jamás podrán decir si alguien volvió, porque su hash lleva una sal que rota
 * cada 24 h. Es decir, sin esta pregunta "¿la gente vuelve?" es una métrica
 * estructuralmente inmedible, no una que falte por instrumentar.
 *
 * La alternativa a preguntar no es tener el dato de otra forma: es no tenerlo.
 *
 * REGLAS QUE NO SE TOCAN
 *
 * - Los dos botones pesan lo mismo. Empujar hacia el sí envenena el dato y
 *   contradice lo que dice la página de privacidad.
 * - Cerrar equivale a decir que no. El valor por defecto sigue siendo apagado.
 * - Se pregunta una vez en la vida de la instalación. `analyticsAsked` es un
 *   flag aparte de `analytics` justamente para eso: quien dijo que no, no
 *   vuelve a ver esto nunca.
 */
export function AnalyticsConsent() {
  const asked = useSettingsStore(s => s.analyticsAsked);
  const tourSeen = useSettingsStore(s => s.tourSeen);
  const lastSeenVersion = useSettingsStore(s => s.lastSeenVersion);
  const patch = useSettingsStore(s => s.patch);

  // Se coloca al final de la cola de arranque: primero el tour (instalación
  // nueva) o las novedades (instalación existente), y esto después. Un diálogo
  // de permisos como primera pantalla de una app que aún no has visto se cierra
  // sin leer, y esa respuesta no vale nada.
  const show = !asked && tourSeen && !pendingMajorRelease(lastSeenVersion);

  // Escape equivale a decir que no, igual que la X.
  useEffect(() => {
    if (!show) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") decline();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!show) return null;

  function decline() {
    patch({ analyticsAsked: true, analytics: false });
  }

  function accept() {
    patch({ analyticsAsked: true, analytics: true });
    // El `app_open` de este arranque se descartó: se emitió antes de que
    // existiera la respuesta, y `trackEvent` filtra por el valor de entonces.
    // Se repone para que la primera sesión no empiece con un hueco.
    trackEvent("app_open");
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
            <BarChart3 size={17} style={{ color: "var(--color-accent)" }} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-[15px] font-semibold" style={{ color: "var(--color-fg)", letterSpacing: "-0.2px" }}>
              Help improve Flux?
            </span>
            <span className="text-[12px] leading-relaxed" style={{ color: "var(--color-fg-2)" }}>
              Flux can send anonymous usage data to show which features actually get used
              and whether people come back. It stays off unless you turn it on.
            </span>
          </div>
          <button onClick={decline} className="shrink-0 hover:opacity-70 transition-opacity" title="Not now">
            <X size={16} style={{ color: "var(--color-fg-4)" }} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 pb-5">
          <Block title="What it sends" items={[
            "Which sections you open, and that a request was sent — its method, and whether it was https or localhost",
            "A random ID for this installation. Not an account, not a person, not your hardware",
          ]} />
          <Block title="What it never sends" items={[
            "URLs, hostnames, headers or bodies",
            "API keys, tokens or cookies",
            "Collection, environment or variable names",
          ]} />
        </div>

        {/* Mismo tamaño, misma tipografía, mismo alto. Solo el fondo distingue
            la acción afirmativa, y sin jerarquía de tamaño ni de color de texto. */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5"
          style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-topbar)" }}>
          <button onClick={decline}
            className="px-3.5 rounded-md text-[12px] font-medium transition-opacity hover:opacity-90"
            style={{ height: 32, background: "var(--color-input)", color: "var(--color-fg)", border: "1px solid var(--color-border)" }}>
            Not now
          </button>
          <button onClick={accept}
            className="px-3.5 rounded-md text-[12px] font-medium transition-opacity hover:opacity-90"
            style={{ height: 32, background: "var(--color-accent)", color: "#fff" }}>
            Turn it on
          </button>
        </div>

        <div className="px-5 pb-4 -mt-1">
          <span className="text-[11px] leading-relaxed" style={{ color: "var(--color-fg-4)" }}>
            Change this any time in Settings &rarr; Data &amp; Privacy. Crash reports are already
            on and get redacted before sending — same place to turn those off.
          </span>
        </div>
      </div>
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase" style={{ color: "var(--color-fg-4)", letterSpacing: "0.4px" }}>
        {title}
      </span>
      <ul className="flex flex-col gap-1">
        {items.map(it => (
          <li key={it} className="flex gap-2 text-[12px] leading-relaxed" style={{ color: "var(--color-fg-2)" }}>
            <span style={{ color: "var(--color-accent)" }}>&middot;</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
