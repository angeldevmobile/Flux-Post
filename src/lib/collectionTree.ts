import type { Collection, CollectionFolder, CollectionRequest } from "@/lib/tauri";

/**
 * Edicion inmutable del arbol de carpetas de una coleccion.
 *
 * Las carpetas anidan sin limite y el guardado reescribe la coleccion entera,
 * asi que cambiar una carpeta honda a mano es facil de hacer mal: se pierde una
 * rama o se muta el store por debajo. Estas dos funciones son el unico camino.
 */

/** Busca una carpeta por id a cualquier profundidad. */
export function findFolder(
  collection: Collection,
  folderId: string,
): CollectionFolder | null {
  const walk = (folders: CollectionFolder[]): CollectionFolder | null => {
    for (const f of folders) {
      if (f.id === folderId) return f;
      const deeper = walk(f.folders ?? []);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(collection.folders);
}

/**
 * Devuelve una coleccion nueva con `patch` aplicado sobre la carpeta indicada.
 *
 * Si el id no existe devuelve la coleccion tal cual, sin lanzar: el llamante ya
 * comprueba antes y esto evita dejar la UI a medias por una carrera.
 */
export function updateFolder(
  collection: Collection,
  folderId: string,
  patch: Partial<CollectionFolder>,
): Collection {
  const walk = (folders: CollectionFolder[]): CollectionFolder[] =>
    folders.map((f) => {
      if (f.id === folderId) return { ...f, ...patch };
      const subs = f.folders ?? [];
      if (subs.length === 0) return f;
      return { ...f, folders: walk(subs) };
    });

  return { ...collection, folders: walk(collection.folders) };
}

/**
 * Quita las claves vacias de un mapa de headers.
 *
 * La tabla de la UI trabaja con filas, y una fila a medio escribir no debe
 * acabar en el YAML como una clave vacia.
 */
export function compactHeaders(rows: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return out;
}

/**
 * Todas las requests de una coleccion, incluidas las de carpetas anidadas.
 *
 * Cada pantalla llevaba su propio aplanado y la de Tests no lo hacia: recorria
 * solo `collection.requests`, asi que los tests dentro de carpetas no se
 * ejecutaban nunca y la suite salia en verde sin haberlos probado.
 */
export function allRequests(collection: Collection): CollectionRequest[] {
  const walk = (folders: CollectionFolder[]): CollectionRequest[] =>
    folders.flatMap((f) => [...f.requests, ...walk(f.folders ?? [])]);
  return [...collection.requests, ...walk(collection.folders)];
}

/** Las que tienen al menos una assertion. */
export function requestsWithTests(collection: Collection): CollectionRequest[] {
  return allRequests(collection).filter((r) => (r.tests?.length ?? 0) > 0);
}

/**
 * Operaciones de organizacion: renombrar, crear, borrar y mover.
 *
 * Todas trabajan a cualquier profundidad y devuelven una coleccion nueva. Las
 * de la store solo miraban el nivel raiz —`deleteRequest` filtraba
 * `collection.requests` y se olvidaba de las carpetas— asi que con algo anidado
 * no hacian nada y no se quejaban.
 */

/** Aplica `fn` a la lista de carpetas de cada nodo, de arriba abajo. */
function mapFolders(
  folders: CollectionFolder[],
  fn: (f: CollectionFolder) => CollectionFolder,
): CollectionFolder[] {
  return folders.map((f) => fn({ ...f, folders: mapFolders(f.folders ?? [], fn) }));
}

export function renameFolder(
  collection: Collection,
  folderId: string,
  name: string,
): Collection {
  return updateFolder(collection, folderId, { name });
}

export function renameRequest(
  collection: Collection,
  requestId: string,
  name: string,
): Collection {
  const rename = (r: CollectionRequest) => (r.id === requestId ? { ...r, name } : r);
  return {
    ...collection,
    requests: collection.requests.map(rename),
    folders: mapFolders(collection.folders, (f) => ({ ...f, requests: f.requests.map(rename) })),
  };
}

/** `parentFolderId` null = a la raiz de la coleccion. */
export function addFolder(
  collection: Collection,
  parentFolderId: string | null,
  folder: CollectionFolder,
): Collection {
  if (parentFolderId === null) {
    return { ...collection, folders: [...collection.folders, folder] };
  }
  const parent = findFolder(collection, parentFolderId);
  if (!parent) return collection;
  return updateFolder(collection, parentFolderId, {
    folders: [...(parent.folders ?? []), folder],
  });
}

export function addRequest(
  collection: Collection,
  parentFolderId: string | null,
  request: CollectionRequest,
): Collection {
  if (parentFolderId === null) {
    return { ...collection, requests: [...collection.requests, request] };
  }
  const parent = findFolder(collection, parentFolderId);
  if (!parent) return collection;
  return updateFolder(collection, parentFolderId, {
    requests: [...parent.requests, request],
  });
}

/** Borra la carpeta y todo lo que cuelga de ella, este donde este. */
export function deleteFolder(collection: Collection, folderId: string): Collection {
  const prune = (folders: CollectionFolder[]): CollectionFolder[] =>
    folders
      .filter((f) => f.id !== folderId)
      .map((f) => ({ ...f, folders: prune(f.folders ?? []) }));
  return { ...collection, folders: prune(collection.folders) };
}

export function deleteRequest(collection: Collection, requestId: string): Collection {
  const drop = (rs: CollectionRequest[]) => rs.filter((r) => r.id !== requestId);
  return {
    ...collection,
    requests: drop(collection.requests),
    folders: mapFolders(collection.folders, (f) => ({ ...f, requests: drop(f.requests) })),
  };
}

/** La request tal cual esta guardada, a cualquier profundidad. */
export function findRequest(
  collection: Collection,
  requestId: string,
): CollectionRequest | null {
  return allRequests(collection).find((r) => r.id === requestId) ?? null;
}

/**
 * Mueve una request a otra carpeta de la misma coleccion, o a la raiz.
 *
 * Se borra y se vuelve a insertar, asi que mover a donde ya estaba la deja al
 * final de su propia lista en vez de dejarla igual; el llamante comprueba antes.
 */
export function moveRequest(
  collection: Collection,
  requestId: string,
  targetFolderId: string | null,
): Collection {
  const request = findRequest(collection, requestId);
  if (!request) return collection;
  if (targetFolderId !== null && !findFolder(collection, targetFolderId)) return collection;
  return addRequest(deleteRequest(collection, requestId), targetFolderId, request);
}

/**
 * Mueve una request de una coleccion a otra. Devuelve las dos, que hay que
 * guardar por separado porque son dos ficheros y pueden estar en dos carpetas
 * raiz distintas.
 */
export function moveRequestBetween(
  from: Collection,
  to: Collection,
  requestId: string,
  targetFolderId: string | null,
  newId: string,
): { from: Collection; to: Collection } | null {
  const request = findRequest(from, requestId);
  if (!request) return null;
  if (targetFolderId !== null && !findFolder(to, targetFolderId)) return null;
  // Id nuevo: el viejo lleva el prefijo de la coleccion de origen y podria
  // chocar con algo de la de destino.
  return {
    from: deleteRequest(from, requestId),
    to: addRequest(to, targetFolderId, { ...request, id: newId }),
  };
}

/** Copia una request junto a la original, con id y nombre nuevos. */
export function duplicateRequest(
  collection: Collection,
  requestId: string,
  newId: string,
): Collection {
  const request = findRequest(collection, requestId);
  if (!request) return collection;
  const copy = { ...request, id: newId, name: `${request.name} copy` };
  const parent = collection.folders.length > 0 ? folderContaining(collection, requestId) : null;
  return addRequest(collection, parent, copy);
}

/** Id de la carpeta que contiene una request, o null si esta en la raiz. */
export function folderContaining(collection: Collection, requestId: string): string | null {
  const walk = (folders: CollectionFolder[]): string | null => {
    for (const f of folders) {
      if (f.requests.some((r) => r.id === requestId)) return f.id;
      const deeper = walk(f.folders ?? []);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(collection.folders);
}
