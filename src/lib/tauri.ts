import { invoke } from "@tauri-apps/api/core";

export type HttpMethod = "GET" | "POST" | "QUERY" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface MultipartField {
  key: string;
  value?: string;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  enabled: boolean;
}

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  multipartFields?: MultipartField[];
  timeoutMs?: number;
  followRedirects?: boolean;
  sslVerify?: boolean;
  proxyHttp?: string;
  proxyHttps?: string;
  noProxy?: string;
  proxySslVerify?: boolean;
  clientCertPem?: string;
  clientKeyPem?: string;
  useCookies?: boolean;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  setCookies: string[];
  sentCookies: string[];
  body: string;
  durationMs: number;
  ttfbMs: number;
  downloadMs: number;
  size: number;
  bodyEncoding: "text" | "base64";
}

export interface CookieEntry {
  domain: string;
  path: string;
  name: string;
  value: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  hostOnly: boolean;
}

export interface HistoryEntry {
  id: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  timestamp: string;
  environment: string;
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

export interface RestoreEntry {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  environment: string;
  timestamp: string;
}

export async function restoreHistory(entries: RestoreEntry[]): Promise<void> {
  return invoke("restore_history", { entries });
}

export interface SessionRow {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  userEmail?: string;
  userName?: string;
  userAvatar?: string;
}

export async function saveSession(s: SessionRow): Promise<void> {
  return invoke("save_session", {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken ?? null,
    expiresAt: s.expiresAt ?? null,
    userId: s.userId ?? null,
    userEmail: s.userEmail ?? null,
    userName: s.userName ?? null,
    userAvatar: s.userAvatar ?? null,
  });
}

export async function loadSession(): Promise<SessionRow | null> {
  return invoke("load_session");
}

export async function clearSessionDb(): Promise<void> {
  return invoke("clear_session");
}

export async function startOAuthCallback(): Promise<number> {
  return invoke("start_oauth_callback");
}

export async function saveHistory(
  method: string,
  url: string,
  status: number,
  durationMs: number,
  environment: string
): Promise<void> {
  return invoke("save_history", { method, url, status, durationMs, environment });
}

export interface GrpcRequestFields {
  endpoint?: string;
  service?: string;
  method?: string;
  payload?: string;
  metadata: Record<string, string>;
  protoId?: string;
  protoName?: string;
}

export interface CollectionRequest {
  id: string;
  name: string;
  kind?: "http" | "grpc";
  // HTTP
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body?: string;
  bodyType?: string;
  tests: { assert: string }[];
  // gRPC
  grpc?: GrpcRequestFields;
}

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

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
}

export async function oauthAuthCode(params: {
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
}): Promise<number> {
  return invoke("oauth_auth_code", {
    clientId: params.clientId,
    clientSecret: params.clientSecret ?? null,
    authUrl: params.authUrl,
    tokenUrl: params.tokenUrl,
    scopes: params.scopes,
  });
}

export async function oauthClientCredentials(params: {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scopes: string;
}): Promise<OAuthToken> {
  return invoke("oauth_client_credentials", params);
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

export async function editContent(
  content: string,
  instruction: string,
  language: string,
  apiKey: string,
  model?: string,
): Promise<string> {
  return invoke("edit_content", { content, instruction, language, apiKey, model: model ?? null });
}

export interface AssertionFix {
  kind: "assertion" | "body" | "header";
  value: string;
  explanation: string;
}

export async function fixAssertion(
  assertion: string,
  actualStatus: number,
  actualBody: string,
  reqMethod: string,
  reqUrl: string,
  reqBody: string | undefined,
  apiKey: string,
  model?: string,
): Promise<AssertionFix> {
  return invoke("fix_assertion", {
    assertion,
    actualStatus,
    actualBody,
    reqMethod,
    reqUrl,
    reqBody: reqBody ?? null,
    apiKey,
    model: model ?? null,
  });
}

export async function analyzeTestFailures(
  failuresJson: string,
  apiKey: string,
  model?: string,
): Promise<string> {
  return invoke("analyze_test_failures", { failuresJson, apiKey, model: model ?? null });
}

export async function sseConnect(
  url: string,
  headers: Record<string, string> = {}
): Promise<string> {
  return invoke("sse_connect", { url, headers });
}

export async function sseDisconnect(connectionId: string): Promise<void> {
  return invoke("sse_disconnect", { connectionId });
}

export async function getAllCookies(): Promise<CookieEntry[]> {
  return invoke("get_all_cookies");
}

export async function deleteCookie(domain: string, name: string, path: string): Promise<void> {
  return invoke("delete_cookie", { domain, name, path });
}

export async function clearCookies(domain?: string): Promise<void> {
  return invoke("clear_cookies", { domain: domain ?? null });
}

//   Load Test                                  

export interface LoadRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  total: number;
  concurrency: number;
  timeoutMs?: number;
}

export interface LoadTestProgress {
  completed: number;
  errors: number;
  total: number;
  rps: number;
  avgMs: number;
}

export interface LoadTestResult {
  total: number;
  completed: number;
  errors: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughput: number;
  errorRate: number;
  durationSecs: number;
  latencies: number[];
}

export async function runLoadTest(request: LoadRequest): Promise<LoadTestResult> {
  return invoke("run_load_test", { request });
}

//   Mock Server                                 

export interface MockEndpoint {
  id: string;
  method: string;
  path: string;
  status: number;
  body: string;
  contentType: string;
  delayMs: number;
  enabled: boolean;
}

export interface MockStatus {
  running: boolean;
  port: number;
  endpointCount: number;
}

export async function startMockServer(port: number): Promise<void> {
  return invoke("start_mock_server", { port });
}

export async function stopMockServer(): Promise<void> {
  return invoke("stop_mock_server");
}

export async function setMockEndpoints(endpoints: MockEndpoint[]): Promise<void> {
  return invoke("set_mock_endpoints", { endpoints });
}

export async function getMockEndpoints(): Promise<MockEndpoint[]> {
  return invoke("get_mock_endpoints");
}

export async function getMockStatus(): Promise<MockStatus> {
  return invoke("get_mock_status");
}

//   gRPC                                    

export interface GrpcField {
  name: string;
  kind: string;
  typeName: string;
  repeated: boolean;
  optional: boolean;
}

export interface GrpcMethod {
  name: string;
  inputType: string;
  outputType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputFields: GrpcField[];
}

export interface GrpcService {
  name: string;
  fullName: string;
  methods: GrpcMethod[];
}

export interface GrpcProtoInfo {
  id: string;
  services: GrpcService[];
}

export interface GrpcResponse {
  body: string;
  durationMs: number;
  trailers: Record<string, string>;
}

export async function grpcImportProto(protoContent: string): Promise<GrpcProtoInfo> {
  return invoke("grpc_import_proto", { protoContent });
}

export async function grpcReflect(endpoint: string, useTls: boolean): Promise<GrpcProtoInfo> {
  return invoke("grpc_reflect", { endpoint, useTls });
}

export interface SavedProtoMeta {
  id: string;
  name: string;
  source: string;
  services: GrpcService[];
  createdAt: string;
}

export async function grpcLoadProtos(): Promise<SavedProtoMeta[]> {
  return invoke("grpc_load_protos");
}

export async function grpcSaveProto(name: string, source: string, protoId: string): Promise<SavedProtoMeta> {
  return invoke("grpc_save_proto", { name, source, protoId });
}

export async function grpcDeleteProto(id: string): Promise<void> {
  return invoke("grpc_delete_proto", { id });
}

export async function grpcRenameProto(id: string, name: string): Promise<void> {
  return invoke("grpc_rename_proto", { id, name });
}

export async function grpcLoadProtoById(id: string): Promise<GrpcProtoInfo> {
  return invoke("grpc_load_proto_by_id", { id });
}

export async function grpcInvoke(
  endpoint: string,
  service: string,
  method: string,
  payloadJson: string,
  metadata: Record<string, string>,
  useTls: boolean,
  protoId: string,
): Promise<GrpcResponse> {
  return invoke("grpc_invoke", { endpoint, service, method, payloadJson, metadata, useTls, protoId });
}

/** `payload` is the decoded JSON message, or the error / close reason. */
export interface GrpcStreamEvent {
  streamId: string;
  payload: string;
  seq: number;
}

/** Opens a streaming call. Frames arrive as `grpc-stream-message` events.
 *  For client-streaming and bidi, `payloadJson` seeds the first message. */
export async function grpcStreamOpen(
  endpoint: string,
  service: string,
  method: string,
  payloadJson: string,
  metadata: Record<string, string>,
  useTls: boolean,
  protoId: string,
): Promise<string> {
  return invoke("grpc_stream_open", { endpoint, service, method, payloadJson, metadata, useTls, protoId });
}

export async function grpcStreamSend(streamId: string, payloadJson: string): Promise<void> {
  return invoke("grpc_stream_send", { streamId, payloadJson });
}

/** Signals end-of-stream so the server can finish. */
export async function grpcStreamCloseSend(streamId: string): Promise<void> {
  return invoke("grpc_stream_close_send", { streamId });
}

export async function grpcStreamCancel(streamId: string): Promise<void> {
  return invoke("grpc_stream_cancel", { streamId });
}

export interface GitHubFileEntry {
  name: string;
  content: string;
}

export async function githubListYamlFiles(dir: string): Promise<GitHubFileEntry[]> {
  return invoke("github_list_yaml_files", { dir });
}

export async function githubWriteYamlFile(dir: string, name: string, content: string): Promise<void> {
  return invoke("github_write_yaml_file", { dir, name, content });
}

export async function deleteYamlFile(dir: string, name: string): Promise<void> {
  return invoke("delete_yaml_file", { dir, name });
}

export async function githubWriteYamlFileSubdir(dir: string, subdir: string, name: string, content: string): Promise<void> {
  return invoke("github_write_yaml_file_subdir", { dir, subdir, name, content });
}

export async function clearRootYamlFiles(dir: string): Promise<void> {
  return invoke("clear_root_yaml_files", { dir });
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
