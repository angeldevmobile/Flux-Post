import { create } from "zustand";
import type { Route } from "@/components/NavRail";

interface NavStore {
  pendingRoute: Route | null;
  navigate: (route: Route) => void;
  clearPending: () => void;
  /**
   * Un link compartido que llego por `flux://share/…` y espera a que la barra
   * lateral lo abra. Vive aqui porque el deep link llega en `App` y la barra
   * puede no estar montada todavia.
   */
  pendingShareId: string | null;
  openShare: (id: string) => void;
  clearShare: () => void;
}

export const useNavStore = create<NavStore>((set) => ({
  pendingRoute: null,
  navigate: (route) => set({ pendingRoute: route }),
  clearPending: () => set({ pendingRoute: null }),
  pendingShareId: null,
  openShare: (id) => set({ pendingShareId: id, pendingRoute: "collections" }),
  clearShare: () => set({ pendingShareId: null }),
}));
