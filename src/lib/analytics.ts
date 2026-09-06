import { useSettingsStore } from "@/stores/settings";
import { APP_VERSION } from "@/lib/version";
import { getInstallId, getPlatform } from "@/lib/installId";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";

/**
 * Telemetría anónima de Flux.
 *
 * POR QUÉ NO ESCRIBE DIRECTO EN SUPABASE
 *
 * Antes esto hacía `supabase.from("analytics_events").insert(...)`. La policy
 * de RLS era `for insert to authenticated`, y en Flux iniciar sesión es
 * opcional: la mayoría de las instalaciones nunca autentican, así que Postgres
 * rechazaba sus inserts y el `catch` vacío de aquí abajo se comía el error.
 * Meses de datos perdidos sin un solo síntoma. Ahora todo va contra la edge
 * function `telemetry`, que valida y escribe con service_role, y las tablas
 * siguen cerradas al rol anon (la anon key va dentro del binario: es pública).
 *
 * QUÉ SE MANDA Y QUÉ NO
 *
 * Flux es donde la gente pega tokens, URLs internas y payloads privados. Nada
 * de eso sale de la máquina. En concreto:
 *
 *   - Ninguna URL, ni entera ni por partes. De una request solo se derivan el
 *     método, si el esquema era https y si apuntaba a localhost.
 *   - Ningún header, body, nombre de colección, entorno ni variable.
 *   - Los mensajes de crash pasan por `redact()` antes de salir.
 *
 * El identificador es un UUID por instalación, no por persona. Ver installId.ts.
 */

const ENDPOINT = `${SUPABASE_URL}/functions/v1/telemetry`;

const FLUSH_INTERVAL_MS = 60_000;

/**
 * Si la cola crece más que esto es que llevamos rato sin red. Se descartan los
 * eventos más viejos: la telemetría nunca debe comerse memoria de la app.
 */
const MAX_QUEUE = 200;

interface AnalyticsEvent {
  type: string;
  data?: Record<string, string | number | boolean>;
  ts: number;
}

interface CrashEvent {
  message: string;
  ts: number;
}

const pendingEvents: AnalyticsEvent[] = [];
const pendingCrashes: CrashEvent[] = [];

// ─────────────────────────────────────
// Saneado
// ─────────────────────────────────────

/**
 * Quita de un texto libre lo que en un cliente de API suele ser justo lo que no
 * debe viajar. El orden importa: las URLs primero, porque se llevan por delante
 * la mayoría de los tokens en query params.
 */
export function redact(text: string): string {
  return text
    // URLs completas. Se conserva el esquema para poder distinguir un fallo de
    // TLS de uno de texto plano, y nada más.
    .replace(/\b(https?|wss?|grpc):\/\/[^\s"'<>)]+/gi, "$1://<url>")
    // Rutas de usuario: el nombre de la carpeta personal es el nombre real.
    .replace(/[A-Za-z]:\\Users\\[^\\/\s"']+/g, "C:\\Users\\<user>")
    .replace(/\/(?:home|Users)\/[^/\s"']+/g, "/home/<user>")
    // Correos.
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>")
    // Bearer y compañía.
    .replace(/\b(bearer|token|apikey|api[_-]?key|secret|password|authorization)\b\s*[:=]?\s*\S+/gi, "$1 <redacted>")
    // Cadenas largas sin espacios: JWTs, claves, hashes.
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "<redacted>")
    .slice(0, 2000);
}

/**
 * Lo único que se extrae de una URL. Nunca el host: un hostname interno
 * (`api.staging.clientex.local`) identifica a la empresa del usuario.
 */
export function urlShape(url: string): { scheme: string; local: boolean } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return {
      scheme: u.protocol.replace(":", ""),
      local: host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local"),
    };
  } catch {
    return { scheme: "unknown", local: false };
  }
}

// ─────────────────────────────────────
// Envío
// ─────────────────────────────────────

/**
 * `keepalive` permite que el envío sobreviva al cierre de la ventana, que es
 * justo cuando se pierde el último tramo de la sesión.
 */
async function post(payload: unknown, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // La función conserva activada la verificación de JWT. No pide sesión:
        // la anon key basta para satisfacerla, y eso deja fuera al ruido de
        // fondo de internet en vez de exponer un endpoint de escritura abierto.
        // No es un secreto —va dentro del binario— pero sí un obstáculo.
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function flushEvents(keepalive = false): Promise<void> {
  const anyEnabled =
    useSettingsStore.getState().analytics || useSettingsStore.getState().crashReports;
  if (!anyEnabled) return;
  if (pendingEvents.length === 0 && pendingCrashes.length === 0) return;

  const events = pendingEvents.splice(0);
  const crashes = pendingCrashes.splice(0);

  const ok = await post(
    {
      install_id: getInstallId(),
      app_version: APP_VERSION,
      platform: getPlatform(),
      events,
      crashes,
      // Solo cuenta como instalación activa quien aceptó la telemetría de uso.
      // `crashReports` viene activado de fábrica y `analytics` no: sin esta
      // distinción, un crash registraría como usuario activo a alguien que
      // dijo explícitamente que no quería ser medido.
      count_active: useSettingsStore.getState().analytics,
    },
    keepalive,
  );

  // Sin red se reencolan para el siguiente intento. Antes se perdían siempre.
  if (!ok) {
    pendingEvents.unshift(...events);
    pendingCrashes.unshift(...crashes);
    trim();
  }
}

function trim() {
  if (pendingEvents.length > MAX_QUEUE) {
    pendingEvents.splice(0, pendingEvents.length - MAX_QUEUE);
  }
  if (pendingCrashes.length > MAX_QUEUE) {
    pendingCrashes.splice(0, pendingCrashes.length - MAX_QUEUE);
  }
}

// ─────────────────────────────────────
// API pública
// ─────────────────────────────────────

export function trackEvent(type: string, data?: Record<string, string | number | boolean>) {
  if (!useSettingsStore.getState().analytics) return;
  pendingEvents.push({ type, data, ts: Date.now() });
  trim();
}

export function trackCrash(message: string) {
  if (!useSettingsStore.getState().crashReports) return;
  pendingCrashes.push({ message: redact(message), ts: Date.now() });
  trim();
}

/**
 * La URL entra pero no sale: solo se conservan la forma y las métricas. El
 * parámetro sigue ahí para no obligar a las llamadas a saber qué es seguro
 * mandar — esa decisión vive aquí, en un único sitio.
 */
export function trackPerf(url: string, method: string, ms: number, status: number) {
  if (!useSettingsStore.getState().perfMetrics) return;
  const shape = urlShape(url);
  pendingEvents.push({
    type: "request_perf",
    data: { method, ms: Math.round(ms), status, scheme: shape.scheme, local: shape.local },
    ts: Date.now(),
  });
  trim();
}

let started = false;

export function initCrashReporting() {
  if (started) return;
  started = true;

  window.onerror = (msg) => {
    trackCrash(typeof msg === "string" ? msg : "Unknown JS error");
  };
  window.addEventListener("unhandledrejection", (e) => {
    trackCrash(String(e.reason ?? "Unhandled promise rejection"));
  });
  window.addEventListener("beforeunload", () => {
    void flushEvents(true);
  });

  setInterval(() => void flushEvents(), FLUSH_INTERVAL_MS);

  // El primer lote sale enseguida en vez de esperar 60s. Una sesión corta
  // —abrir Flux, mirar algo, cerrar— es exactamente la que hay que contar para
  // saber cuánta gente instala y no se queda.
  setTimeout(() => void flushEvents(), 3_000);
}
