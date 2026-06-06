import { create } from "zustand";
import type { CollectionRequest, GrpcRequestFields } from "@/lib/tauri";

export type { CollectionRequest, GrpcRequestFields };

export interface CollectionFolder {
  id: string;
  name: string;
  expanded: boolean;
  requests: CollectionRequest[];
}

export interface Collection {
  id: string;
  name: string;
  baseUrl?: string;
  requests: CollectionRequest[];
  folders: CollectionFolder[];
  expanded: boolean;
}

interface CollectionsStore {
  collections: Collection[];
  activeRequestId: string | null;
  setActiveRequest: (id: string | null) => void;
  loadCollection: (collection: Collection) => void;
  addCollection: (collection: Collection) => void;
  toggleCollection: (id: string) => void;
  toggleFolder: (collectionId: string, folderId: string) => void;
  addRequest: (collectionId: string, request: CollectionRequest) => void;
  deleteRequest: (collectionId: string, requestId: string) => void;
  addFolder: (collectionId: string, folder: CollectionFolder) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
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

  toggleFolder: (collectionId, folderId) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              folders: c.folders.map((f) =>
                f.id === folderId ? { ...f, expanded: !f.expanded } : f
              ),
            }
          : c
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

  addFolder: (collectionId, folder) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, folders: [...c.folders, folder] }
          : c
      ),
    })),

  deleteFolder: (collectionId, folderId) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId
          ? { ...c, folders: c.folders.filter((f) => f.id !== folderId) }
          : c
      ),
    })),
}));
