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
