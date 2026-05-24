import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
  protected?: boolean;
}

interface EnvironmentStore {
  environments: Environment[];
  activeId: string | null;
  setActive: (id: string | null) => void;
  addEnvironment: (env: Environment) => void;
  updateEnvironment: (id: string, updates: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  resolveVariable: (value: string) => string;
}

export const useEnvironmentStore = create<EnvironmentStore>()(
  persist(
    (set, get) => ({
      environments: [
        {
          id: "default",
          name: "No environment",
          variables: {},
        },
      ],
      activeId: null,

      setActive: (id) => set({ activeId: id }),

      addEnvironment: (env) =>
        set((s) => ({ environments: [...s.environments, env] })),

      updateEnvironment: (id, updates) =>
        set((s) => ({
          environments: s.environments.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),

      deleteEnvironment: (id) =>
        set((s) => ({
          environments: s.environments.filter((e) => e.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),

      resolveVariable: (value) => {
        const { environments, activeId } = get();
        const env = environments.find((e) => e.id === activeId);
        if (!env) return value;
        return value.replace(/\{\{(\w+)\}\}/g, (_, key) => env.variables[key] ?? `{{${key}}}`);
      },
    }),
    { name: "flux-environments" }
  )
);
