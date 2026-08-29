/**
 * Ultima version remota conocida de cada coleccion.
 *
 * Es lo que permite responder a "¿ha escrito alguien despues de mi?": el
 * cliente manda esta version como base y el servidor rechaza el guardado si ya
 * no coincide con la suya.
 *
 * Vive aqui y no en el YAML de la coleccion a proposito. Esos ficheros se
 * suben a repositorios de git desde la pantalla de GitHub, y un contador del
 * servidor no es contenido de la coleccion: seria ruido en cada diff, y dos
 * personas compartiendo el fichero se intercambiarian el estado de sync la una
 * de la otra. Es estado de este dispositivo y se queda en este dispositivo.
 *
 * Perderlo no corrompe nada. Sin base conocida, el servidor devuelve conflicto
 * en vez de dejar pisar, que es justo el comportamiento seguro.
 */

const KEY = "flux-collection-versions";

type VersionMap = Record<string, number>;

function read(): VersionMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as VersionMap) : {};
  } catch {
    return {};
  }
}

function write(map: VersionMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Cuota llena o almacenamiento bloqueado. Se pierde la base y el proximo
    // guardado saldra como conflicto: molesto, pero nunca destructivo.
  }
}

/** `null` si nunca se ha sincronizado esta coleccion en esta maquina. */
export function getKnownVersion(id: string): number | null {
  return read()[id] ?? null;
}

export function setKnownVersion(id: string, version: number): void {
  const map = read();
  map[id] = version;
  write(map);
}

export function forgetVersion(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}
