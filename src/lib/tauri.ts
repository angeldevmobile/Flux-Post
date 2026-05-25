import { invoke } from "@tauri-apps/api/core";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
  sslVerify?: boolean;
  proxyHttp?: string;
  proxyHttps?: string;
  noProxy?: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  size: number;
}

export interface HistoryEntry {
  id: number;
  method: HttpMethod;
  url: string;
  status: number;
  durationMs: number;
  timestamp: string;
}

export async function sendRequest(request: HttpRequest): Promise<HttpResponse> {
  return invoke("send_request", { request });
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return invoke("get_history");
}

export async function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

export async function saveHistory(
  method: string,
  url: string,
  status: number,
  durationMs: number
): Promise<void> {
  return invoke("save_history", { method, url, status, durationMs });
}

export interface CollectionRequest {
  id: string;
  name: string;
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body?: string;
  tests: { assert: string }[];
}

export interface Collection {
  id: string;
  name: string;
  baseUrl?: string;
  requests: CollectionRequest[];
  expanded: boolean;
}

export async function loadCollections(dir: string): Promise<Collection[]> {
  return invoke("load_collections", { dir });
}

export async function saveCollection(dir: string, collection: Collection): Promise<void> {
  return invoke("save_collection", { dir, collection });
}

export async function generateTests(
  request: { method: string; url: string; body?: string },
  response: { status: number; body: string },
  apiKey: string,
  model?: string,
): Promise<string> {
  return invoke("generate_tests", { request, response, apiKey, model: model ?? null });
}

export async function wsConnect(url: string): Promise<string> {
  return invoke("ws_connect", { url });
}

export async function wsSend(connectionId: string, message: string): Promise<void> {
  return invoke("ws_send", { connectionId, message });
}

export async function wsDisconnect(connectionId: string): Promise<void> {
  return invoke("ws_disconnect", { connectionId });
}

export async function debugAssist(
  request: { method: string; url: string; headers?: Record<string, string>; body?: string },
  response: { status: number; body: string },
  apiKey: string,
  model?: string,
): Promise<string> {
  return invoke("debug_assist", { request, response, apiKey, model: model ?? null });
}

export function exportDataAsJson(data: object, filename = "flux-export.json"): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
