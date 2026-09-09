import type { CollectionAuth } from "@/lib/tauri";

/**
 * Convierte un `CollectionAuth` en lo que viaja en la peticion.
 *
 * Esto vivia solo dentro de `useRequestStore.getRequest()`, asi que el panel
 * mandaba el auth y el collection runner no: enviaba `req.headers` tal cual y
 * cualquier request con auth salia sin autenticar. Al extraerlo aqui los dos
 * caminos comparten la misma conversion.
 *
 * AWS SigV4 no cabe en esta funcion porque firma sobre el cuerpo y la url ya
 * resueltos y es asincrono; se aplica aparte, despues de interpolar variables.
 */
export interface AppliedAuth {
  headers: Record<string, string>;
  query: Record<string, string>;
}

export function authToRequest(auth: CollectionAuth | undefined): AppliedAuth {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  if (!auth) return { headers, query };

  switch (auth.type) {
    case "bearer":
      if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
      break;
    case "basic":
      if (auth.username) {
        headers["Authorization"] = `Basic ${btoa(`${auth.username}:${auth.password ?? ""}`)}`;
      }
      break;
    case "apikey":
      if (auth.key && auth.value) {
        if (auth.in === "query") query[auth.key] = auth.value;
        else headers[auth.key] = auth.value;
      }
      break;
    case "oauth2":
      // Solo el token ya obtenido: pedirlo es un flujo aparte con su propio estado.
      if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
      break;
    default:
      break;
  }

  return { headers, query };
}

/** True si el auth necesita el firmador asincrono en vez de `authToRequest`. */
export function needsAwsSigning(auth: CollectionAuth | undefined): boolean {
  return auth?.type === "awssigv4" && !!auth.accessKeyId;
}
