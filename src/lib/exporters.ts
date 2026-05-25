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

//   cURL                                    

export function exportCurl(req: { method: string; url: string; headers: Record<string, string>; body?: string }): string {
  const parts = [`curl -X ${req.method}`];
  for (const [k, v] of Object.entries(req.headers)) {
    parts.push(`  -H "${k}: ${v.replace(/"/g, '\\"')}"`);
  }
  if (req.body) {
    parts.push(`  -d '${req.body.replace(/'/g, "'\\''")}'`);
  }
  parts.push(`  "${req.url}"`);
  return parts.join(" \\\n");
}
