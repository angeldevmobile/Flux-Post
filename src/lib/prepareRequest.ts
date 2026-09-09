import { resolveInherited } from "@/lib/inheritance";
import { authToRequest } from "@/lib/authHeaders";
import { resolveRequestUrl, appendQuery } from "@/lib/requestUrl";
import type { Collection, CollectionRequest } from "@/lib/tauri";

/**
 * Convierte una request guardada en lo que se manda por el cable: herencia
 * resuelta, auth aplicado, variables interpoladas y query en la url.
 *
 * El collection runner y la pantalla de Tests hacian esto por su cuenta y
 * ninguno de los dos lo hacia entero: el runner no interpolaba `{{VAR}}` en
 * absoluto y la pantalla de Tests unia el baseUrl con rutas absolutas, dejando
 * `https://base/https://otra/x`. Aqui hay una sola version, probada.
 */

export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function prepareRequest(
  collection: Collection,
  request: CollectionRequest,
  resolveVariable: (value: string) => string,
): PreparedRequest {
  const inherited = resolveInherited(collection, request.id);
  const applied = authToRequest(inherited?.auth ?? request.auth);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    ...(inherited?.headers ?? request.headers ?? {}),
    ...applied.headers,
  })) {
    headers[k] = resolveVariable(v);
  }

  // Se interpolan antes de `appendQuery`: `encodeURIComponent` sobre un
  // `{{VAR}}` sin resolver lo dejaria como `%7B%7BVAR%7D%7D`.
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...(request.params ?? {}), ...applied.query })) {
    query[k] = resolveVariable(v);
  }

  const url = appendQuery(
    resolveRequestUrl(resolveVariable(collection.baseUrl ?? ""), resolveVariable(request.path)),
    query,
  );

  return {
    url,
    headers,
    body: request.body ? resolveVariable(request.body) : undefined,
  };
}
