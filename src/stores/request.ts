import { create } from "zustand";
import type { HttpMethod, HttpRequest, HttpResponse } from "@/lib/tauri";

export interface MultipartItem {
  id: string;
  key: string;
  enabled: boolean;
  isFile: boolean;
  value: string;       // text value
  fileBase64: string;  // base64 content when isFile
  fileName: string;
  mimeType: string;
}

interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type AuthType = "none" | "bearer" | "basic" | "apikey" | "oauth2" | "awssigv4";
export type ApiKeyTarget = "header" | "query";
export type OAuthGrantType = "authorization_code" | "client_credentials";

interface RequestStore {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  bodyType: "none" | "json" | "form" | "multipart" | "binary" | "raw" | "graphql";
  formFields: KeyValue[];
  multipartItems: MultipartItem[];
  binaryFileBase64: string;
  binaryFileName: string;
  binaryMimeType: string;
  graphqlQuery: string;
  graphqlVariables: string;
  preRequestScript: string;
  postResponseScript: string;
  // auth
  authType: AuthType;
  authBearer: string;
  authBasicUser: string;
  authBasicPass: string;
  authApiKeyName: string;
  authApiKeyValue: string;
  authApiKeyIn: ApiKeyTarget;
  // oauth2
  authOAuthGrantType: OAuthGrantType;
  authOAuthClientId: string;
  authOAuthClientSecret: string;
  authOAuthAuthUrl: string;
  authOAuthTokenUrl: string;
  authOAuthScopes: string;
  authOAuthToken: string;
  authOAuthTokenExpiry: number | null;
  // aws sig v4
  authAwsRegion: string;
  authAwsService: string;
  authAwsAccessKeyId: string;
  authAwsSecretAccessKey: string;
  authAwsSessionToken: string;
  response: HttpResponse | null;
  isLoading: boolean;
  error: string | null;

  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setParams: (params: KeyValue[]) => void;
  setBody: (body: string) => void;
  setBodyType: (type: RequestStore["bodyType"]) => void;
  setFormFields: (fields: KeyValue[]) => void;
  setMultipartItems: (items: MultipartItem[]) => void;
  setBinaryFile: (base64: string, name: string, mime: string) => void;
  setGraphqlQuery: (query: string) => void;
  setGraphqlVariables: (variables: string) => void;
  setPreRequestScript: (script: string) => void;
  setPostResponseScript: (script: string) => void;
  setAuthType: (type: AuthType) => void;
  setAuthBearer: (token: string) => void;
  setAuthBasicUser: (user: string) => void;
  setAuthBasicPass: (pass: string) => void;
  setAuthApiKeyName: (name: string) => void;
  setAuthApiKeyValue: (value: string) => void;
  setAuthApiKeyIn: (target: ApiKeyTarget) => void;
  setAuthOAuthGrantType: (type: OAuthGrantType) => void;
  setAuthOAuthClientId: (v: string) => void;
  setAuthOAuthClientSecret: (v: string) => void;
  setAuthOAuthAuthUrl: (v: string) => void;
  setAuthOAuthTokenUrl: (v: string) => void;
  setAuthOAuthScopes: (v: string) => void;
  setAuthOAuthToken: (token: string, expiresIn?: number) => void;
  setAuthAwsRegion: (v: string) => void;
  setAuthAwsService: (v: string) => void;
  setAuthAwsAccessKeyId: (v: string) => void;
  setAuthAwsSecretAccessKey: (v: string) => void;
  setAuthAwsSessionToken: (v: string) => void;
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
  formFields: [] as KeyValue[],
  multipartItems: [] as MultipartItem[],
  binaryFileBase64: "",
  binaryFileName: "",
  binaryMimeType: "",
  graphqlQuery: "",
  graphqlVariables: "",
  preRequestScript: "",
  postResponseScript: "",
  authType: "none" as AuthType,
  authBearer: "",
  authBasicUser: "",
  authBasicPass: "",
  authApiKeyName: "X-API-Key",
  authApiKeyValue: "",
  authApiKeyIn: "header" as ApiKeyTarget,
  authOAuthGrantType: "authorization_code" as OAuthGrantType,
  authOAuthClientId: "",
  authOAuthClientSecret: "",
  authOAuthAuthUrl: "",
  authOAuthTokenUrl: "",
  authOAuthScopes: "",
  authOAuthToken: "",
  authOAuthTokenExpiry: null as number | null,
  authAwsRegion: "us-east-1",
  authAwsService: "execute-api",
  authAwsAccessKeyId: "",
  authAwsSecretAccessKey: "",
  authAwsSessionToken: "",
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
  setFormFields: (formFields) => set({ formFields }),
  setMultipartItems: (multipartItems) => set({ multipartItems }),
  setBinaryFile: (binaryFileBase64, binaryFileName, binaryMimeType) => set({ binaryFileBase64, binaryFileName, binaryMimeType }),
  setGraphqlQuery: (graphqlQuery) => set({ graphqlQuery }),
  setGraphqlVariables: (graphqlVariables) => set({ graphqlVariables }),
  setPreRequestScript: (preRequestScript) => set({ preRequestScript }),
  setPostResponseScript: (postResponseScript) => set({ postResponseScript }),
  setAuthType: (authType) => set({ authType }),
  setAuthBearer: (authBearer) => set({ authBearer }),
  setAuthBasicUser: (authBasicUser) => set({ authBasicUser }),
  setAuthBasicPass: (authBasicPass) => set({ authBasicPass }),
  setAuthApiKeyName: (authApiKeyName) => set({ authApiKeyName }),
  setAuthApiKeyValue: (authApiKeyValue) => set({ authApiKeyValue }),
  setAuthApiKeyIn: (authApiKeyIn) => set({ authApiKeyIn }),
  setAuthOAuthGrantType: (authOAuthGrantType) => set({ authOAuthGrantType }),
  setAuthOAuthClientId: (authOAuthClientId) => set({ authOAuthClientId }),
  setAuthOAuthClientSecret: (authOAuthClientSecret) => set({ authOAuthClientSecret }),
  setAuthOAuthAuthUrl: (authOAuthAuthUrl) => set({ authOAuthAuthUrl }),
  setAuthOAuthTokenUrl: (authOAuthTokenUrl) => set({ authOAuthTokenUrl }),
  setAuthOAuthScopes: (authOAuthScopes) => set({ authOAuthScopes }),
  setAuthOAuthToken: (authOAuthToken: string, expiresIn?: number) => set({
    authOAuthToken,
    authOAuthTokenExpiry: expiresIn ? Date.now() + expiresIn * 1000 : null,
  }),
  setAuthAwsRegion: (authAwsRegion) => set({ authAwsRegion }),
  setAuthAwsService: (authAwsService) => set({ authAwsService }),
  setAuthAwsAccessKeyId: (authAwsAccessKeyId) => set({ authAwsAccessKeyId }),
  setAuthAwsSecretAccessKey: (authAwsSecretAccessKey) => set({ authAwsSecretAccessKey }),
  setAuthAwsSessionToken: (authAwsSessionToken) => set({ authAwsSessionToken }),
  setResponse: (response) => set({ response }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  getRequest: (): HttpRequest => {
    const s = get();
    const headers: Record<string, string> = {};
    for (const h of s.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value;
    }

    // Apply auth
    if (s.authType === "bearer" && s.authBearer) {
      headers["Authorization"] = `Bearer ${s.authBearer}`;
    } else if (s.authType === "basic" && s.authBasicUser) {
      headers["Authorization"] = `Basic ${btoa(`${s.authBasicUser}:${s.authBasicPass}`)}`;
    } else if (s.authType === "apikey" && s.authApiKeyName && s.authApiKeyValue && s.authApiKeyIn === "header") {
      headers[s.authApiKeyName] = s.authApiKeyValue;
    } else if (s.authType === "oauth2" && s.authOAuthToken) {
      headers["Authorization"] = `Bearer ${s.authOAuthToken}`;
    }

    let url = s.url;
    const enabledParams = s.params.filter((p) => p.enabled && p.key);

    // API key in query
    if (s.authType === "apikey" && s.authApiKeyName && s.authApiKeyValue && s.authApiKeyIn === "query") {
      enabledParams.push({ id: "__apikey__", key: s.authApiKeyName, value: s.authApiKeyValue, enabled: true });
    }

    if (enabledParams.length > 0) {
      const qs = enabledParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
      url = url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
    }

    let body: string | undefined;
    let bodyBase64: string | undefined;
    let multipartFields: HttpRequest["multipartFields"];

    if (s.bodyType === "form") {
      const pairs = s.formFields
        .filter(f => f.enabled && f.key)
        .map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`);
      body = pairs.join("&");
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (s.bodyType === "multipart") {
      multipartFields = s.multipartItems
        .filter(f => f.enabled && f.key)
        .map(f => f.isFile
          ? { key: f.key, fileBase64: f.fileBase64, fileName: f.fileName, mimeType: f.mimeType || "application/octet-stream", enabled: true }
          : { key: f.key, value: f.value, enabled: true });
    } else if (s.bodyType === "binary" && s.binaryFileBase64) {
      bodyBase64 = s.binaryFileBase64;
      if (!headers["Content-Type"]) headers["Content-Type"] = s.binaryMimeType || "application/octet-stream";
    } else if (s.bodyType === "graphql") {
      let variables: unknown;
      try { variables = JSON.parse(s.graphqlVariables); } catch { /* omit if invalid */ }
      body = JSON.stringify({ query: s.graphqlQuery, ...(variables !== undefined ? { variables } : {}) });
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    } else if (s.bodyType !== "none") {
      body = s.body;
    }

    return { method: s.method, url, headers, body, bodyBase64, multipartFields };
  },

  reset: () => set(defaultState),
}));
