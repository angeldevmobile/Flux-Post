/**
 * Estado de sincronizacion de cada coleccion en esta maquina: sobre que version
 * remota se edito, y si hay cambios locales que todavia no han llegado al
 * servidor.
 *
 * `version` responde a "¿ha escrito alguien despues de mi?": se manda como base
 * y el servidor rechaza el guardado si ya no coincide con la suya.
 *
 * `dirty` responde a "¿puedo adoptar el remoto sin perder nada?". Se marca
 * ANTES de intentar el push y solo se limpia cuando el servidor confirma, de
 * modo que cualquier interrupcion —sin red, la app cerrada a media escritura,
 * un conflicto— deja la marca puesta. El error cae siempre del lado de
 * preguntar en vez del de pisar.
 *
 * Vive aqui y no en el YAML de la coleccion a proposito. Esos ficheros se
 * suben a repositorios de git desde la pantalla de GitHub, y esto no es
 * contenido de la coleccion: seria ruido en cada diff, y dos personas
 * compartiendo el fichero se intercambiarian el estado de sync la una de la
 * otra. Es estado de este dispositivo y se queda en este dispositivo.
 *
 * Perderlo no corrompe nada. Sin base conocida, el servidor devuelve conflicto
 * en vez de dejar pisar, que es el comportamiento seguro.
 */

const KEY = "flux-collection-versions";

export interface SyncEntry {
  /** `null` si nunca se ha confirmado un guardado de esta coleccion. */
  version: number | null;
  dirty: boolean;
}

/** El formato anterior guardaba solo el numero. */
type StoredMap = Record<string, number | SyncEntry>;

function read(): Record<string, SyncEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const stored = JSON.parse(raw) as StoredMap;
    const out: Record<string, SyncEntry> = {};
    for (const [id, value] of Object.entries(stored)) {
      out[id] = typeof value === "number" ? { version: value, dirty: false } : value;
    }
    return out;
  } catch {
    return {};
  }
}

function write(map: Record<string, SyncEntry>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Cuota llena o almacenamiento bloqueado. Se pierde la base y el proximo
    // guardado saldra como conflicto: molesto, pero nunca destructivo.
  }
}

/** `null` si esta coleccion no se ha sincronizado nunca en esta maquina. */
export function getEntry(id: string): SyncEntry | null {
  return read()[id] ?? null;
}

/** Hay cambios locales sin confirmar por el servidor. */
export function markDirty(id: string): void {
  const map = read();
  map[id] = { version: map[id]?.version ?? null, dirty: true };
  write(map);
}

/** El servidor confirmo el guardado, o se acaba de adoptar su version. */
export function markSynced(id: string, version: number): void {
  const map = read();
  map[id] = { version, dirty: false };
  write(map);
}

export function forget(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

/** Que hacer con una coleccion que el servidor devuelve al sincronizar. */
export type PullDecision =
  /** No esta en esta maquina: traerla. */
  | "take"
  /** Existe en los dos lados sin base registrada: anotar version, no tocar contenido. */
  | "seed"
  /** Al dia, o lo local va por delante y ya se subira. */
  | "skip"
  /** El remoto ha avanzado y aqui no hay nada pendiente: adoptarlo. */
  | "adopt"
  /** Ha avanzado en los dos sitios: que decida el usuario. */
  | "conflict";

/**
 * La decision, aislada de Supabase y del disco para poder probarla.
 *
 * Es el punto del sync donde un fallo se traduce directamente en trabajo
 * perdido, asi que conviene que sea una tabla legible y no una escalera de
 * condiciones repartida entre efectos secundarios.
 */
export function decidePull(
  existsLocally: boolean,
  entry: SyncEntry | null,
  remoteVersion: number,
): PullDecision {
  if (!existsLocally) return "take";
  if (!entry || entry.version === null) return "seed";
  if (remoteVersion <= entry.version) return "skip";
  return entry.dirty ? "conflict" : "adopt";
}
