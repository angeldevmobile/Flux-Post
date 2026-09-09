/**
 * Une el `baseUrl` de una coleccion con la ruta de una request.
 *
 * Habia tres versiones de esto (el runner, la paleta de comandos y la pantalla
 * de Tests) y la barra lateral no lo hacia, asi que abrir una request de una
 * coleccion con baseUrl dejaba una ruta relativa en la barra de direcciones.
 */
export function resolveRequestUrl(baseUrl: string | undefined, path: string): string {
  const base = (baseUrl ?? "").trim();
  if (!base) return path;
  // Una ruta absoluta manda sobre el baseUrl de la coleccion.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) return path;
  if (!path) return base;
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

/**
 * Añade parametros de query a una url que puede traer los suyos.
 *
 * El collection runner mandaba solo `path`, asi que los `params` guardados en
 * la request se perdian; y una api key configurada como `in: query` tiene que
 * acabar aqui, no en las cabeceras.
 */
export function appendQuery(url: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([k]) => k);
  if (entries.length === 0) return url;

  const [head, ...fragmentParts] = url.split("#");
  const fragment = fragmentParts.length ? "#" + fragmentParts.join("#") : "";
  const encoded = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const sep = head.includes("?") ? (head.endsWith("?") || head.endsWith("&") ? "" : "&") : "?";

  return `${head}${sep}${encoded}${fragment}`;
}
