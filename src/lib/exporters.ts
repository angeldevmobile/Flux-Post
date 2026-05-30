import type { Collection, CollectionRequest } from "@/stores/collections";

//   Postman v2.1                                

function reqToPostmanItem(req: CollectionRequest) {
  return {
    name: req.name,
    request: {
      method: req.method,
      header: Object.entries(req.headers ?? {}).map(([key, value]) => ({ key, value })),
      url: { raw: req.path },
      body: req.body ? { mode: "raw", raw: req.body } : undefined,
    },
    response: [],
  };
}

export function exportPostman(col: Collection): string {
  const items: unknown[] = [
    ...col.requests.map(reqToPostmanItem),
    ...col.folders.map(folder => ({
      name: folder.name,
      item: folder.requests.map(reqToPostmanItem),
    })),
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

function requestToOperation(req: CollectionRequest, tag: string): [string, Record<string, unknown>] {
  let urlPath = req.path;
  const queryParams: { name: string; in: string; required: boolean; schema: { type: string } }[] = [];

  try {
    const parsed = new URL(req.path.startsWith("http") ? req.path : `http://x${req.path}`);
    urlPath = parsed.pathname;
    parsed.searchParams.forEach((_, key) =>
      queryParams.push({ name: key, in: "query", required: false, schema: { type: "string" } })
    );
  } catch { /* use path as-is */ }

  const slugBase = urlPath.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const operation: Record<string, unknown> = {
    summary: req.name || req.path,
    operationId: `${req.method.toLowerCase()}_${slugBase || "root"}`,
    tags: [tag],
  };

  if (queryParams.length > 0) operation.parameters = queryParams;

  if (req.body && !["GET", "HEAD"].includes(req.method)) {
    let schema: Record<string, unknown> = { type: "object" };
    let example: unknown = req.body;
    try { example = JSON.parse(req.body); schema = inferSchema(example); } catch { /* raw body */ }
    const ct = (req.headers?.["Content-Type"] ?? req.headers?.["content-type"] ?? "application/json").split(";")[0].trim();
    operation.requestBody = { required: true, content: { [ct]: { schema, example } } };
  }

  operation.responses = { "200": { description: "Successful response" } };
  return [urlPath, operation];
}

export function exportOpenAPI(col: Collection): string {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagged = [
    ...col.requests.map(r => ({ req: r, tag: col.name })),
    ...col.folders.flatMap(f => f.requests.map(r => ({ req: r, tag: f.name }))),
  ];

  for (const { req, tag } of tagged) {
    const [urlPath, operation] = requestToOperation(req, tag);
    if (!paths[urlPath]) paths[urlPath] = {};
    paths[urlPath][req.method.toLowerCase()] = operation;
  }

  const doc: Record<string, unknown> = {
    openapi: "3.0.3",
    info: { title: col.name, version: "1.0.0" },
    ...(col.baseUrl ? { servers: [{ url: col.baseUrl }] } : {}),
    paths,
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
