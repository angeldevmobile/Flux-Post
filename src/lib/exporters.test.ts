import { describe, it, expect } from "vitest";
import { exportPostman, exportCurl, exportFetch, exportAxios, exportPythonRequests, exportGoHttp } from "./exporters";
import { importPostman, importCurl } from "./importers";
import type { Collection } from "@/stores/collections";

const collection: Collection = {
  id: "col-1",
  name: "My API",
  expanded: true,
  requests: [
    {
      id: "r1",
      name: "Get users",
      method: "GET",
      path: "https://api.example.com/users",
      headers: { Accept: "application/json" },
      tests: [],
    },
  ],
  folders: [
    {
      id: "f1",
      name: "Admin",
      expanded: true,
      requests: [
        {
          id: "r2",
          name: "Create user",
          method: "POST",
          path: "https://api.example.com/admin/users",
          headers: { "Content-Type": "application/json" },
          body: '{"name":"ana"}',
          tests: [],
        },
      ],
    },
  ],
};

const snippet = {
  method: "POST",
  url: "https://api.example.com/users",
  headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
  body: '{"name":"ana"}',
};

describe("exportPostman", () => {
  it("emits a v2.1 document", () => {
    const doc = JSON.parse(exportPostman(collection));
    expect(doc.info.name).toBe("My API");
    expect(doc.info.schema).toContain("v2.1.0");
  });

  it("keeps root requests and folders distinct", () => {
    const doc = JSON.parse(exportPostman(collection));
    expect(doc.item).toHaveLength(2);
    expect(doc.item[0].name).toBe("Get users");
    expect(doc.item[1].name).toBe("Admin");
    expect(doc.item[1].item).toHaveLength(1);
  });

  it("survives a round trip through the importer", () => {
    const reimported = importPostman(JSON.parse(exportPostman(collection)));

    expect(reimported.name).toBe("My API");
    expect(reimported.requests).toHaveLength(1);
    expect(reimported.requests[0]).toMatchObject({
      name: "Get users",
      method: "GET",
      path: "https://api.example.com/users",
      headers: { Accept: "application/json" },
    });

    expect(reimported.folders).toHaveLength(1);
    expect(reimported.folders[0].name).toBe("Admin");
    expect(reimported.folders[0].requests[0]).toMatchObject({
      name: "Create user",
      method: "POST",
      path: "https://api.example.com/admin/users",
      body: '{"name":"ana"}',
    });
  });

  it("omits the variable block when there is no base url", () => {
    const doc = JSON.parse(exportPostman(collection));
    expect(doc.variable).toBeUndefined();
  });
});

describe("exportCurl", () => {
  it("includes the method, headers and body", () => {
    const out = exportCurl(snippet);
    expect(out).toContain("curl -X POST");
    expect(out).toContain(`-H "Content-Type: application/json"`);
    expect(out).toContain(`-H "Authorization: Bearer tok"`);
    expect(out).toContain(`-d '{"name":"ana"}'`);
    expect(out).toContain(`"https://api.example.com/users"`);
  });

  it("produces something the cURL importer can read back", () => {
    const back = importCurl(exportCurl(snippet));
    expect(back.method).toBe("POST");
    expect(back.path).toBe("https://api.example.com/users");
    expect(back.body).toBe('{"name":"ana"}');
    expect(back.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("escapes single quotes in the body", () => {
    const out = exportCurl({ ...snippet, body: "it's" });
    expect(out).toContain(`'it'\\''s'`);
  });

  it("omits -d when there is no body", () => {
    expect(exportCurl({ ...snippet, body: undefined })).not.toContain("-d");
  });
});

describe("exportFetch", () => {
  it("emits a fetch call with headers and body", () => {
    const out = exportFetch(snippet);
    expect(out).toContain(`await fetch("https://api.example.com/users"`);
    expect(out).toContain(`method: "POST"`);
    expect(out).toContain(`"Content-Type": "application/json"`);
    expect(out).toContain("body:");
  });

  it("omits the headers block when there are none", () => {
    expect(exportFetch({ ...snippet, headers: {} })).not.toContain("headers:");
  });
});

describe("exportAxios", () => {
  it("inlines a JSON body as an object literal", () => {
    const out = exportAxios(snippet);
    expect(out).toContain(`method: "post"`);
    expect(out).toContain("data: {");
    expect(out).not.toContain('data: `');
  });

  it("falls back to a template literal for a non-JSON body", () => {
    expect(exportAxios({ ...snippet, body: "plain text" })).toContain("data: `plain text`");
  });
});

describe("exportPythonRequests", () => {
  it("emits an import and the request call", () => {
    const out = exportPythonRequests(snippet);
    expect(out).toContain("import requests");
    expect(out).toContain("https://api.example.com/users");
  });
});

describe("exportGoHttp", () => {
  it("emits a compilable-looking Go program", () => {
    const out = exportGoHttp(snippet);
    expect(out).toContain("package main");
    expect(out).toContain("net/http");
    expect(out).toContain("https://api.example.com/users");
  });
});
