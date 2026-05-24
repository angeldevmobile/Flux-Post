import { create } from "zustand";
import type { HttpMethod } from "@/lib/tauri";

export interface CollectionRequest {
  id: string;
  name: string;
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface Collection {
  id: string;
  name: string;
  baseUrl?: string;
  requests: CollectionRequest[];
  expanded: boolean;
}

interface CollectionsStore {
  collections: Collection[];
  activeRequestId: string | null;
  setActiveRequest: (id: string | null) => void;
  loadCollection: (collection: Collection) => void;
  addCollection: (collection: Collection) => void;
  toggleCollection: (id: string) => void;
  addRequest: (collectionId: string, request: CollectionRequest) => void;
  deleteRequest: (collectionId: string, requestId: string) => void;
}

export const useCollectionsStore = create<CollectionsStore>((set) => ({
  collections: [],
  activeRequestId: null,

  setActiveRequest: (id) => set({ activeRequestId: id }),

  loadCollection: (collection) =>
    set((s) => {
      const exists = s.collections.find((c) => c.id === collection.id);
      if (exists) return s;
      return { collections: [...s.collections, collection] };
    }),

  addCollection: (collection) =>
    set((s) => ({ collections: [...s.collections, collection] })),

  toggleCollection: (id) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, expanded: !c.expanded } : c
      ),
    })),

  addRequest: (collectionId, request) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, requests: [...c.requests, request] }
          : c
      ),
    })),

  deleteRequest: (collectionId, requestId) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, requests: c.requests.filter((r) => r.id !== requestId) }
          : c
      ),
    })),
}));
