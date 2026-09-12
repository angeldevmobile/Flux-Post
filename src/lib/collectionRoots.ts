import type { Collection } from "@/lib/tauri";

/**
 * Las carpetas de colecciones que Flux tiene abiertas.
 *
 * Antes era una sola, guardada como cadena en `flux_collections_dir`, y cambiar
 * de carpeta reemplazaba la vista. Eso obliga a tener todas las colecciones bajo
 * un mismo padre, que es justo lo que impide que una coleccion viva dentro del
 * repo al que pertenece y se ramifique y se revise con su codigo.
 *
 * Ahora es una lista. Cada coleccion recuerda de que raiz salio (`rootDir`) para
 * que guardar escriba en el sitio del que se leyo.
 */

const ROOTS_KEY = "flux_collection_roots";
/** La clave antigua, de una sola carpeta. Se lee para migrar y luego se borra. */
const LEGACY_KEY = "flux_collections_dir";

/** Quita la barra final y los espacios, para que una ruta no entre dos veces. */
export function normalizeRoot(dir: string): string {
  const trimmed = dir.trim().replace(/[\\/]+$/, "");
  return trimmed;
}

function read(): string[] {
  try {
    const raw = localStorage.getItem(ROOTS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
      }
    }
  } catch {
    // Un valor corrupto no debe dejar la barra lateral sin arrancar.
  }
  return [];
}

function write(roots: string[]): string[] {
  try {
    localStorage.setItem(ROOTS_KEY, JSON.stringify(roots));
  } catch {
    // Sin almacenamiento se pierde al cerrar, pero la sesion sigue funcionando.
  }
  return roots;
}

/**
 * Las raices abiertas. La primera vez migra la carpeta unica anterior, para que
 * quien actualice siga viendo sus colecciones sin volver a configurarlas.
 */
export function getRoots(): string[] {
  const roots = read();
  if (roots.length > 0) return roots;

  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && legacy.trim()) {
    const migrated = [normalizeRoot(legacy)];
    write(migrated);
    return migrated;
  }
  return [];
}

/** Añade una raiz al final. Repetirla no la duplica ni la reordena. */
export function addRoot(dir: string): string[] {
  const clean = normalizeRoot(dir);
  if (!clean) return getRoots();
  const roots = getRoots();
  if (roots.includes(clean)) return roots;
  return write([...roots, clean]);
}

export function removeRoot(dir: string): string[] {
  const clean = normalizeRoot(dir);
  return write(getRoots().filter((r) => r !== clean));
}

export function clearRoots(): string[] {
  return write([]);
}

/**
 * Dónde escribir una coleccion.
 *
 * La suya si la tiene; si no (una que acaba de bajar de la nube, por ejemplo),
 * la de otra coleccion ya cargada con el mismo id, y como ultimo recurso la
 * primera raiz abierta. Devuelve null si no hay ninguna, y entonces no hay
 * fichero que escribir.
 */
export function rootFor(
  collection: Pick<Collection, "id"> & { rootDir?: string },
  loaded: Collection[] = [],
): string | null {
  if (collection.rootDir) return collection.rootDir;
  const known = loaded.find((c) => c.id === collection.id)?.rootDir;
  if (known) return known;
  return getRoots()[0] ?? null;
}

/** Nombre corto de una raiz, para la barra lateral. */
export function rootLabel(dir: string): string {
  const parts = normalizeRoot(dir).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || dir;
}

/**
 * Junta lo cargado de cada raiz en una sola lista, marcando de donde sale cada
 * coleccion y resolviendo los ids repetidos.
 *
 * El id de una coleccion es el nombre de su fichero, asi que dos repos con un
 * `api.yaml` cada uno colisionan, y con colecciones que viven dentro de su
 * repo eso no es raro, es lo normal. La primera que aparece conserva su id y las
 * siguientes se prefijan con el nombre de su carpeta.
 *
 * Solo desambigua cuando hay choque real: con una sola raiz los ids quedan
 * exactamente como antes, que es lo que evita que la sincronizacion con la nube
 * vea colecciones nuevas al actualizar.
 *
 * Prefijar el id es seguro para el guardado: el lado de Rust decide la
 * subcarpeta con `group` y usa solo el ultimo segmento del id como nombre de
 * fichero.
 */
export function mergeRootCollections(
  groups: { root: string; collections: Collection[] }[],
): Collection[] {
  const out: Collection[] = [];
  const taken = new Set<string>();

  for (const { root, collections } of groups) {
    for (const collection of collections) {
      let id = collection.id;
      if (taken.has(id)) {
        const prefix = rootLabel(root);
        id = `${prefix}/${collection.id}`;
        // Dos raices con el mismo nombre de carpeta: se numera.
        let n = 2;
        while (taken.has(id)) {
          id = `${prefix}-${n}/${collection.id}`;
          n++;
        }
      }
      taken.add(id);
      out.push({ ...collection, id, rootDir: root });
    }
  }

  return out;
}

/**
 * Carga todas las raices abiertas y las junta.
 *
 * Vive aqui y no en la barra lateral porque la pantalla de GitHub tambien
 * recarga despues de traer ficheros: si lo hiciera por su cuenta con una sola
 * carpeta, borraria del store las colecciones de las demas.
 *
 * Una raiz que falle no tumba a las otras; se devuelve cuales fallaron.
 */
export async function loadAllRoots(): Promise<{ collections: Collection[]; failed: string[] }> {
  const { loadCollections } = await import("@/lib/tauri");
  const groups: { root: string; collections: Collection[] }[] = [];
  const failed: string[] = [];

  for (const root of getRoots()) {
    try {
      groups.push({ root, collections: await loadCollections(root) });
    } catch {
      failed.push(root);
    }
  }

  return { collections: mergeRootCollections(groups), failed };
}
