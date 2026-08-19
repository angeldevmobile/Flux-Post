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
