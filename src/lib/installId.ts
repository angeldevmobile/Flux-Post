/**
 * Identidad anónima de instalación.
 *
 * Sin esto la telemetría solo sabe contar eventos, y "421 eventos" no responde
 * ninguna pregunta útil: pueden ser 200 personas probando Flux una vez o una
 * sola dejándolo abierto toda la semana. El install_id separa esos dos mundos
 * y es lo que hace posible medir retención.
 *
 * Es un UUID aleatorio. No se deriva de nada del equipo ni de la cuenta: no
 * identifica a una persona, identifica a una copia de Flux. Se puede borrar
 * limpiando los datos locales, y entonces cuenta como una instalación nueva.
 */

const KEY = "flux_install_id";

/** UUID v4 sin depender de que `crypto.randomUUID` exista en la webview. */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let cached: string | null = null;

export function getInstallId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = uuid();
    localStorage.setItem(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // localStorage puede fallar en modos restringidos. Un id efímero mantiene
    // coherente el lote actual aunque no sobreviva al reinicio.
    cached = uuid();
    return cached;
  }
}

export type Platform = "windows" | "macos" | "linux" | "unknown";

/**
 * Se deduce del user agent en vez de añadir `@tauri-apps/plugin-os`: solo hace
 * falta distinguir tres sistemas para partir las métricas, y no compensa una
 * dependencia nativa más ni un permiso más en la capability.
 */
export function getPlatform(): Platform {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("windows") || ua.includes("win32") || ua.includes("win64")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh") || ua.includes("darwin")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}
