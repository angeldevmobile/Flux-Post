import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { parseShareId, SHARE_DEEP_LINK } from "@/lib/share";
import { useNavStore } from "@/stores/nav";

/**
 * Enlaces `flux://` que abren la app.
 *
 * Hoy solo hay uno: `flux://share/<id>`, el boton "Open in Flux" de la pagina
 * de un link compartido. Llega por dos caminos: `getCurrent` si fue el enlace
 * el que arranco Flux, y `onOpenUrl` si Flux ya estaba abierto (en Windows y
 * Linux lo reenvia el plugin single-instance).
 */
function handle(urls: string[] | null) {
  for (const url of urls ?? []) {
    if (!url.toLowerCase().startsWith(SHARE_DEEP_LINK)) continue;
    const id = parseShareId(url);
    if (id) useNavStore.getState().openShare(id);
  }
}

let started = false;

export async function initDeepLinks(): Promise<void> {
  if (started) return;
  started = true;
  try {
    handle(await getCurrent());
    await onOpenUrl(handle);
  } catch {
    // Fuera de Tauri (vite en el navegador, los tests) no hay plugin.
  }
}
