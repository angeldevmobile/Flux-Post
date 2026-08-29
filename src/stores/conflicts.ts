import { create } from "zustand";
import type { Collection } from "@/stores/collections";

/**
 * Una coleccion que cambio en los dos sitios y necesita que alguien decida.
 *
 * Se levanta desde dos puntos: al guardar, cuando el servidor rechaza la base
 * (`pushCollection`), y al sincronizar, cuando el remoto ha avanzado y aqui
 * hay cambios sin confirmar (`pullCollections`).
 */
export interface Conflict {
  id: string;
  name: string;
  /** Lo que hay en esta maquina. */
  local: Collection;
  /** Lo que hay en el servidor ahora mismo. */
  remote: Collection;
  /** La version del servidor: es la base que hay que declarar para pisarla. */
  remoteVersion: number;
}

interface ConflictsStore {
  conflicts: Conflict[];
  raise: (conflict: Conflict) => void;
  clear: (id: string) => void;
}

export const useConflictsStore = create<ConflictsStore>((set) => ({
  conflicts: [],

  raise: (conflict) =>
    set((s) => ({
      // Un solo conflicto por coleccion: el ultimo trae el estado mas reciente
      // del servidor, y resolver contra una foto vieja volveria a chocar.
      conflicts: [...s.conflicts.filter((c) => c.id !== conflict.id), conflict],
    })),

  clear: (id) =>
    set((s) => ({ conflicts: s.conflicts.filter((c) => c.id !== id) })),
}));
