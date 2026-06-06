import { create } from "zustand";
import { grpcLoadProtos, grpcSaveProto, grpcDeleteProto, type SavedProtoMeta } from "@/lib/tauri";

interface ProtoLibraryStore {
  protos: SavedProtoMeta[];
  loaded: boolean;

  load: () => Promise<void>;
  save: (name: string, source: string, protoId: string) => Promise<SavedProtoMeta>;
  remove: (id: string) => Promise<void>;
}

export const useProtoLibraryStore = create<ProtoLibraryStore>((set, get) => ({
  protos: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const protos = await grpcLoadProtos();
    set({ protos, loaded: true });
  },

  save: async (name, source, protoId) => {
    const meta = await grpcSaveProto(name, source, protoId);
    set((s) => ({ protos: [...s.protos, meta] }));
    return meta;
  },

  remove: async (id) => {
    await grpcDeleteProto(id);
    set((s) => ({ protos: s.protos.filter((p) => p.id !== id) }));
  },
}));
