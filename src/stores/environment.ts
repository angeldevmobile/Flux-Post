import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
  secretKeys?: string[];
  protected?: boolean;
}

interface EnvironmentStore {
  environments: Environment[];
  activeId: string | null;
  globalVariables: Record<string, string>;
  globalSecretKeys: string[];

  setActive: (id: string | null) => void;
  addEnvironment: (env: Environment) => void;
  updateEnvironment: (id: string, updates: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  toggleSecretKey: (envId: string, key: string) => void;

  setGlobalVariable: (key: string, value: string) => void;
  deleteGlobalVariable: (key: string) => void;
  toggleGlobalSecretKey: (key: string) => void;

  resolveVariable: (value: string) => string;
}

export const useEnvironmentStore = create<EnvironmentStore>()(
  persist(
    (set, get) => ({
      environments: [
        { id: "default", name: "No environment", variables: {} },
      ],
      activeId: null,
      globalVariables: {},
      globalSecretKeys: [],

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

      toggleSecretKey: (envId, key) =>
        set((s) => ({
          environments: s.environments.map((e) => {
            if (e.id !== envId) return e;
            const keys = e.secretKeys ?? [];
            return {
              ...e,
              secretKeys: keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key],
            };
          }),
        })),

      setGlobalVariable: (key, value) =>
        set((s) => ({ globalVariables: { ...s.globalVariables, [key]: value } })),

      deleteGlobalVariable: (key) =>
        set((s) => {
          const next = { ...s.globalVariables };
          delete next[key];
          return { globalVariables: next, globalSecretKeys: s.globalSecretKeys.filter(k => k !== key) };
        }),

      toggleGlobalSecretKey: (key) =>
        set((s) => ({
          globalSecretKeys: s.globalSecretKeys.includes(key)
            ? s.globalSecretKeys.filter(k => k !== key)
            : [...s.globalSecretKeys, key],
        })),

      resolveVariable: (value) => {
        const { environments, activeId, globalVariables } = get();
        const env = environments.find((e) => e.id === activeId);
        return value.replace(/\{\{([^}]+)\}\}/g, (original, key: string) => {
          // Dynamic built-ins
          if (key === "$guid") return crypto.randomUUID();
          if (key === "$timestamp") return String(Date.now());
          if (key === "$isoTimestamp") return new Date().toISOString();
          if (key === "$randomInt") return String(Math.floor(Math.random() * 1000));

          // Global variables
          if (key in globalVariables) return globalVariables[key];

          // Environment variables
          if (env && key in env.variables) return env.variables[key];

          return original;
        });
      },
    }),
    { name: "flux-environments" }
  )
);
