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
interface PostmanUrl { raw?: string }
interface PostmanBody { mode?: string; raw?: string; urlencoded?: { key: string; value: string; disabled?: boolean }[] }
interface PostmanRequest { method?: string; header?: PostmanHeader[]; url?: PostmanUrl | string; body?: PostmanBody }
interface PostmanItem { name?: string; request?: PostmanRequest; item?: PostmanItem[] }
interface PostmanCollection { info?: { name?: string }; item?: PostmanItem[] }

function postmanItemToRequest(item: PostmanItem, prefix: string, idx: number): CollectionRequest | null {
  if (!item.request) return null;
  const req = item.request;
  const rawUrl = typeof req.url === "string" ? req.url : (req.url?.raw ?? "");
  const headers: Record<string, string> = {};
  for (const h of req.header ?? []) {
    if (!h.disabled && h.key) headers[h.key] = h.value;
  }
  let body: string | undefined;
  if (req.body?.mode === "raw" && req.body.raw) {
    body = req.body.raw;
  } else if (req.body?.mode === "urlencoded" && req.body.urlencoded) {
    body = req.body.urlencoded
      .filter(f => !f.disabled)
      .map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
      .join("&");
  }
  return {
    id: `${prefix}-${idx}`,
    name: item.name ?? rawUrl,
    method: toMethod(req.method),
    path: rawUrl,
    headers,
    body,
    tests: [],
  };
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
      // folder
      const fid = `${id}-f${folderIdx}`;
      const folderReqs: CollectionRequest[] = [];
      let fi = 0;
      for (const sub of item.item) {
        const r = postmanItemToRequest(sub, fid, fi++);
        if (r) folderReqs.push(r);
      }
      folders.push({ id: fid, name: item.name ?? "Folder", expanded: true, requests: folderReqs });
      folderIdx++;
    } else {
      const r = postmanItemToRequest(item, id, reqIdx++);
      if (r) requests.push(r);
    }
  }

  return { id, name, requests, folders, expanded: true };
}

//    OpenAPI 3.0                                                               

interface OpenApiServer { url?: string }
interface OpenApiOperation { summary?: string; description?: string; operationId?: string; tags?: string[]; parameters?: OpenApiParam[]; requestBody?: OpenApiRequestBody }
interface OpenApiParam { name: string; in: string; required?: boolean; schema?: { type?: string; example?: unknown } }
interface OpenApiRequestBody { content?: Record<string, { schema?: unknown; example?: unknown }> }
interface OpenApiPathItem { get?: OpenApiOperation; post?: OpenApiOperation; put?: OpenApiOperation; patch?: OpenApiOperation; delete?: OpenApiOperation; head?: OpenApiOperation; options?: OpenApiOperation }
interface OpenApiDoc { info?: { title?: string }; servers?: OpenApiServer[]; paths?: Record<string, OpenApiPathItem> }

// Operation keys defined by the OpenAPI path item object — QUERY is not one of them yet.
const OPENAPI_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

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

      const fullPath = baseUrl + path;
      const opName = op.summary ?? op.operationId ?? `${httpMethod.toUpperCase()} ${path}`;
      const headers: Record<string, string> = {};
      let body: string | undefined;

      if (op.requestBody?.content) {
        const jsonContent = op.requestBody.content["application/json"];
        if (jsonContent) {
          headers["Content-Type"] = "application/json";
          if (jsonContent.example) {
            body = JSON.stringify(jsonContent.example, null, 2);
          } else {
            body = "{}";
          }
        }
      }

      const req: CollectionRequest = {
        id: `${id}-${idx++}`,
        name: opName,
        method: toMethod(httpMethod),
        path: fullPath,
        headers,
        body,
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

  return { id, name, requests: untagged, folders, expanded: true };
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
