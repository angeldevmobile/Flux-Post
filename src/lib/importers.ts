import type { Collection, CollectionFolder, CollectionRequest } from "@/stores/collections";
import type { HttpMethod } from "@/lib/tauri";
import { HTTP_METHODS } from "@/lib/methods";

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toMethod(m: unknown): HttpMethod {
  const s = String(m ?? "GET").toUpperCase() as HttpMethod;
  return HTTP_METHODS.includes(s) ? s : "GET";
}

//    Postman v2.1                                                              

interface PostmanHeader { key: string; value: string; disabled?: boolean }
interface PostmanQuery { key: string; value?: string; disabled?: boolean }
interface PostmanUrl { raw?: string; query?: PostmanQuery[] }
interface PostmanKv { key: string; value: string; disabled?: boolean }
interface PostmanBody {
  mode?: string;
  raw?: string;
  urlencoded?: PostmanKv[];
  formdata?: PostmanKv[];
  graphql?: { query?: string; variables?: string };
}
interface PostmanAuth { type?: string; [scheme: string]: unknown }
interface PostmanScript { exec?: string[] | string }
interface PostmanEvent { listen?: string; script?: PostmanScript }
interface PostmanRequest {
  method?: string;
  header?: PostmanHeader[];
  url?: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
}
interface PostmanItem { name?: string; request?: PostmanRequest; item?: PostmanItem[]; event?: PostmanEvent[]; auth?: PostmanAuth }
interface PostmanCollection { info?: { name?: string }; item?: PostmanItem[]; auth?: PostmanAuth; variable?: PostmanKv[] }

/** Postman guarda cada esquema como un array de {key, value}. */
function authValues(auth: PostmanAuth, scheme: string): Record<string, string> {
  const raw = auth[scheme];
  if (!Array.isArray(raw)) return {};
  return Object.fromEntries(
    (raw as PostmanKv[]).filter(e => e?.key).map(e => [e.key, String(e.value ?? "")]),
  );
}

function postmanAuthToFlux(auth: PostmanAuth | undefined): CollectionRequest["auth"] {
  if (!auth?.type || auth.type === "noauth") return undefined;
  const v = authValues(auth, auth.type);

  switch (auth.type) {
    case "bearer":
      return { type: "bearer", token: v.token ?? "" };
    case "basic":
      return { type: "basic", username: v.username ?? "", password: v.password ?? "" };
    case "apikey":
      return { type: "apikey", key: v.key ?? "", value: v.value ?? "", in: v.in === "query" ? "query" : "header" };
    case "oauth2":
      return {
        type: "oauth2",
        grantType: v.grant_type ?? "client_credentials",
        clientId: v.clientId ?? "",
        clientSecret: v.clientSecret ?? "",
        authUrl: v.authUrl ?? "",
        tokenUrl: v.accessTokenUrl ?? v.tokenUrl ?? "",
        scopes: v.scope ?? "",
      };
    case "awsv4":
      return {
        type: "awsv4",
        accessKeyId: v.accessKey ?? "",
        secretAccessKey: v.secretKey ?? "",
        sessionToken: v.sessionToken ?? "",
        region: v.region ?? "",
        service: v.service ?? "",
      };
    default:
      return undefined;
  }
}

function execToString(script: PostmanScript | undefined): string | undefined {
  const exec = script?.exec;
  if (!exec) return undefined;
  const text = (Array.isArray(exec) ? exec.join("\n") : String(exec)).trim();
  return text || undefined;
}

function postmanScripts(events: PostmanEvent[] | undefined): CollectionRequest["scripts"] {
  const pre = execToString(events?.find(e => e.listen === "prerequest")?.script);
  const post = execToString(events?.find(e => e.listen === "test")?.script);
  if (!pre && !post) return undefined;
  return { ...(pre ? { preRequest: pre } : {}), ...(post ? { postResponse: post } : {}) };
}

/** Devuelve el cuerpo y el `bodyType` que le corresponde en Flux. */
function postmanBody(body: PostmanBody | undefined): Pick<CollectionRequest, "body" | "bodyType" | "form" | "graphql"> {
  if (!body?.mode) return {};

  if (body.mode === "graphql") {
    return {
      bodyType: "graphql",
      graphql: { query: body.graphql?.query ?? "", variables: body.graphql?.variables ?? "" },
    };
  }

  if (body.mode === "urlencoded" || body.mode === "formdata") {
    const fields = (body.mode === "urlencoded" ? body.urlencoded : body.formdata) ?? [];
    const form = Object.fromEntries(
      fields.filter(f => !f.disabled && f.key).map(f => [f.key, String(f.value ?? "")]),
    );
    return { bodyType: body.mode === "formdata" ? "multipart" : "form", form };
  }

  if (body.mode === "raw" && body.raw) {
    let bodyType = "raw";
    try { JSON.parse(body.raw); bodyType = "json"; } catch { /* no es JSON */ }
    return { body: body.raw, bodyType };
  }

  return {};
}

function postmanItemToRequest(
  item: PostmanItem,
  prefix: string,
  idx: number,
  inheritedAuth?: PostmanAuth,
): CollectionRequest | null {
  if (!item.request) return null;
  const req = item.request;
  const url = typeof req.url === "string" ? { raw: req.url } : (req.url ?? {});
  const rawUrl = url.raw ?? "";

  const headers: Record<string, string> = {};
  for (const h of req.header ?? []) {
    if (!h.disabled && h.key) headers[h.key] = h.value;
  }

  const params: Record<string, string> = {};
  for (const q of url.query ?? []) {
    if (!q.disabled && q.key) params[q.key] = String(q.value ?? "");
  }

  // El auth de la coleccion aplica a las requests que no traen el suyo.
  const auth = postmanAuthToFlux(req.auth ?? item.auth ?? inheritedAuth);
  const scripts = postmanScripts(item.event);

  return {
    id: `${prefix}-${idx}`,
    name: item.name ?? rawUrl,
    method: toMethod(req.method),
    path: rawUrl,
    headers,
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...postmanBody(req.body),
    ...(auth ? { auth } : {}),
    ...(scripts ? { scripts } : {}),
    tests: [],
  };
}

/** Postman anida carpetas sin limite; antes solo se leia el primer nivel. */
function postmanFolder(
  item: PostmanItem,
  id: string,
  inheritedAuth: PostmanAuth | undefined,
): CollectionFolder {
  const requests: CollectionRequest[] = [];
  const folders: CollectionFolder[] = [];
  const auth = item.auth ?? inheritedAuth;
  let ri = 0;
  let fi = 0;

  for (const sub of item.item ?? []) {
    if (sub.item) {
      folders.push(postmanFolder(sub, `${id}-f${fi++}`, auth));
    } else {
      const r = postmanItemToRequest(sub, id, ri++, auth);
      if (r) requests.push(r);
    }
  }

  return { id, name: item.name ?? "Folder", expanded: true, requests, folders };
}

export function importPostman(json: unknown): Collection {
  const col = json as PostmanCollection;
  const name = col.info?.name ?? "Imported Collection";
  const id = uuid();
  const requests: CollectionRequest[] = [];
  const folders: CollectionFolder[] = [];
  let reqIdx = 0;
  let folderIdx = 0;

  for (const item of col.item ?? []) {
    if (item.item) {
      folders.push(postmanFolder(item, `${id}-f${folderIdx++}`, col.auth));
    } else {
      const r = postmanItemToRequest(item, id, reqIdx++, col.auth);
      if (r) requests.push(r);
    }
  }

  return { id, name, requests, folders, expanded: true };
}

//    OpenAPI 3.0                                                               

interface OpenApiServer { url?: string }
interface OpenApiOperation {
  summary?: string; description?: string; operationId?: string; tags?: string[];
  parameters?: OpenApiParam[]; requestBody?: OpenApiRequestBody;
  security?: Record<string, unknown>[];
}
interface OpenApiSchema { type?: string; example?: unknown; properties?: Record<string, OpenApiSchema>; items?: OpenApiSchema; enum?: unknown[]; format?: string }
interface OpenApiParam { name: string; in: string; required?: boolean; example?: unknown; schema?: OpenApiSchema }
interface OpenApiRequestBody { content?: Record<string, { schema?: OpenApiSchema; example?: unknown }> }
interface OpenApiSecurityScheme { type?: string; scheme?: string; in?: string; name?: string; flows?: Record<string, { tokenUrl?: string; authorizationUrl?: string; scopes?: Record<string, string> }> }
interface OpenApiPathItem { get?: OpenApiOperation; post?: OpenApiOperation; put?: OpenApiOperation; patch?: OpenApiOperation; delete?: OpenApiOperation; head?: OpenApiOperation; options?: OpenApiOperation }
interface OpenApiDoc {
  info?: { title?: string };
  servers?: OpenApiServer[];
  paths?: Record<string, OpenApiPathItem>;
  components?: { securitySchemes?: Record<string, OpenApiSecurityScheme> };
  security?: Record<string, unknown>[];
}

// Operation keys defined by the OpenAPI path item object — QUERY is not one of them yet.
const OPENAPI_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** Muestra de valor a partir de un esquema, para cuando el spec no trae `example`. */
function sampleFromSchema(schema: OpenApiSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return schema.enum[0];

  switch (schema.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        out[k] = sampleFromSchema(v, depth + 1);
      }
      return out;
    }
    case "array":
      return [sampleFromSchema(schema.items, depth + 1)];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    case "string":
      if (schema.format === "date-time") return new Date(0).toISOString();
      if (schema.format === "date") return "1970-01-01";
      if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      return "";
    default:
      return null;
  }
}

/** El esquema de seguridad de OpenAPI en la forma de auth de Flux. */
function securityToAuth(scheme: OpenApiSecurityScheme | undefined): CollectionRequest["auth"] {
  if (!scheme?.type) return undefined;
  if (scheme.type === "http") {
    if (scheme.scheme === "bearer") return { type: "bearer", token: "" };
    if (scheme.scheme === "basic") return { type: "basic", username: "", password: "" };
    return undefined;
  }
  if (scheme.type === "apiKey") {
    return { type: "apikey", key: scheme.name ?? "", value: "", in: scheme.in === "query" ? "query" : "header" };
  }
  if (scheme.type === "oauth2") {
    const flow = scheme.flows?.clientCredentials ?? scheme.flows?.authorizationCode;
    return {
      type: "oauth2",
      grantType: scheme.flows?.clientCredentials ? "client_credentials" : "authorization_code",
      clientId: "", clientSecret: "",
      authUrl: flow?.authorizationUrl ?? "",
      tokenUrl: flow?.tokenUrl ?? "",
      scopes: Object.keys(flow?.scopes ?? {}).join(" "),
    };
  }
  return undefined;
}

/** Cuerpo y `bodyType` a partir del `requestBody` del spec. */
function openApiBody(rb: OpenApiRequestBody | undefined): Pick<CollectionRequest, "body" | "bodyType" | "form"> & { contentType?: string } {
  const content = rb?.content;
  if (!content) return {};

  const form = content["application/x-www-form-urlencoded"] ?? content["multipart/form-data"];
  if (form) {
    const multipart = !!content["multipart/form-data"];
    const example = (form.example ?? sampleFromSchema(form.schema)) as Record<string, unknown> | null;
    const fields = Object.fromEntries(
      Object.entries(example ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]),
    );
    return { bodyType: multipart ? "multipart" : "form", form: fields };
  }

  const [contentType, entry] = Object.entries(content)[0] ?? [];
  if (!entry) return {};
  const example = entry.example ?? sampleFromSchema(entry.schema);
  const isJson = (contentType ?? "").includes("json");
  return {
    contentType,
    bodyType: isJson ? "json" : "raw",
    body: isJson ? JSON.stringify(example ?? {}, null, 2) : String(example ?? ""),
  };
}

export function importOpenApi(json: unknown): Collection {
  const doc = json as OpenApiDoc;
  const name = doc.info?.title ?? "Imported API";
  const id = uuid();
  const baseUrl = doc.servers?.[0]?.url ?? "";

  // Group by tag
  const tagMap = new Map<string, CollectionRequest[]>();
  const untagged: CollectionRequest[] = [];
  let idx = 0;

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const httpMethod of OPENAPI_METHODS) {
      const op = pathItem[httpMethod];
      if (!op) continue;

      const opName = op.summary ?? op.operationId ?? `${httpMethod.toUpperCase()} ${path}`;
      const headers: Record<string, string> = {};
      const params: Record<string, string> = {};

      // Los parametros de ruta pasan a la sintaxis de variables de Flux, para
      // que se puedan rellenar desde un entorno en vez de quedar literales.
      let reqPath = path;
      for (const p of op.parameters ?? []) {
        const value = p.example ?? p.schema?.example;
        const text = value == null ? "" : String(value);
        if (p.in === "query") params[p.name] = text;
        else if (p.in === "header") headers[p.name] = text;
        else if (p.in === "path") reqPath = reqPath.replace(`{${p.name}}`, `{{${p.name}}}`);
      }

      const { contentType, ...bodyFields } = openApiBody(op.requestBody);
      if (contentType) headers["Content-Type"] = contentType;

      // El `security` de la operacion gana sobre el del documento.
      const schemeName = Object.keys((op.security ?? doc.security ?? [])[0] ?? {})[0];
      const auth = securityToAuth(
        schemeName ? doc.components?.securitySchemes?.[schemeName] : undefined,
      );

      const req: CollectionRequest = {
        id: `${id}-${idx++}`,
        name: opName,
        method: toMethod(httpMethod),
        path: reqPath,
        headers,
        ...(Object.keys(params).length > 0 ? { params } : {}),
        ...bodyFields,
        ...(auth ? { auth } : {}),
        tests: [],
      };

      const tag = op.tags?.[0];
      if (tag) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(req);
      } else {
        untagged.push(req);
      }
    }
  }

  // Folders from tags
  const folders: CollectionFolder[] = [];
  let fi = 0;
  for (const [tag, reqs] of tagMap.entries()) {
    const fid = `${id}-f${fi++}`;
    // Re-id requests with folder prefix
    const folderReqs = reqs.map((r, i) => ({ ...r, id: `${fid}-${i}` }));
    folders.push({ id: fid, name: tag, expanded: true, requests: folderReqs });
  }

  return { id, name, baseUrl: baseUrl || undefined, requests: untagged, folders, expanded: true };
}

//    cURL                                                                      

export function importCurl(command: string): CollectionRequest {
  const id = uuid();
  let method = "GET";
  let url = "";
  const headers: Record<string, string> = {};
  let body: string | undefined;

  // Normalize line continuations and collapse whitespace
  const flat = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();

  // The URL is positional and can sit anywhere among the flags. Headers and
  // bodies are blanked first so a URL inside one is not mistaken for it.
  const scan = flat
    .replace(/-H\s+(['"]).*?\1/g, " ")
    .replace(/(?:--data(?:-raw|-binary|-urlencode)?|-d)\s+(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S+)/g, " ");
  const urlMatch = scan.match(/(['"]?)(https?:\/\/[^\s'"]+)\1/);
  if (urlMatch) url = urlMatch[2];

  // -X method
  const mMatch = flat.match(/-X\s+([A-Z]+)/i);
  const explicitMethod = !!mMatch;
  if (mMatch) method = mMatch[1].toUpperCase();

  // Headers (-H)
  const hRe = /-H\s+['"]([^'"]+)['"]/g;
  let hm: RegExpExecArray | null;
  while ((hm = hRe.exec(flat)) !== null) {
    const colon = hm[1].indexOf(":");
    if (colon > 0) {
      headers[hm[1].slice(0, colon).trim()] = hm[1].slice(colon + 1).trim();
    }
  }

  // The quoted argument is matched whole — stopping at the first double quote
  // would drop any JSON body.
  const dMatch = flat.match(
    /(?:--data(?:-raw|-binary|-urlencode)?|-d)\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+))/
  );
  if (dMatch) {
    const [, singleQuoted, doubleQuoted, bare] = dMatch;
    // Only double-quoted shell arguments carry backslash escapes.
    body = doubleQuoted !== undefined
      ? doubleQuoted.replace(/\\(["\\$`])/g, "$1")
      : singleQuoted ?? bare ?? "";
    if (!explicitMethod) method = "POST";
  }

  return {
    id,
    name: url || "Imported cURL",
    method: toMethod(method),
    path: url,
    headers,
    body,
    tests: [],
  };
}

//    Entry point                                                               

export type ImportFormat = "postman" | "openapi" | "curl";

export function detectFormat(text: string): ImportFormat {
  try {
    const j = JSON.parse(text);
    if (j?.info?.schema?.includes("postman")) return "postman";
    if (j?.openapi || j?.swagger) return "openapi";
  } catch { /* not JSON */ }
  if (text.trimStart().startsWith("curl")) return "curl";
  return "postman";
}
