import { create } from "zustand";
import type { Route } from "@/components/NavRail";

interface NavStore {
  pendingRoute: Route | null;
  navigate: (route: Route) => void;
  clearPending: () => void;
}

export const useNavStore = create<NavStore>((set) => ({
  pendingRoute: null,
  navigate: (route) => set({ pendingRoute: route }),
  clearPending: () => set({ pendingRoute: null }),
}));
