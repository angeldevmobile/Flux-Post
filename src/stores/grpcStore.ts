import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GrpcService, GrpcResponse } from "@/lib/tauri";

export interface GrpcMetadataEntry {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface GrpcStore {
  protoId: string | null;
  protoText: string;
  services: GrpcService[];
  endpoint: string;
  useTls: boolean;
  selectedService: string | null;
  selectedMethod: string | null;
  payload: string;
  metadata: GrpcMetadataEntry[];
  response: GrpcResponse | null;
  isLoading: boolean;
  error: string | null;

  setProtoId: (id: string | null) => void;
  setProtoText: (text: string) => void;
  setServices: (services: GrpcService[]) => void;
  setEndpoint: (endpoint: string) => void;
  setUseTls: (v: boolean) => void;
  setSelectedService: (service: string | null) => void;
  setSelectedMethod: (method: string | null) => void;
  setPayload: (payload: string) => void;
  setMetadata: (entries: GrpcMetadataEntry[]) => void;
  setResponse: (response: GrpcResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useGrpcStore = create<GrpcStore>()(
  persist(
    (set) => ({
      protoId: null,
      protoText: "",
      services: [],
      endpoint: "http://localhost:50051",
      useTls: false,
      selectedService: null,
      selectedMethod: null,
      payload: "{\n  \n}",
      metadata: [],
      response: null,
      isLoading: false,
      error: null,

      setProtoId: (protoId) => set({ protoId }),
      setProtoText: (protoText) => set({ protoText }),
      setServices: (services) => set({ services }),
      setEndpoint: (endpoint) => set({ endpoint }),
      setUseTls: (useTls) => set({ useTls }),
      setSelectedService: (selectedService) => set({ selectedService, selectedMethod: null }),
      setSelectedMethod: (selectedMethod) => set({ selectedMethod }),
      setPayload: (payload) => set({ payload }),
      setMetadata: (metadata) => set({ metadata }),
      setResponse: (response) => set({ response }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
    }),
    {
      name: "flux-grpc",
      partialize: (state) => ({
        endpoint: state.endpoint,
        useTls: state.useTls,
        protoText: state.protoText,
        services: state.services,
        payload: state.payload,
        metadata: state.metadata,
        selectedService: state.selectedService,
        selectedMethod: state.selectedMethod,
      }),
    }
  )
);
