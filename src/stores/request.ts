import { create } from "zustand";
import type { HttpMethod, HttpRequest, HttpResponse } from "@/lib/tauri";

interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface RequestStore {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  bodyType: "none" | "json" | "form" | "raw";
  response: HttpResponse | null;
  isLoading: boolean;
  error: string | null;

  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setParams: (params: KeyValue[]) => void;
  setBody: (body: string) => void;
  setBodyType: (type: RequestStore["bodyType"]) => void;
  setResponse: (response: HttpResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getRequest: () => HttpRequest;
  reset: () => void;
}

const defaultState = {
  method: "GET" as HttpMethod,
  url: "",
  headers: [],
  params: [],
  body: "",
  bodyType: "none" as const,
  response: null,
  isLoading: false,
  error: null,
};

export const useRequestStore = create<RequestStore>((set, get) => ({
  ...defaultState,

  setMethod: (method) => set({ method }),
  setUrl: (url) => set({ url }),
  setHeaders: (headers) => set({ headers }),
  setParams: (params) => set({ params }),
  setBody: (body) => set({ body }),
  setBodyType: (bodyType) => set({ bodyType }),
  setResponse: (response) => set({ response }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  getRequest: (): HttpRequest => {
    const s = get();
    const headers: Record<string, string> = {};
    for (const h of s.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value;
    }
    let url = s.url;
    const enabledParams = s.params.filter((p) => p.enabled && p.key);
    if (enabledParams.length > 0) {
      const qs = enabledParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
      url = url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
    }
    return {
      method: s.method,
      url,
      headers,
      body: s.bodyType !== "none" ? s.body : undefined,
    };
  },

  reset: () => set(defaultState),
}));
