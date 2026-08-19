import type { Collection, CollectionRequest, CollectionFolder } from "@/stores/collections";

//   Postman v2.1                                

/** Los tipos de auth de Flux, en la forma que espera Postman v2.1. */
function authToPostman(auth: CollectionRequest["auth"]) {
  if (!auth || auth.type === "none") return undefined;
  const kv = (obj: Record<string, string | undefined>) =>
    Object.entries(obj)
      .filter(([, v]) => v)
      .map(([key, value]) => ({ key, value, type: "string" }));

  switch (auth.type) {
    case "bearer":
      return { type: "bearer", bearer: kv({ token: auth.token }) };
    case "basic":
      return { type: "basic", basic: kv({ username: auth.username, password: auth.password }) };
    case "apikey":
      return { type: "apikey", apikey: kv({ key: auth.key, value: auth.value, in: auth.in }) };
    case "oauth2":
      return {
        type: "oauth2",
        oauth2: kv({
          grant_type: auth.grantType, clientId: auth.clientId, clientSecret: auth.clientSecret,
          authUrl: auth.authUrl, accessTokenUrl: auth.tokenUrl, scope: auth.scopes,
        }),
      };
    case "awsv4":
      return {
        type: "awsv4",
        awsv4: kv({
          accessKey: auth.accessKeyId, secretKey: auth.secretAccessKey,
          sessionToken: auth.sessionToken, region: auth.region, service: auth.service,
        }),
      };
    default:
      return undefined;
  }
}

/** Postman distingue el modo del cuerpo; Flux lo guarda en `bodyType`. */
function bodyToPostman(req: CollectionRequest) {
  if (req.bodyType === "graphql" && req.graphql) {
    return {
      mode: "graphql",
      graphql: { query: req.graphql.query ?? "", variables: req.graphql.variables ?? "" },
    };
  }
  if ((req.bodyType === "form" || req.bodyType === "multipart") && req.form) {
    const fields = Object.entries(req.form).map(([key, value]) => ({ key, value, type: "text" }));
    return req.bodyType === "multipart"
      ? { mode: "formdata", formdata: fields }
      : { mode: "urlencoded", urlencoded: fields };
  }
  return req.body ? { mode: "raw", raw: req.body } : undefined;
}

/**
 * Los scripts y las aserciones viajan en el array `event` de Postman.
 * Las aserciones declarativas de Flux no tienen equivalente directo, asi que se
 * exportan como comentarios dentro del script de test: quien abra la coleccion
 * las ve y puede traducirlas, en vez de perderlas en silencio.
 */
function eventsToPostman(req: CollectionRequest) {
  const events: unknown[] = [];
  const pre = req.scripts?.preRequest?.trim();
  const post = req.scripts?.postResponse?.trim();

  if (pre) {
    events.push({ listen: "prerequest", script: { type: "text/javascript", exec: pre.split(/\r?\n/) } });
  }

  const testLines: string[] = [];
  if (post) testLines.push(...post.split(/\r?\n/));
  for (const t of req.tests ?? []) {
    testLines.push(`// Flux assertion: ${t.assert}`);
  }
  for (const e of req.extractors ?? []) {
    testLines.push(`// Flux extractor: ${e.variable} = ${e.path}`);
  }
  if (testLines.length > 0) {
    events.push({ listen: "test", script: { type: "text/javascript", exec: testLines } });
  }

  return events.length > 0 ? events : undefined;
}

function reqToPostmanItem(req: CollectionRequest) {
  const query = Object.entries(req.params ?? {}).map(([key, value]) => ({ key, value }));

  return {
    name: req.name,
    request: {
      method: req.method,
      header: Object.entries(req.headers ?? {}).map(([key, value]) => ({ key, value })),
      url: query.length > 0 ? { raw: req.path, query } : { raw: req.path },
      body: bodyToPostman(req),
      auth: authToPostman(req.auth),
    },
    event: eventsToPostman(req),
    response: [],
  };
}

/** Postman folders are just items with an `item` array, so nesting maps directly. */
function folderToPostmanItem(folder: CollectionFolder): unknown {
  return {
    name: folder.name,
    item: [
      ...folder.requests.map(reqToPostmanItem),
      ...(folder.folders ?? []).map(folderToPostmanItem),
    ],
  };
}

export function exportPostman(col: Collection): string {
  const items: unknown[] = [
    ...col.requests.map(reqToPostmanItem),
    ...col.folders.map(folderToPostmanItem),
  ];

  const doc = {
    info: {
      name: col.name,
      _postman_id: col.id,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: items,
    variable: col.baseUrl
      ? [{ key: "baseUrl", value: col.baseUrl }]
      : undefined,
  };

  return JSON.stringify(doc, null, 2);
}

//   Snippet helpers

type SnippetReq = { method: string; url: string; headers: Record<string, string>; body?: string };

function escDQ(s: string) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function escBT(s: string) { return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`"); }

//   cURL

export function exportCurl(req: SnippetReq): string {
  const parts = [`curl -X ${req.method}`];
  for (const [k, v] of Object.entries(req.headers)) {
    parts.push(`  -H "${escDQ(k)}: ${escDQ(v)}"`);
  }
  if (req.body) {
    parts.push(`  -d '${req.body.replace(/'/g, "'\\''")}'`);
  }
  parts.push(`  "${req.url}"`);
  return parts.join(" \\\n");
}

//   fetch (JS)

export function exportFetch(req: SnippetReq): string {
  const lines: string[] = [];
  const headerEntries = Object.entries(req.headers);

  lines.push(`const response = await fetch("${req.url}", {`);
  lines.push(`  method: "${req.method}",`);

  if (headerEntries.length > 0) {
    lines.push(`  headers: {`);
    for (const [k, v] of headerEntries) lines.push(`    "${escDQ(k)}": "${escDQ(v)}",`);
    lines.push(`  },`);
  }

  if (req.body) lines.push(`  body: \`${escBT(req.body)}\`,`);

  lines.push(`});`, ``, `const data = await response.json();`, `console.log(data);`);
  return lines.join("\n");
}

//   axios (JS)

export function exportAxios(req: SnippetReq): string {
  const lines: string[] = [];
  const headerEntries = Object.entries(req.headers);

  lines.push(`import axios from "axios";`, ``);
  lines.push(`const { data } = await axios({`);
  lines.push(`  method: "${req.method.toLowerCase()}",`);
  lines.push(`  url: "${req.url}",`);

  if (headerEntries.length > 0) {
    lines.push(`  headers: {`);
    for (const [k, v] of headerEntries) lines.push(`    "${escDQ(k)}": "${escDQ(v)}",`);
    lines.push(`  },`);
  }

  if (req.body) {
    try {
      const parsed = JSON.parse(req.body);
      const dataStr = JSON.stringify(parsed, null, 2).replace(/\n/g, "\n  ");
      lines.push(`  data: ${dataStr},`);
    } catch {
      lines.push(`  data: \`${escBT(req.body)}\`,`);
    }
  }

  lines.push(`});`, ``, `console.log(data);`);
  return lines.join("\n");
}

//   Python requests

export function exportPythonRequests(req: SnippetReq): string {
  const lines: string[] = [];
  const headerEntries = Object.entries(req.headers);
  const args: string[] = [`"${req.url}"`];

  lines.push(`import requests`, ``);

  if (headerEntries.length > 0) {
    lines.push(`headers = {`);
    for (const [k, v] of headerEntries) lines.push(`    "${escDQ(k)}": "${escDQ(v)}",`);
    lines.push(`}`, ``);
    args.push(`headers=headers`);
  }

  if (req.body) {
    try {
      const parsed = JSON.parse(req.body);
      const pyJson = JSON.stringify(parsed, null, 4)
        .replace(/\bnull\b/g, "None")
        .replace(/\btrue\b/g, "True")
        .replace(/\bfalse\b/g, "False");
      lines.push(`json_data = ${pyJson}`, ``);
      args.push(`json=json_data`);
    } catch {
      lines.push(`body = """${req.body}"""`, ``);
      args.push(`data=body`);
    }
  }

  lines.push(`response = requests.${req.method.toLowerCase()}(${args.join(", ")})`, ``, `print(response.json())`);
  return lines.join("\n");
}

//   OpenAPI 3.0

function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "string", nullable: true };
  if (typeof value === "boolean") return { type: "boolean", example: value };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number", example: value };
  if (typeof value === "string") return { type: "string", example: value };
  if (Array.isArray(value)) return { type: "array", items: value.length > 0 ? inferSchema(value[0]) : { type: "string" } };
  if (typeof value === "object") {
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) properties[k] = inferSchema(v);
    return { type: "object", properties };
  }
  return { type: "string" };
}

/** Nombre del esquema de seguridad en `components`, o null si no hay equivalente. */
function securitySchemeFor(auth: CollectionRequest["auth"]): [string, Record<string, unknown>] | null {
  if (!auth || auth.type === "none") return null;
  switch (auth.type) {
    case "bearer":
      return ["bearerAuth", { type: "http", scheme: "bearer" }];
    case "basic":
      return ["basicAuth", { type: "http", scheme: "basic" }];
    case "apikey":
      return ["apiKeyAuth", {
        type: "apiKey",
        in: auth.in === "query" ? "query" : "header",
        name: auth.key || "X-API-Key",
      }];
    case "oauth2":
      return ["oauth2Auth", {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: auth.tokenUrl ?? "",
            scopes: Object.fromEntries((auth.scopes ?? "").split(/[\s,]+/).filter(Boolean).map(sc => [sc, sc])),
          },
        },
      }];
    default:
      // AWS SigV4 no tiene equivalente en OpenAPI 3.0. Mejor omitirlo que
      // emitir un esquema que diga otra cosa.
      return null;
  }
}

function requestBodyFor(req: CollectionRequest): Record<string, unknown> | undefined {
  if (req.bodyType === "graphql" && req.graphql) {
    return {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { query: { type: "string" }, variables: { type: "object" } },
          },
          example: { query: req.graphql.query ?? "", variables: req.graphql.variables ?? "" },
        },
      },
    };
  }

  if ((req.bodyType === "form" || req.bodyType === "multipart") && req.form) {
    const properties = Object.fromEntries(
      Object.keys(req.form).map(k => [k, { type: "string" }]),
    );
    const ct = req.bodyType === "multipart" ? "multipart/form-data" : "application/x-www-form-urlencoded";
    return {
      required: true,
      content: { [ct]: { schema: { type: "object", properties }, example: req.form } },
    };
  }

  if (!req.body) return undefined;

  let schema: Record<string, unknown> = { type: "object" };
  let example: unknown = req.body;
  try { example = JSON.parse(req.body); schema = inferSchema(example); } catch { /* raw body */ }
  const ct = (req.headers?.["Content-Type"] ?? req.headers?.["content-type"] ?? "application/json")
    .split(";")[0].trim();
  return { required: true, content: { [ct]: { schema, example } } };
}

function requestToOperation(
  req: CollectionRequest,
  tag: string,
): [string, Record<string, unknown>, [string, Record<string, unknown>] | null] {
  let urlPath = req.path;
  const params: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const addQuery = (name: string) => {
    if (seen.has(`q:${name}`)) return;
    seen.add(`q:${name}`);
    params.push({ name, in: "query", required: false, schema: { type: "string" } });
  };

  try {
    const parsed = new URL(req.path.startsWith("http") ? req.path : `http://x${req.path}`);
    urlPath = parsed.pathname;
    parsed.searchParams.forEach((_, key) => addQuery(key));
  } catch { /* use path as-is */ }

  // Los params de la pestaña Params viven aparte de la URL y antes se perdian.
  for (const name of Object.keys(req.params ?? {})) addQuery(name);

  // Content-Type queda implicito en requestBody, no se duplica como cabecera.
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (name.toLowerCase() === "content-type") continue;
    params.push({
      name, in: "header", required: false,
      schema: { type: "string" }, example: value,
    });
  }

  const slugBase = urlPath.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const operation: Record<string, unknown> = {
    summary: req.name || req.path,
    operationId: `${req.method.toLowerCase()}_${slugBase || "root"}`,
    tags: [tag],
  };

  if (params.length > 0) operation.parameters = params;

  if (!["GET", "HEAD"].includes(req.method)) {
    const body = requestBodyFor(req);
    if (body) operation.requestBody = body;
  }

  const scheme = securitySchemeFor(req.auth);
  if (scheme) operation.security = [{ [scheme[0]]: [] }];

  operation.responses = { "200": { description: "Successful response" } };
  return [urlPath, operation, scheme];
}

export function exportOpenAPI(col: Collection): string {
  const paths: Record<string, Record<string, unknown>> = {};
  // OpenAPI has no folder nesting, so a nested folder becomes a "Parent / Child" tag.
  const walk = (folders: CollectionFolder[], prefix: string): { req: CollectionRequest; tag: string }[] =>
    folders.flatMap(f => {
      const tag = prefix ? `${prefix} / ${f.name}` : f.name;
      return [
        ...f.requests.map(r => ({ req: r, tag })),
        ...walk(f.folders ?? [], tag),
      ];
    });

  const tagged = [
    ...col.requests.map(r => ({ req: r, tag: col.name })),
    ...walk(col.folders, ""),
  ];

  const securitySchemes: Record<string, unknown> = {};

  for (const { req, tag } of tagged) {
    const [urlPath, operation, scheme] = requestToOperation(req, tag);
    if (scheme) securitySchemes[scheme[0]] = scheme[1];
    if (!paths[urlPath]) paths[urlPath] = {};
    paths[urlPath][req.method.toLowerCase()] = operation;
  }

  const doc: Record<string, unknown> = {
    openapi: "3.0.3",
    info: { title: col.name, version: "1.0.0" },
    ...(col.baseUrl ? { servers: [{ url: col.baseUrl }] } : {}),
    paths,
    ...(Object.keys(securitySchemes).length > 0 ? { components: { securitySchemes } } : {}),
  };

  return JSON.stringify(doc, null, 2);
}

//   Go net/http

export function exportGoHttp(req: SnippetReq): string {
  const lines: string[] = [];
  const headerEntries = Object.entries(req.headers);
  const hasBody = !!req.body;

  lines.push(`package main`, ``);
  lines.push(`import (`);
  lines.push(`\t"fmt"`, `\t"io"`, `\t"net/http"`);
  if (hasBody) lines.push(`\t"strings"`);
  lines.push(`)`, ``);
  lines.push(`func main() {`);

  if (hasBody) {
    // Go raw strings can't contain backticks; split and concatenate around them
    const escaped = req.body!.replace(/`/g, "` + \"`\" + `");
    lines.push(`\tbody := strings.NewReader(\`${escaped}\`)`);
    lines.push(`\treq, _ := http.NewRequest("${req.method}", "${req.url}", body)`);
  } else {
    lines.push(`\treq, _ := http.NewRequest("${req.method}", "${req.url}", nil)`);
  }

  for (const [k, v] of headerEntries) {
    lines.push(`\treq.Header.Set("${escDQ(k)}", "${escDQ(v)}")`);
  }

  lines.push(
    ``,
    `\tclient := &http.Client{}`,
    `\tresp, err := client.Do(req)`,
    `\tif err != nil {`,
    `\t\tpanic(err)`,
    `\t}`,
    `\tdefer resp.Body.Close()`,
    ``,
    `\tb, _ := io.ReadAll(resp.Body)`,
    `\tfmt.Println(string(b))`,
    `}`,
  );
  return lines.join("\n");
}
