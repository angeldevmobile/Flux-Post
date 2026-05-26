import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";

interface UserStore {
  user: User | null;
  session: Session | null;
  setSession: (session: Session | null) => void;
  clearSession: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  session: null,
  setSession: (session) => set({ session, user: session?.user ?? null }),
  clearSession: () => set({ session: null, user: null }),
}));
