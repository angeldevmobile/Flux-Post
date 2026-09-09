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
