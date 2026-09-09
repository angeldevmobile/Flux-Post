import type {
  Collection,
  CollectionAuth,
  CollectionFolder,
  CollectionRequest,
  CollectionScripts,
} from "@/lib/tauri";

/**
 * Cascada de auth, headers y scripts: request > carpeta (la mas cercana
 * primero) > coleccion.
 *
 * El importador de Postman ya resolvia la herencia, pero la aplastaba: copiaba
 * el auth resuelto dentro de cada request. Eso se ve bien justo despues del
 * import y deja de verse bien en cuanto el token cambia de forma, porque hay
 * que editar las N requests. Aqui la herencia se resuelve al enviar y nunca se
 * escribe sobre la request, asi que el YAML sigue teniendo el auth en un unico
 * sitio.
 */

/** Nodos desde la coleccion hasta la carpeta que contiene la request. */
export interface InheritanceChain {
  collection: Collection;
  folders: CollectionFolder[];
  request: CollectionRequest;
}

export interface Inherited {
  auth?: CollectionAuth;
  /** Ya fusionados: los de la request pisan a los de la carpeta y estos a los de la coleccion. */
  headers: Record<string, string>;
  /** Los scripts no se pisan, se concatenan de fuera hacia dentro. */
  scripts?: CollectionScripts;
  /** De donde salio el auth efectivo, para poder decirlo en la UI. */
  authSource?: { kind: "request" | "folder" | "collection"; name: string };
}

/** Busca la request y devuelve el camino de carpetas que la contiene. */
export function findChain(
  collection: Collection,
  requestId: string,
): InheritanceChain | null {
  const direct = collection.requests.find((r) => r.id === requestId);
  if (direct) return { collection, folders: [], request: direct };

  const walk = (
    folders: CollectionFolder[],
    trail: CollectionFolder[],
  ): InheritanceChain | null => {
    for (const folder of folders) {
      const hit = folder.requests.find((r) => r.id === requestId);
      if (hit) return { collection, folders: [...trail, folder], request: hit };
      const deeper = walk(folder.folders ?? [], [...trail, folder]);
      if (deeper) return deeper;
    }
    return null;
  };

  return walk(collection.folders, []);
}

/** Une dos bloques de script conservando el orden externo -> interno. */
function concatScript(outer: string | undefined, inner: string | undefined): string | undefined {
  const a = outer?.trim();
  const b = inner?.trim();
  if (a && b) return `${a}\n${b}`;
  return a || b || undefined;
}

/**
 * Resuelve la herencia de una cadena ya localizada.
 *
 * Los headers se fusionan por clave (case-insensitive, como los manda HTTP) y
 * el auth es todo-o-nada: el primero que se encuentre subiendo desde la request
 * gana entero, sin mezclar campos de dos niveles distintos, que daria
 * credenciales a medias.
 */
export function resolveChain(
  chain: InheritanceChain,
  opts: { includeRequest?: boolean } = {},
): Inherited {
  const { includeRequest = true } = opts;
  const { collection, folders, request } = chain;

  // Headers: de fuera hacia dentro, para que el mas cercano pise.
  const headers: Record<string, string> = {};
  const seen = new Map<string, string>(); // lower(name) -> nombre tal cual se escribio
  const put = (src: Record<string, string> | undefined) => {
    for (const [k, v] of Object.entries(src ?? {})) {
      const prev = seen.get(k.toLowerCase());
      if (prev !== undefined) delete headers[prev];
      seen.set(k.toLowerCase(), k);
      headers[k] = v;
    }
  };
  put(collection.headers);
  for (const f of folders) put(f.headers);
  if (includeRequest) put(request.headers);

  // Auth: el mas cercano gana entero.
  let auth: CollectionAuth | undefined;
  let authSource: Inherited["authSource"];
  if (includeRequest && request.auth) {
    auth = request.auth;
    authSource = { kind: "request", name: request.name };
  } else {
    for (let i = folders.length - 1; i >= 0; i--) {
      if (folders[i].auth) {
        auth = folders[i].auth;
        authSource = { kind: "folder", name: folders[i].name };
        break;
      }
    }
    if (!auth && collection.auth) {
      auth = collection.auth;
      authSource = { kind: "collection", name: collection.name };
    }
  }
  // `type: none` en un nivel corta la herencia a proposito.
  if (auth?.type === "none") {
    auth = undefined;
    authSource = undefined;
  }

  // Scripts: se concatenan, coleccion -> carpetas -> request.
  let pre: string | undefined;
  let post: string | undefined;
  pre = concatScript(pre, collection.scripts?.preRequest);
  post = concatScript(post, collection.scripts?.postResponse);
  for (const f of folders) {
    pre = concatScript(pre, f.scripts?.preRequest);
    post = concatScript(post, f.scripts?.postResponse);
  }
  if (includeRequest) {
    pre = concatScript(pre, request.scripts?.preRequest);
    post = concatScript(post, request.scripts?.postResponse);
  }

  const scripts: CollectionScripts | undefined =
    pre || post ? { ...(pre ? { preRequest: pre } : {}), ...(post ? { postResponse: post } : {}) } : undefined;

  return { auth, headers, scripts, authSource };
}

/** Atajo: localiza la request en la coleccion y resuelve su herencia. */
export function resolveInherited(
  collection: Collection,
  requestId: string,
): Inherited | null {
  const chain = findChain(collection, requestId);
  return chain ? resolveChain(chain) : null;
}

/**
 * Busca la request en varias colecciones. La UI tiene el id de la request
 * activa pero no siempre sabe de que coleccion viene.
 */
export function resolveInheritedAcross(
  collections: Collection[],
  requestId: string,
): Inherited | null {
  for (const c of collections) {
    const chain = findChain(c, requestId);
    if (chain) return resolveChain(chain);
  }
  return null;
}

/**
 * Solo lo que aportan coleccion y carpetas, sin la request.
 *
 * El panel de peticiones trabaja sobre el store, que puede tener cambios sin
 * guardar; si mezclaramos la request tal como esta en el YAML pisariamos lo que
 * el usuario acaba de escribir. Aqui devolvemos el fondo heredado y que el
 * panel ponga lo suyo encima.
 */
export function resolveAncestorsAcross(
  collections: Collection[],
  requestId: string,
): Inherited | null {
  for (const c of collections) {
    const chain = findChain(c, requestId);
    if (chain) return resolveChain(chain, { includeRequest: false });
  }
  return null;
}

/**
 * Lo que hereda una carpeta de sus ancestros (la coleccion y las carpetas por
 * encima), sin contar lo que la propia carpeta define.
 *
 * Lo usa el editor de herencia para poder decir "hereda bearer de API" en vez
 * de dejar al usuario adivinando que pasa si elige "Inherit".
 */
export function resolveFolderAncestors(
  collection: Collection,
  folderId: string,
): Inherited | null {
  const walk = (
    folders: CollectionFolder[],
    trail: CollectionFolder[],
  ): CollectionFolder[] | null => {
    for (const f of folders) {
      if (f.id === folderId) return trail;
      const deeper = walk(f.folders ?? [], [...trail, f]);
      if (deeper) return deeper;
    }
    return null;
  };

  const trail = walk(collection.folders, []);
  if (trail === null) return null;

  // La request es un marcador: `includeRequest: false` la ignora entera.
  const placeholder: CollectionRequest = {
    id: "",
    name: "",
    method: "GET",
    path: "",
    headers: {},
    tests: [],
  };
  return resolveChain(
    { collection, folders: trail, request: placeholder },
    { includeRequest: false },
  );
}
